const PHOTO_PATH = /\.(jpe?g|png|webp|heic|heif|bmp|avif|tiff?)$/i;

function validatePaths(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 500) throw new Error('每次请选择 1–500 张照片');
  if (paths.some((p) => typeof p !== 'string' || !p || p.length > 4096 || /[\x00-\x1f]/.test(p) || !PHOTO_PATH.test(p))) throw new Error('清理照片路径无效');
  return [...new Set(paths)];
}

function validatePhotos(photos) {
  if (!Array.isArray(photos)) throw new Error('清理照片信息无效，请重新分析');
  validatePaths(photos.map((p) => p?.path));
  if (photos.some((p) => ['member_id', 'modify_time', 'size'].some((field) =>
    typeof p[field] !== 'string' || !p[field] || p[field].length > 256)
    || !/^\d+$/.test(p.size) || !Number.isSafeInteger(Number(p.size)))) {
    throw new Error('清理照片信息不完整，请重新分析');
  }
  const unique = new Map();
  for (const photo of photos) {
    const previous = unique.get(photo.path);
    if (previous && ['member_id', 'modify_time', 'size'].some((field) => previous[field] !== photo[field])) {
      throw new Error('同一照片的清理信息不一致，请重新分析');
    }
    unique.set(photo.path, { path: photo.path, member_id: photo.member_id, modify_time: photo.modify_time, size: photo.size });
  }
  return [...unique.values()];
}

async function trashPhotos(client, requestedPhotos, confirm, assertSession = () => {}) {
  const snapshots = validatePhotos(requestedPhotos);
  const paths = snapshots.map((p) => p.path);
  const readState = async () => {
    assertSession();
    const [all, favorites] = await Promise.all([
      client.listPhotoIndex({ albumId: '1' }), client.listPhotoIndex({ albumId: '2' }),
    ]);
    assertSession();
    const known = new Map(all.map((p) => [p.path, p]));
    const protectedPaths = new Set(favorites.map((p) => p.path));
    if (paths.some((p) => !known.has(p))) throw new Error('部分照片已不在设备相册中，请重新分析');
    if (paths.some((p) => protectedPaths.has(p))) throw new Error('所选照片包含收藏，请取消勾选收藏照片');
    if (snapshots.some((photo) => ['modify_time', 'size', 'member_id'].some((field) => String(known.get(photo.path)[field]) !== photo[field]))) {
      throw new Error('所选照片在分析后发生变化，请重新分析');
    }
    return known;
  };
  const known = await readState();
  const bytes = paths.reduce((sum, p) => sum + (Number(known.get(p).size) || 0), 0);
  if (!await confirm({ count: paths.length, bytes })) return { cancelled: true, deletedPaths: [], failed: [] };
  // The user may leave the native dialog open while the library changes.
  await readState();
  // Match the official Windows client's del_photo payload. Never retry a mutation
  // after a timeout, and never fall back to notrash:1 (permanent deletion).
  const port = await client.connect();
  assertSession();
  const response = await client.rawRequest(port, '/cgi-bin/luci/album/del_photo', {
    uuid: '1', photos: paths.map((path) => ({ path })), notrash: 0,
  }, { timeout: 60000 });
  if (response?.code !== 0) {
    throw new Error(response?.code === 1617 ? '设备空间不足，无法移入回收站' : '设备未确认清理成功，请刷新相册后检查结果');
  }
  const records = response?.data?.photos;
  if (!Array.isArray(records)) throw new Error('设备没有返回逐张清理结果，请刷新相册后检查结果');
  const byPath = new Map(records.filter((r) => typeof r?.path === 'string').map((r) => [r.path, r]));
  const deletedPaths = [], failed = [];
  for (const path of paths) {
    const record = byPath.get(path);
    if (record && (record.error === 0 || record.error === undefined)) deletedPaths.push(path);
    else failed.push({ path, message: record?.error === 1617 ? '设备空间不足，无法移入回收站' : '设备未确认这张照片已移入回收站' });
  }
  return { cancelled: false, deletedPaths, failed };
}

module.exports = { validatePaths, validatePhotos, trashPhotos };
