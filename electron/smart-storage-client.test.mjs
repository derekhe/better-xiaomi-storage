import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { extractPortCandidatesFromText, parseStreamPhotoList } = require('./smart-storage-client.cjs');

describe('P2P port discovery', () => {
  it('prefers the latest port and removes duplicates', () => {
    const log = [
      'p2pport={"urlport":"41001","webdavport":"41002"}',
      'url=https://127.0.0.1:42001/cgi-bin/luci/plugincenter/get_access_token',
      'port=42001 hasToken=true',
    ].join('\n');
    expect(extractPortCandidatesFromText(log)).toEqual([42001, 41001]);
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
