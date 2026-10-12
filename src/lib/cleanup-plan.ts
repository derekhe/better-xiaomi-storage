import type { CleanupCachedPhoto, CleanupPhotoSnapshot, Photo, QualityScore } from '../types';
import type { ImageFeatures } from './cleanup-metrics';

export type PhotoMetrics = { width: number; height: number; features: ImageFeatures; quality?: QualityScore };
export const photoVersionKey = (p: CleanupPhotoSnapshot) => JSON.stringify([p.path, p.member_id, p.modify_time, p.size]);

export function cachePhoto(photo: Photo, metrics: PhotoMetrics | null, attemptedAt = Date.now()): CleanupCachedPhoto {
  return {
    photo: { path: photo.path, member_id: photo.member_id, modify_time: photo.modify_time, size: photo.size }, attemptedAt,
    metrics: metrics ? { ...metrics, features: { ...metrics.features, dHash: metrics.features.dHash.toString(16), vHash: metrics.features.vHash.toString(16) } } : null,
  };
}

export function restoreMetrics(entry: CleanupCachedPhoto): PhotoMetrics | null {
  return entry.metrics ? { ...entry.metrics, features: {
    ...entry.metrics.features, dHash: BigInt(`0x${entry.metrics.features.dHash}`), vHash: BigInt(`0x${entry.metrics.features.vHash}`),
  } } : null;
}

export function planCleanupScan(photos: Photo[], entries: CleanupCachedPhoto[], batchSize: number, retryFailed = false, modelId?: string) {
  const saved = new Map(entries.map((entry) => [photoVersionKey(entry.photo), entry]));
  const matched = new Map<string, CleanupCachedPhoto>();
  for (const photo of photos) {
    const entry = saved.get(photoVersionKey(photo));
    if (entry && (!entry.metrics || !modelId || entry.metrics.quality?.modelId === modelId)) matched.set(photo.path, entry);
  }
  const candidates = retryFailed
    ? photos.filter((p) => matched.get(p.path)?.metrics === null).sort((a, b) => matched.get(a.path)!.attemptedAt - matched.get(b.path)!.attemptedAt)
    : photos.filter((p) => !matched.has(p.path));
  return {
    matched, batch: candidates.slice(0, Math.max(1, Math.min(500, batchSize))),
    reused: [...matched.values()].filter((entry) => entry.metrics !== null).length,
  };
}
