import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildWebDavPath,
  extractPortCandidatesFromText,
  extractPortMappingsFromText,
  parseStreamPhotoList,
  SmartStorageClient,
} = require('./smart-storage-client.cjs');

describe('P2P port discovery', () => {
  it('prefers the latest port and removes duplicates', () => {
    const log = [
      'p2pport={"urlport":"41001","webdavport":"41002"}',
      'url=https://127.0.0.1:42001/cgi-bin/luci/plugincenter/get_access_token',
      'port=42001 hasToken=true',
    ].join('\n');
    expect(extractPortCandidatesFromText(log)).toEqual([42001, 41001]);
  });

  it('keeps the WebDAV port paired with its API tunnel', () => {
    const log = [
      'p2pport={"urlport":"41001","webdavport":"41002"}',
      'p2pport={"urlport":42001,"webdavport":42002,"webport":42003}',
    ].join('\n');
    expect(extractPortMappingsFromText(log)).toEqual([
      { apiPort: 42001, webDavPort: 42002, index: expect.any(Number) },
      { apiPort: 41001, webDavPort: 41002, index: expect.any(Number) },
    ]);
  });
});

describe('fresh previews for cleanup', () => {
  it('bypasses the path cache when rescanning and replaces it with the new preview', async () => {
    const client = new SmartStorageClient();
    client.connect = vi.fn(async () => 41001);
    client.rawRequest = vi.fn()
      .mockResolvedValueOnce({ contentType: 'image/png', data: Buffer.from('old') })
      .mockResolvedValueOnce({ contentType: 'image/png', data: Buffer.from('new') });
    const params = { photoPath: '/photos/a.jpg', quality: 'preview' };
    const old = await client.getThumbnail(params);
    expect(await client.getThumbnail(params)).toBe(old);
    const fresh = await client.getThumbnail({ ...params, refresh: true });
    expect(fresh).not.toBe(old);
    expect(await client.getThumbnail(params)).toBe(fresh);
    expect(client.rawRequest).toHaveBeenCalledTimes(2);
  });
  it('does not let an older failed read evict a newer successful refresh', async () => {
    const client = new SmartStorageClient();
    client.connect = vi.fn(async () => 41001);
    let failOld;
    client.rawRequest = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { failOld = reject; }))
      .mockResolvedValueOnce({ contentType: 'image/png', data: Buffer.from('new') });
    const params = { photoPath: '/photos/a.jpg', quality: 'preview' };
    const old = client.getThumbnail(params), rejected = expect(old).rejects.toThrow('old failed');
    const fresh = await client.getThumbnail({ ...params, refresh: true });
    failOld(new Error('old failed')); await rejected;
    expect(await client.getThumbnail(params)).toBe(fresh);
    expect(client.rawRequest).toHaveBeenCalledTimes(2);
  });
});

describe('WebDAV media paths', () => {
  it('removes the alias root and safely encodes every path segment', () => {
    expect(buildWebDavPath('/用户目录/照片/旅行 2026/海边#1.jpg', '/用户目录'))
      .toBe('/%E7%85%A7%E7%89%87/%E6%97%85%E8%A1%8C%202026/%E6%B5%B7%E8%BE%B9%231.jpg');
  });
});

describe('stream photo index parsing', () => {
  it('does not turn failed or malformed indexes into empty libraries or favorites', () => {
    for (const stream of ['code: 1617\nmessage: failed', '', '{"code":1}', 'code: 0x1']) {
      expect(() => parseStreamPhotoList(stream)).toThrow('有效的照片索引');
    }
    expect(parseStreamPhotoList('code: 0\n=\n')).toEqual([]);
  });
  it('maps device fields and preserves colons in paths', () => {
    const stream = [
      'code: 0',
      '=',
      'id: p1',
      'path: D:\\相册\\2024:旅行.jpg',
      'mtime: 1704067200',
      'stime: 3600000000',
    ].join('\n');
    expect(parseStreamPhotoList(stream)).toEqual([
      { member_id: 'p1', path: 'D:\\相册\\2024:旅行.jpg', modify_time: '1704067200', shot_time: '1704067200' },
    ]);
  });
  it('accepts revision headers from current firmware, including an empty favorites index', () => {
    const header = 'boot_id: fixture-boot\r\nuser_change_id: 67\r\ndelta: 0\r\n';
    expect(parseStreamPhotoList(header)).toEqual([]);
    expect(parseStreamPhotoList(header + '=\r\nid: 1791711593126000\r\npath: /相册/a.jpg\r\nsize: 5683286\r\nmtime: 1791711593000000\r\nstime: 1791711593126000')).toEqual([
      { member_id: '1791711593126000', path: '/相册/a.jpg', size: '5683286', modify_time: '1791711593000000', shot_time: '1791711593126000' },
    ]);
  });
  it('rejects failed, incomplete, ambiguous or incremental revision headers', () => {
    const valid = 'boot_id: fixture-boot\nuser_change_id: 67\ndelta: 0';
    for (const header of [valid + '\ncode: 1617', valid + '\ndelta: 1', valid.replace('delta: 0', 'delta: 1'), valid.replace('boot_id: fixture-boot', 'boot_id:'), valid.replace('user_change_id: 67', 'user_change_id: invalid'), 'boot_id: fixture-boot']) {
      expect(() => parseStreamPhotoList(header)).toThrow('有效的照片索引');
    }
    expect(() => parseStreamPhotoList(valid + '\n=\nid: 1\nsize: 100')).toThrow('索引不完整');
  });
});
