import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const { trashPhotos, validatePaths, validatePhotos } = createRequire(import.meta.url)('./cleanup-trash.cjs');
const a = { path: '/photos/a.jpg', member_id: 'a', modify_time: '1700000000', size: '2000000' }, b = { ...a, path: '/photos/b.jpg', member_id: 'b', size: '3000000' };
function fixture(favorites = []) {
  return {
    listPhotoIndex: vi.fn(async ({ albumId }) => albumId === '2' ? favorites : [a, b]),
    connect: vi.fn(async () => 41001),
    rawRequest: vi.fn(async () => ({ code: 0, data: { photos: [{ path: a.path, error: 0 }] } })),
  };
}
describe('device recycle-bin cleanup', () => {
  it('stops cleanup when the device changes during index reads, confirmation or connection', async () => {
    for (const phase of ['index', 'dialog', 'connect']) {
      const client = fixture();
      let valid = true;
      const assertSession = () => { if (!valid) throw new Error('设备连接已变化'); };
      if (phase === 'index') client.listPhotoIndex.mockImplementation(async ({ albumId }) => {
        valid = false; return albumId === '2' ? [] : [a, b];
      });
      if (phase === 'connect') client.connect.mockImplementation(async () => { valid = false; return 41001; });
      await expect(trashPhotos(client, [a], async () => { if (phase === 'dialog') valid = false; return true; }, assertSession)).rejects.toThrow('设备连接已变化');
      expect(client.rawRequest).not.toHaveBeenCalled();
    }
  });
  it('refuses old analysis before opening the confirmation dialog', async () => {
    for (const change of [{ modify_time: '1800000000' }, { size: '9000000' }, { member_id: 'replacement' }]) {
      const client = fixture(), confirm = vi.fn(async () => true);
      await expect(trashPhotos(client, [{ ...a, ...change }], confirm)).rejects.toThrow('分析后发生变化');
      expect(confirm).not.toHaveBeenCalled();
      expect(client.rawRequest).not.toHaveBeenCalled();
    }
  });
  it('rejects missing or conflicting snapshot metadata', () => {
    for (const photos of [[a.path], [{ path: a.path }], [a, { ...a, size: '9' }], [{ ...a, size: 'Infinity' }]]) {
      expect(() => validatePhotos(photos)).toThrow();
    }
  });
  it('validates bounds and rejects arbitrary files or video paths', () => {
    for (const paths of [[], ['/secret.txt'], ['/movie.mp4'], ['a\u0000.jpg'], Array(501).fill(a.path)]) expect(() => validatePaths(paths)).toThrow();
  });
  it('cancellation and favorite protection never issue a mutation', async () => {
    const client = fixture();
    expect((await trashPhotos(client, [a], async () => false)).cancelled).toBe(true);
    expect(client.rawRequest).not.toHaveBeenCalled();
    const protectedClient = fixture([a]);
    await expect(trashPhotos(protectedClient, [a], async () => true)).rejects.toThrow('收藏');
    expect(protectedClient.rawRequest).not.toHaveBeenCalled();
  });
  it('refuses unknown paths and a failed favorite read', async () => {
    const client = fixture();
    await expect(trashPhotos(client, [{ ...a, path: '/photos/unknown.jpg' }], async () => true)).rejects.toThrow('不在');
    client.listPhotoIndex.mockRejectedValueOnce(new Error('索引读取失败'));
    await expect(trashPhotos(client, [a], async () => true)).rejects.toThrow('索引读取失败');
    expect(client.rawRequest).not.toHaveBeenCalled();
  });
  it('rechecks favorites after the dialog and blocks changes made while it was open', async () => {
    const client = fixture();
    await expect(trashPhotos(client, [a], async () => {
      client.listPhotoIndex.mockImplementation(async ({ albumId }) => albumId === '2' ? [a] : [a, b]);
      return true;
    })).rejects.toThrow('收藏');
    expect(client.rawRequest).not.toHaveBeenCalled();
  });
  it('only uses recycle-bin deletion and reports individual or unconfirmed failures', async () => {
    const client = fixture();
    const confirm = vi.fn(async () => true);
    const result = await trashPhotos(client, [a, b, a], confirm);
    expect(confirm).toHaveBeenCalledWith({ count: 2, bytes: 5000000 });
    expect(client.rawRequest).toHaveBeenCalledWith(41001, '/cgi-bin/luci/album/del_photo', {
      uuid: '1', photos: [{ path: a.path }, { path: b.path }], notrash: 0,
    }, { timeout: 60000 });
    expect(result.deletedPaths).toEqual([a.path]);
    expect(result.failed).toEqual([{ path: b.path, message: expect.stringContaining('未确认') }]);
  });
  it('rejects a file replaced while the confirmation dialog was open', async () => {
    const client = fixture();
    await expect(trashPhotos(client, [a], async () => {
      client.listPhotoIndex.mockImplementation(async ({ albumId }) => albumId === '2' ? [] : [{ ...a, size: '9000000' }, b]);
      return true;
    })).rejects.toThrow('发生变化');
    expect(client.rawRequest).not.toHaveBeenCalled();
  });
  it('never retries a timeout or falls back to permanent deletion when the trash is full', async () => {
    const client = fixture();
    client.rawRequest.mockRejectedValueOnce(new Error('timeout'));
    await expect(trashPhotos(client, [a], async () => true)).rejects.toThrow('timeout');
    expect(client.rawRequest).toHaveBeenCalledTimes(1);
    client.rawRequest.mockResolvedValueOnce({ code: 1617 });
    await expect(trashPhotos(client, [a], async () => true)).rejects.toThrow('空间不足');
    expect(client.rawRequest).toHaveBeenCalledTimes(2);
  });
});
