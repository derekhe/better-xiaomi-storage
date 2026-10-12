import type { CleanupCachedPhoto, Photo, SmartStorageApi, QualityScore } from '../types';
import { photoDate } from './date';
import { isAnalyzablePhoto, type AnalyzedPhoto, type CleanupOptions, type CleanupResult } from './cleanup';
import { cachePhoto, planCleanupScan, restoreMetrics, type PhotoMetrics } from './cleanup-plan';

export interface ScanProgress { done: number; total: number; failed: number; batchDone: number; batchTotal: number; phase: 'index' | 'photos' | 'groups' | 'saving' }
export interface ScanResult extends CleanupResult { failed: number; total: number; remaining: number; reused: number; processed: number }
const demoCache = new Map<string, CleanupCachedPhoto>();
export function clearDemoCleanupCache() { demoCache.clear(); }
const aborted = () => new DOMException('分析已暂停', 'AbortError');

export async function scanPhotos({ api, demoPhotos, options, signal, onProgress, batchSize = 200, retryFailed = false, modelId }: {
  api?: Pick<SmartStorageApi, 'listPhotoIndex' | 'loadCleanupCache' | 'saveCleanupCache' | 'getThumbnail'> & { scorePhoto?: (url: string) => Promise<QualityScore> }; demoPhotos: Photo[]; options: CleanupOptions; signal: AbortSignal; onProgress: (p: ScanProgress) => void;
  batchSize?: number; retryFailed?: boolean; modelId?: string;
}): Promise<ScanResult> {
  const worker = new Worker(new URL('./cleanup.worker.ts', import.meta.url), { type: 'module' });
  let id = 0, fatalError: Error | null = null, scope = '';
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
  const cancel = () => { for (const task of pending.values()) task.reject(aborted()); pending.clear(); worker.terminate(); };
  signal.addEventListener('abort', cancel, { once: true });
  worker.onmessage = (event) => {
    const task = pending.get(event.data.id);
    if (!task) return;
    pending.delete(event.data.id);
    if (event.data.error) task.reject(new Error(event.data.error)); else task.resolve(event.data.value);
  };
  worker.onerror = () => {
    fatalError = new Error('分析线程启动失败，请重新打开应用后重试');
    for (const task of pending.values()) task.reject(fatalError);
    pending.clear();
  };
  const call = <T>(request: object, transfer: Transferable[] = []): Promise<T> => {
    if (signal.aborted) return Promise.reject(aborted());
    if (fatalError) return Promise.reject(fatalError);
    return new Promise((resolve, reject) => {
      const nextId = ++id;
      pending.set(nextId, { resolve: (value) => resolve(value as T), reject });
      worker.postMessage({ ...request, id: nextId }, transfer);
    });
  };
  const interruptible = <T>(task: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const stop = () => reject(aborted());
    if (signal.aborted) { task.catch(() => {}); reject(aborted()); return; }
    signal.addEventListener('abort', stop, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
  const unsaved: CleanupCachedPhoto[] = [];
  let saveQueue = Promise.resolve();
  const flush = () => {
    const packet = unsaved.splice(0);
    if (packet.length) saveQueue = saveQueue.then(async () => {
      if (api) await api.saveCleanupCache({ scope, entries: packet });
      else for (const entry of packet) demoCache.set(entry.photo.path, entry);
    });
    return saveQueue;
  };
  try {
    if (signal.aborted) throw aborted();
    onProgress({ phase: 'index', done: 0, total: 0, failed: 0, batchDone: 0, batchTotal: 0 });
    const [index, favorites, cache] = api ? await interruptible(Promise.all([
      api.listPhotoIndex({ albumId: '1' }), api.listPhotoIndex({ albumId: '2' }), api.loadCleanupCache(),
    ])) : [demoPhotos, [], { scope: 'demo', entries: [...demoCache.values()] }];
    scope = cache.scope;
    const protectedPaths = new Set(favorites.map((p) => p.path));
    const photos = [...new Map(index.filter((p) => isAnalyzablePhoto(p.path)).map((p) => [p.path, p])).values()];
    const plan = planCleanupScan(photos, cache.entries, batchSize, retryFailed, modelId);
    let next = 0, batchDone = 0, failed = [...plan.matched.values()].filter((entry) => entry.metrics === null).length;
    const report = (phase: ScanProgress['phase'] = 'photos') => onProgress({ phase, done: plan.matched.size, total: photos.length, failed, batchDone, batchTotal: plan.batch.length });
    report();
    async function consume() {
      while (next < plan.batch.length) {
        if (signal.aborted) throw aborted();
        const photo = plan.batch[next++];
        let metrics: PhotoMetrics | null = null;
        try {
          const url = photo.mockUrl || await interruptible(api!.getThumbnail({ photoPath: photo.path, quality: 'preview', refresh: true }));
          const response = await fetch(url, { signal, cache: 'no-store' });
          if (!response.ok) throw new Error('读取预览图失败');
          const bitmap = await createImageBitmap(await response.blob());
          if (signal.aborted) { bitmap.close(); throw aborted(); }
          metrics = await call<PhotoMetrics>({ type: 'metrics', bitmap }, [bitmap]);
          if (modelId && api?.scorePhoto) metrics.quality = await interruptible(api.scorePhoto(url));
        } catch (reason) {
          if (signal.aborted) throw aborted();
          if (fatalError) throw fatalError;
          if (modelId && /LIQE.*(启动|初始化|退出|超时|校验|停止|准备)/.test(reason instanceof Error ? reason.message : String(reason))) throw reason;
          // Never present rule-only output as an AI-scored result after an inference failure.
          if (modelId) metrics = null;
        }
        if (plan.matched.get(photo.path)?.metrics === null) failed--;
        if (!metrics) failed++;
        const entry = cachePhoto(photo, metrics);
        plan.matched.set(photo.path, entry); unsaved.push(entry); batchDone++;
        if (unsaved.length >= 20) await flush();
        report();
      }
    }
    await Promise.all([consume(), consume()]);
    if (signal.aborted) throw aborted();
    report('saving'); await flush();
    const analyzed: AnalyzedPhoto[] = [];
    for (const photo of photos) {
      const entry = plan.matched.get(photo.path), metrics = entry ? restoreMetrics(entry) : null;
      if (metrics) analyzed.push({ photo, ...metrics, protected: protectedPaths.has(photo.path), timeMs: photoDate(photo).getTime() });
    }
    report('groups');
    const result = await call<CleanupResult>({ type: 'groups', photos: analyzed, options });
    return { ...result, failed, total: photos.length, remaining: photos.length - plan.matched.size, reused: plan.reused, processed: batchDone };
  } finally {
    // Save completed photos even when paused; an in-flight read may need to be repeated.
    try { await flush(); }
    finally { signal.removeEventListener('abort', cancel); cancel(); }
  }
}
