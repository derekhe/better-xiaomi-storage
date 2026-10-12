import type { SmartStorageApi, CleanupAnalysisParams } from '../types';
import { scanPhotos } from './cleanup-scan';

const host = window.analysisHost!;
const controller = new AbortController();
host.onPause(() => controller.abort());
host.onStart(async (params: CleanupAnalysisParams & { jobId: number; modelId?: string }) => {
  const indexes = new Map<string, Promise<Awaited<ReturnType<SmartStorageApi['listPhotoIndex']>>>>();
  // One fresh index per job; batches share it. Deletion always checks the NAS again.
  const api = {
    ...host,
    listPhotoIndex: (input: { albumId: string }) => {
      if (!indexes.has(input.albumId)) indexes.set(input.albumId, host.listPhotoIndex(input));
      return indexes.get(input.albumId)!;
    },
  };
  let previous = -1;
  try {
    do {
      const result = await scanPhotos({ api, demoPhotos: [], options: params.options, batchSize: params.batchSize,
        modelId: params.modelId, retryFailed: params.retryFailed, signal: controller.signal,
        onProgress: progress => { void host.update(params.jobId, { type: 'progress', progress }); } });
      await host.update(params.jobId, { type: 'result', result });
      if (!result.remaining || params.retryFailed || result.remaining === previous) break;
      previous = result.remaining;
      // Yield between checkpoints so pause commands can be handled promptly.
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (!controller.signal.aborted);
    await host.update(params.jobId, { type: controller.signal.aborted ? 'paused' : 'completed', message: controller.signal.aborted ? '分析已暂停，进度已保存' : '后台分析已完成' });
  } catch (reason) {
    await host.update(params.jobId, { type: controller.signal.aborted ? 'paused' : 'error', message: controller.signal.aborted ? '分析已暂停，进度已保存' : reason instanceof Error ? reason.message : '后台分析失败' });
  }
});
