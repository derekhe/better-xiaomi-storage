const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { createDeviceCsr, validateDeviceCertificate } = require('./device-certificate.cjs');

const COMMAND_PORT = 25445;
const CALLBACK_PORT = 31288;
const MAX_MESSAGE = 4 * 1024 * 1024;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// TCP may split or join native JSON messages. Keep framing separate from account state.
class JsonMessages {
  constructor(onMessage) { this.buffer = ''; this.onMessage = onMessage; }
  push(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_MESSAGE) throw new Error('登录组件返回的数据过大');
    let start = -1, depth = 0, quoted = false, escaped = false;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (start < 0) { if (/\s/.test(ch)) continue; if (ch !== '{') throw new Error('登录组件返回的数据格式无效'); start = i; }
      if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; }
      else if (ch === '"') quoted = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
      if (depth === 0 && start >= 0 && !quoted) {
        const message = JSON.parse(this.buffer.slice(start, i + 1));
        this.buffer = this.buffer.slice(i + 1); i = -1; start = -1;
        this.onMessage(message);
      }
    }
  }
}

function nativeRequest(data, { timeout = 15000, port = COMMAND_PORT } = {}) {
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0), settled = false;
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(new Error('登录组件请求超时')), timeout);
    socket.once('connect', () => socket.write(JSON.stringify(data)));
    socket.on('data', chunk => {
      response = Buffer.concat([response, chunk]);
      if (response.length > MAX_MESSAGE) return finish(new Error('登录组件返回的数据过大'));
    });
    socket.once('error', () => finish(new Error('登录组件当前不可用')));
    socket.once('close', () => {
      if (settled) return;
      try {
        const result = JSON.parse(response.toString('utf8'));
        if (Number(result?.code) === -401) return finish(new Error('登录组件通信认证失败，请重启映集后重试'));
        finish(null, result);
      }
      catch { finish(new Error('登录组件返回了无法解析的数据')); }
    });
  });
}

class StandaloneSession extends EventEmitter {
  constructor({ userData, runtimeSource, safeStorage, localAppData = process.env.LOCALAPPDATA, spawnProcess = spawn, request = nativeRequest }) {
    super();
    this.userData = userData; this.runtimeSource = runtimeSource; this.safeStorage = safeStorage;
    this.localAppData = localAppData;
    this.spawnProcess = spawnProcess; this.ipcAuthKey = '';
    this.request = (data, options) => request(this.ipcAuthKey ? { ...data, authKey: this.ipcAuthKey } : data, options);
    this.sessionPath = path.join(userData, 'account.bin');
    this.session = {}; this.child = null; this.server = null; this.sockets = new Set();
    this.state = 'signed-out'; this.message = ''; this.startPromise = null; this.connectPromise = null; this.connection = null;
    this.generation = 0;
    if (fs.existsSync(this.sessionPath) && safeStorage.isEncryptionAvailable()) {
      try { this.session = JSON.parse(safeStorage.decryptString(fs.readFileSync(this.sessionPath))); }
      catch { this.message = '保存的登录已失效，请重新登录'; }
    }
    this.uuid = /^[a-f0-9]{32}$/.test(this.session.uuid || '') ? this.session.uuid : crypto.randomUUID().replace(/-/g, '');
    this.runtimePath = path.join(userData, 'native-runtime', this.uuid);
  }

  status() {
    return { state: this.state, runtimeAvailable: fs.existsSync(path.join(this.runtimeSource, 'manifest.json')),
      devices: (this.session.devices || []).map(item => ({ id: String(item.did), name: String(item.name || item.model || '小米智能存储').slice(0, 128), online: item.isOnline !== false })),
      selectedDeviceId: this.connection ? this.session.selectedDeviceId : undefined, message: this.message || undefined };
  }
  change(state, message = '') { this.state = state; this.message = message; this.emit('status', this.status()); }
  persist() {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密当前不可用，无法保存登录');
    fs.mkdirSync(this.userData, { recursive: true });
    this.session.uuid = this.uuid;
    const temporary = `${this.sessionPath}.tmp`;
    fs.writeFileSync(temporary, this.safeStorage.encryptString(JSON.stringify(this.session)), { mode: 0o600 });
    fs.renameSync(temporary, this.sessionPath);
  }

