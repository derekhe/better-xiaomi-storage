import { computeFeatures } from './cleanup-metrics';
import { analyzeGroups, type AnalyzedPhoto, type CleanupOptions } from './cleanup';

type Request = { id: number; type: 'metrics'; bitmap: ImageBitmap } | { id: number; type: 'groups'; photos: AnalyzedPhoto[]; options: CleanupOptions };
// CPU work and canvas sampling stay off the gallery's UI thread.
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.type === 'groups') {
      self.postMessage({ id: request.id, value: analyzeGroups(request.photos, request.options) });
      return;
    }
    const bitmap = request.bitmap;
    try {
      const edge = Math.max(bitmap.width, bitmap.height), scale = Math.min(1, 512 / edge);
      const width = Math.max(9, Math.round(bitmap.width * scale)), height = Math.max(9, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('图片分析不可用');
      context.drawImage(bitmap, 0, 0, width, height);
      self.postMessage({ id: request.id, value: { features: computeFeatures(context.getImageData(0, 0, width, height).data, width, height, edge), width: bitmap.width, height: bitmap.height } });
    } finally { bitmap.close(); }
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : '分析失败' });
  }
};
