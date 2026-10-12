import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { JsonMessages, StandaloneSession, nativeRequest } = require('./standalone-session.cjs');
const { createDeviceCsr } = require('./device-certificate.cjs');
const encryptionKey = crypto.randomBytes(32);
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: text => {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]);
  },
  decryptString: data => {
    const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString();
  },
};

describe('native login protocol', () => {
  it('reassembles split UTF-8 JSON and multiple messages without exposing secrets', () => {
    const messages = [], decoder = new JsonMessages(message => messages.push(message));
    decoder.push('{"uid":"test-user","devicelist":{"result":{"list":[{"name":"测试 } \\\"设备"');
    decoder.push('}]}}} {"p2pResult":1}\n');
    expect(messages).toHaveLength(2);
    expect(messages[0].devicelist.result.list[0].name).toBe('测试 } "设备');
    expect(messages[1]).toEqual({ p2pResult: 1 });
  });
  it('rejects oversized unfinished messages', () => {
    expect(() => new JsonMessages(() => {}).push('{' + ' '.repeat(4 * 1024 * 1024))).toThrow('过大');
  });
  it('waits for a complete socket response and reports timeout safely', async () => {
    const server = net.createServer(socket => socket.once('data', () => { socket.write('{"urlport":'); socket.end('41001}'); }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try { expect(await nativeRequest({ cmd: 'p2pinit' }, { port: server.address().port })).toEqual({ urlport: 41001 }); }
    finally { await new Promise(resolve => server.close(resolve)); }
    const hanging = net.createServer(socket => socket.on('data', () => {}));
    await new Promise(resolve => hanging.listen(0, '127.0.0.1', resolve));
    try { await expect(nativeRequest({ cmd: 'heart' }, { port: hanging.address().port, timeout: 25 })).rejects.toThrow('超时'); }
    finally { await new Promise(resolve => hanging.close(resolve)); }
  });
  it('reports a native authentication rejection without mislabeling the device as offline', async () => {
    const server = net.createServer(socket => socket.once('data', () => socket.end(JSON.stringify({ code: -401, msg: 'fixture-private-detail' }))));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await expect(nativeRequest({ cmd: 'p2pinit' }, { port: server.address().port })).rejects.toThrow('通信认证失败');
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
  it('authenticates every command with the native launch key and rotates it on restart', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-ipc-test-'));
    const servers = vi.spyOn(net, 'createServer').mockImplementation(() => {
      const server = new EventEmitter();
      server.listen = (_port, _host, ready) => { server.listening = true; queueMicrotask(ready); };
      server.close = ready => { server.listening = false; queueMicrotask(ready); };
      return server;
    });
    const requests = [], launches = [];
    const account = new StandaloneSession({ userData: directory, runtimeSource: '', safeStorage,
      request: async data => { requests.push(data); return { code: 0 }; },
      spawnProcess: (_file, _args, options) => {
        launches.push(options);
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.exitCode = 0;
        return child;
      } });
    account.prepareRuntime = () => ({ version: 'fixture', executable: 'fixture.exe' });
    try {
      await account.start();
      const firstKey = launches[0].env.MI_SSO_IPC_AUTH_KEY;
      expect(firstKey).toMatch(/^[a-f0-9]{64}$/);
      for (const cmd of ['heart', 'getUserCertificate', 'p2pinit']) await account.request({ cmd, authKey: 'incorrect-caller-key' });
      expect(requests.map(item => item.authKey)).toEqual([firstKey, firstKey, firstKey]);
      expect(JSON.stringify(account.status())).not.toContain(firstKey);
      account.persist();
      expect(JSON.stringify(new StandaloneSession({ userData: directory, runtimeSource: '', safeStorage }).session)).not.toContain(firstKey);
      await account.stop();
      expect(account.ipcAuthKey).toBe('');
      await account.start();
      expect(launches[1].env.MI_SSO_IPC_AUTH_KEY).not.toBe(firstKey);
      await account.request({ cmd: 'heart' });
      expect(requests.at(-1).authKey).toBe(launches[1].env.MI_SSO_IPC_AUTH_KEY);
    } finally {
      await account.stop(); servers.mockRestore(); fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('account isolation', () => {
  it('encrypts the account, filters renderer status, restores and removes only its own profile', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-account-test-'));
    try {
      const options = { userData: directory, runtimeSource: path.join(directory, 'vendor'), safeStorage };
      const account = new StandaloneSession(options);
      account.acceptMessage({ L1: 'fixture-sensitive-token', L2: 'secret' });
      account.acceptMessage({ uid: 'fixture-user', token: 'never-render-this', devicelist: { result: { list: [{ did: 'test-device', model: 'nas', name: '相册', token: 'private' }] } } });
      expect(fs.readFileSync(account.sessionPath).includes(Buffer.from('fixture-sensitive-token'))).toBe(false);
      expect(JSON.stringify(account.status())).not.toMatch(/fixture-sensitive-token|never-render-this|fixture-user|private/);
      const restored = new StandaloneSession(options);
      expect(restored.session.login.L1).toBe('fixture-sensitive-token');
      expect(restored.status().devices).toEqual([{ id: 'test-device', name: '相册', online: true }]);
      const oldRuntimePath = restored.runtimePath;
      fs.mkdirSync(restored.runtimePath, { recursive: true }); fs.writeFileSync(path.join(restored.runtimePath, 'Cookies'), 'fixture');
      await restored.signOut();
      expect(fs.existsSync(restored.sessionPath)).toBe(false);
      expect(fs.existsSync(oldRuntimePath)).toBe(false);
      expect(restored.runtimePath).not.toBe(oldRuntimePath);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  it('refuses to persist credentials without OS encryption', () => {
    const account = new StandaloneSession({ userData: os.tmpdir(), runtimeSource: '', safeStorage: { isEncryptionAvailable: () => false } });
    expect(() => account.persist()).toThrow('加密');
  });
  it('does not accept a renderer-provided device outside the authenticated list', async () => {
    const account = new StandaloneSession({ userData: os.tmpdir(), runtimeSource: '', safeStorage });
    account.child = {}; account.session.uid = 'fixture-user'; account.session.devices = [];
    await expect(account.getConnection({ deviceId: 'arbitrary-device' })).rejects.toThrow('请选择');
  });
});

describe('device CSR', () => {
  it('generates a signed Ed25519 request with a device-bound identity', () => {
    const { csrPem, privateKeyPem } = createDeviceCsr('fixture-user', 'test-device');
    const data = Buffer.from(csrPem.replace(/-----[^\n]+-----|\s/g, ''), 'base64');
    const cn = `nas.fixture-user.${crypto.createHash('sha1').update('test-device').digest('hex')}.2`;
    expect(data.includes(Buffer.from(cn))).toBe(true);
    function read(offset) {
      let size = data[offset + 1], header = 2;
      if (size & 128) { const count = size & 127; size = 0; for (let i = 0; i < count; i++) size = size * 256 + data[offset + 2 + i]; header += count; }
      return { content: offset + header, end: offset + header + size };
    }
    const outer = read(0), info = read(outer.content), algorithm = read(info.end), signature = read(algorithm.end);
    const valid = crypto.verify(null, data.subarray(outer.content, info.end), crypto.createPublicKey(privateKeyPem), data.subarray(signature.content + 1, signature.end));
    expect(valid).toBe(true);
    expect(() => createDeviceCsr('../../invalid', 'device')).toThrow('身份');
  });
});