  prepareRuntime() {
    const manifest = JSON.parse(fs.readFileSync(path.join(this.runtimeSource, 'manifest.json'), 'utf8'));
    if (manifest.executable !== '小米智能存储.exe') throw new Error('登录组件清单无效');
    for (const [name, digest] of Object.entries(manifest.files)) {
      if (path.isAbsolute(name) || name.split(/[\\/]/).some(part => part === '..')
        || !/\.(exe|dll|pak|bin|dat|pem|ini|html|css|js|png|svg|jpg|txt)$/i.test(name)) throw new Error('登录组件清单包含无效路径');
      const data = fs.readFileSync(path.join(this.runtimeSource, name));
      if (crypto.createHash('sha256').update(data).digest('hex') !== digest) throw new Error('登录组件完整性校验失败');
      const destination = path.join(this.runtimePath, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (!fs.existsSync(destination) || crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex') !== digest) fs.writeFileSync(destination, data);
    }
    const iniPath = path.join(this.runtimePath, 'SSO_SDK.ini');
    const sdkProfile = `\\better-xiaomi-storage\\${this.uuid}\\xx0.dat`;
    if (!this.localAppData) throw new Error('无法定位账号缓存目录');
    fs.mkdirSync(path.join(this.localAppData, 'better-xiaomi-storage', this.uuid), { recursive: true });
    fs.writeFileSync(iniPath, fs.readFileSync(iniPath, 'utf8').replace(/^datName=.*$/m, `datName=${sdkProfile}\r`));
    this.persist();
    return manifest;
  }

  acceptMessage(message) {
    if (message.uid) {
      if (this.session.uid && this.session.uid !== String(message.uid)) {
        this.session.certificates = {}; delete this.session.selectedDeviceId; this.connection = null;
      }
      const devices = message.devicelist?.result?.list;
      this.session.uid = String(message.uid);
      this.session.devices = Array.isArray(devices) ? devices.filter(item => item.did && item.model) : [];
      this.persist(); this.change(this.connection ? 'connected' : 'signed-in');
    } else if (message.miMsgInfolocal || message.L1) {
      this.session.login = Object.fromEntries(Array.from({ length: 7 }, (_, i) => `L${i + 1}`).map(key => [key, String(message[key] || '')]));
      this.persist();
    } else if (message.cmd === 'closeLogin') {
      this.change('signed-out', '登录窗口已关闭，可以再次登录'); void this.stop();
    } else if (message.cmd === 'updateTokenFaild') {
      this.session = { uuid: this.uuid }; this.persist(); this.connection = null;
      this.change('signed-out', '登录已过期，请重新登录'); void this.stop();
    } else if (message.cmd === 'sonrestart') {
      this.connection = null; this.change('signed-in', '设备通道已断开，请重新连接');
    }
  }

  async start() {
    if (this.child) return this.status();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startNative();
    try { return await this.startPromise; }
    catch (error) { await this.stop(); this.change('error', error.message); throw error; }
    finally { this.startPromise = null; }
  }
  async startNative() {
    const generation = this.generation;
    const check = () => { if (generation !== this.generation) throw new Error('登录已取消'); };
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密当前不可用');
    const manifest = this.prepareRuntime();
    // Never attach to a different application's unauthenticated native socket.
    const probe = net.createServer();
    await new Promise((resolve, reject) => { probe.once('error', () => reject(new Error('登录组件端口被占用，请关闭官方客户端后再登录'))); probe.listen(COMMAND_PORT, '127.0.0.1', resolve); });
    await new Promise(resolve => probe.close(resolve));
    check();
    this.server = net.createServer(socket => {
      this.sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => this.sockets.delete(socket));
      socket.setTimeout(30000, () => socket.destroy());
      const decoder = new JsonMessages(message => { try { this.acceptMessage(message); } catch { this.change('error', '无法保存登录信息'); } });
      socket.setEncoding('utf8'); socket.on('data', chunk => { try { decoder.push(chunk); } catch { socket.destroy(); } });
    });
    await new Promise((resolve, reject) => { this.server.once('error', () => reject(new Error('登录通知端口被占用，请关闭官方客户端后再登录'))); this.server.listen(CALLBACK_PORT, '127.0.0.1', resolve); });
    check();
    this.change('signing-in');
    const ua = `MiNasClient/${manifest.version} (pc app; ${encodeURIComponent(os.hostname())}; Windows 10/11 ${os.release()} (x64); ${this.uuid})`;
    const login = this.session.login || {};
    const args = [ua, '0', this.uuid, ...Array.from({ length: 7 }, (_, i) => login[`L${i + 1}`] || '')];
    // The native component requires the same per-process key in its environment and every command.
    this.ipcAuthKey = crypto.randomBytes(32).toString('hex');
    const child = this.spawnProcess(path.join(this.runtimePath, manifest.executable), args,
      { cwd: this.runtimePath, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MI_SSO_IPC_AUTH_KEY: this.ipcAuthKey } });
    this.child = child;
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {}); // Native output can contain credentials.
    child.once('error', () => { if (this.child === child) { this.change('error', '无法启动登录组件'); void this.stop(); } });
    child.once('exit', () => { if (this.child === child) { this.change('error', '登录组件已退出，请重新登录'); void this.stop(); } });
    this.heartbeat = setInterval(() => { if (this.child) this.request({ cmd: 'heart', url: 'heart', param: 'heart' }, { timeout: 4000 }).catch(() => {}); }, 5000);
    this.heartbeat.unref();
    return this.status();
  }

  async getConnection({ force = false, deviceId } = {}) {
    if (this.connection && !force && (!deviceId || deviceId === this.session.selectedDeviceId)) return this.connection;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectDevice(deviceId);
    const generation = this.generation;
    try { return await this.connectPromise; }
    catch (error) { if (generation === this.generation) this.change(this.session.uid ? 'signed-in' : 'signed-out', error.message); throw error; }
    finally { this.connectPromise = null; }
  }
  async connectDevice(deviceId) {
    const generation = this.generation;
    const check = () => { if (generation !== this.generation) throw new Error('连接已取消'); };
    if (!this.child && this.session.login?.L1) await this.start();
    check();
    if (!this.child || !this.session.uid) throw new Error('请先登录小米账号并选择存储设备');
    const id = deviceId || this.session.selectedDeviceId;
    const device = this.session.devices?.find(item => String(item.did) === id);
    if (!device) throw new Error('请选择要打开的存储设备');
    this.connection = null; this.change('connecting');
    const uid = this.session.uid, did = String(device.did);
    const caPath = path.join(this.runtimePath, 'ca_chain.pem');
    const caPem = fs.readFileSync(caPath, 'utf8');
    const saved = this.session.certificates?.[did];
    let material;
    try { if (saved) validateDeviceCertificate(saved.certPem, saved.privateKeyPem, uid, did, caPem); else throw new Error(); material = saved; }
    catch {
      const csr = createDeviceCsr(uid, did);
      const response = await this.request({ cmd: 'getUserCertificate', url: 'get_user_cert', param: JSON.stringify({ csr: Buffer.from(csr.csrPem).toString('base64') }) });
      check();
      if (!response?.result?.cert) throw new Error('无法申请设备证书，请重新登录');
      material = { certPem: response.result.cert, privateKeyPem: csr.privateKeyPem };
      validateDeviceCertificate(material.certPem, material.privateKeyPem, uid, did, caPem);
      this.session.certificates = { ...this.session.certificates, [did]: material }; this.persist();
    }
    const ports = await this.request({ cmd: 'p2pinit', url: 'p2p', param: JSON.stringify({ did, tunnels: [{ type: 'miss', params: { did, model: device.model } }] }) }, { timeout: 45000 });
    check();
    if (ports?.code !== undefined && Number(ports.code) !== 0) throw new Error(`设备通道建立失败（错误码 ${Number(ports.code)}），请重新连接`);
    const apiPort = Number(ports.urlport), webDavPort = Number(ports.webdavport);
    if (![apiPort, webDavPort].every(port => Number.isInteger(port) && port > 1024 && port < 65536)) throw new Error('设备未返回有效通道，请确认设备在线');
    // Private keys stay encrypted at rest and are passed to HTTPS in main-process memory.
    this.session.selectedDeviceId = did; this.persist();
    this.connection = { certificate: { uid, did, cert: material.certPem, key: material.privateKeyPem, ca: caPem }, apiPort, webDavPort };
    this.change('connected'); return this.connection;
  }

  async stop() {
    this.generation++;
    clearInterval(this.heartbeat);
    this.ipcAuthKey = '';
    const child = this.child; this.child = null; this.connection = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      if (process.platform === 'win32') await new Promise((resolve, reject) => {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, error => {
          if (error && child.exitCode === null && child.signalCode === null) reject(new Error('无法关闭登录组件，请退出映集后重试'));
          else resolve();
        });
      }); else child.kill();
      await Promise.race([exited, sleep(2000)]);
    }
    for (const socket of this.sockets) socket.destroy(); this.sockets.clear();
    const server = this.server; this.server = null;
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
  async signOut() {
    await this.stop();
    const uuid = this.uuid;
    this.session = {}; this.uuid = crypto.randomUUID().replace(/-/g, '');
    fs.rmSync(this.sessionPath, { force: true });
    // The native browser stores its own profile beside its executable. All of it is ours.
    const expected = path.resolve(this.userData, 'native-runtime', uuid);
    if (path.resolve(this.runtimePath) !== expected) throw new Error('登录数据目录无效');
    let cleanupMessage = '';
    for (const directory of [expected, this.localAppData ? path.join(this.localAppData, 'better-xiaomi-storage', uuid) : null].filter(Boolean)) {
      try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
        cleanupMessage = '账号已退出；Windows 尚未释放部分运行缓存，新登录会使用独立目录';
      }
    }
    this.runtimePath = path.join(this.userData, 'native-runtime', this.uuid);
    this.change('signed-out', cleanupMessage); return this.status();
  }
}

module.exports = { StandaloneSession, JsonMessages, nativeRequest };
