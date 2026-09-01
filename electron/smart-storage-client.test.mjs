import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildWebDavPath,
  extractPortCandidatesFromText,
  extractPortMappingsFromText,
  parseStreamPhotoList,
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

describe('WebDAV media paths', () => {
  it('removes the alias root and safely encodes every path segment', () => {
    expect(buildWebDavPath('/用户目录/照片/旅行 2026/海边#1.jpg', '/用户目录'))
      .toBe('/%E7%85%A7%E7%89%87/%E6%97%85%E8%A1%8C%202026/%E6%B5%B7%E8%BE%B9%231.jpg');
  });
});

describe('stream photo index parsing', () => {
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
});
