import { describe, expect, it } from 'vitest';
import { analyzeGroups, applyCleanupRemoval, canSelectPath, cleanupBatchPhotos, suggestedPaths, type AnalyzedPhoto } from './cleanup';
import { badReasons, computeFeatures, type ImageFeatures } from './cleanup-metrics';

const features = (overrides: Partial<ImageFeatures> = {}): ImageFeatures => ({
  dHash: 0x123456789abcdef0n, vHash: 0xfedcba9876543210n, color: Array(48).fill(120),
  sharpness: 100, mean: 120, std: 40, darkFrac: .01, brightFrac: .01, p95: 200,
  peakSharpness: 100, focusRatio: 2, anisotropy: .5, ...overrides,
});
const photo = (id: string, overrides: Partial<AnalyzedPhoto> = {}): AnalyzedPhoto => ({
  photo: { member_id: id, path: `/photos/${id}.jpg`, size: '4000000', shot_time: '1700000000', modify_time: '1700000000' },
  timeMs: 1_700_000_000_000, width: 512, height: 384, features: features(), protected: false, ...overrides,
});

describe('photo cleanup recommendations', () => {
  it('uses AI quality for burst selection while still protecting favorites', () => {
    const quality = { modelId: 'liqe-test-v1', quality: 4.5, probabilities: [0, 0, 0, .5, .5], scene: 'human', distortion: 'other', confidence: .5 };
    const result = analyzeGroups([
      photo('sharp-background', { quality: { ...quality, quality: 1.5, probabilities: [.5, .5, 0, 0, 0] }, features: features({ sharpness: 300 }), protected: true }),
      photo('better-subject', { quality, features: features({ sharpness: 50, peakSharpness: 35 }) }),
    ]);
    expect(result.groups[0].members.find(m => m.best)?.photo.member_id).toBe('better-subject');
    expect(result.groups[0].members.every(m => m.keep)).toBe(true);
    expect(suggestedPaths(result).size).toBe(0);
  });
  it('does not preselect a photo solely because AI predicts low quality', () => {
    const result = analyzeGroups([photo('ai-low', { quality: { modelId: 'liqe-test-v1', quality: 1.5, probabilities: [.5, .5, 0, 0, 0], scene: 'night', distortion: 'noise', confidence: .8 } })]);
    expect(result.bad[0].reasons).toContain('AI 判断可能噪声偏多');
    expect(suggestedPaths(result).size).toBe(0);
  });
  it('finds cross-date duplicate saves and keeps exactly one even with missing dates', () => {
    const result = analyzeGroups([photo('a', { timeMs: 0 }), photo('b', { timeMs: 1_800_000_000_000 })]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].kind).toBe('duplicate');
    expect(suggestedPaths(result).size).toBe(1);
  });
  it('keeps the clearer shot in a burst, and protects favorites', () => {
    const result = analyzeGroups([photo('blur', { features: features({ sharpness: 8, peakSharpness: 20 }), protected: true }), photo('clear')]);
    expect(result.groups[0].members.find((m) => m.best)?.photo.member_id).toBe('clear');
    expect(result.groups[0].members.every((m) => m.keep)).toBe(true);
    expect(suggestedPaths(result).size).toBe(0);
  });
  it('honors the requested number of keepers and refuses selection of the last keeper', () => {
    const result = analyzeGroups([photo('a'), photo('b'), photo('c')], { strictness: 'standard', keepCount: 2 });
    expect(suggestedPaths(result).size).toBe(1);
    expect(canSelectPath(result, new Set(['/photos/b.jpg', '/photos/c.jpg']), '/photos/a.jpg')).toBe(false);
    expect(canSelectPath(result, new Set(), '/photos/a.jpg')).toBe(true);
  });
  it('does not group lookalikes outside the burst time window unless duplicate', () => {
    const b = photo('b', { timeMs: 1_700_000_200_000, features: features({ dHash: 0x123456789abcdef0n ^ 0b111111n }) });
    expect(analyzeGroups([photo('a'), b]).groups).toHaveLength(0);
  });
  it('lists loosely framed similarity for manual review without preselecting it', () => {
    const b = photo('b', { features: features({ dHash: 0x123456789abcdef0n ^ 0xffffn }) });
    const result = analyzeGroups([photo('a'), b]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].nearIdentical).toBe(false);
    expect(suggestedPaths(result).size).toBe(0);
    expect(analyzeGroups([photo('a'), { ...b, features: features({ dHash: b.features.dHash, color: Array(48).fill(240) }) }]).groups).toHaveLength(0);
  });
  it('separates blank shots from similarity and does not preselect uncertain blur or screenshots', () => {
    const screenshot = photo('Screenshot_1', { features: features({ mean: 10, std: 2, p95: 12 }) });
    const result = analyzeGroups([photo('black', { features: features({ mean: 10, std: 2, p95: 12 }) }), screenshot, photo('maybe', { features: features({ peakSharpness: 35 }) })]);
    expect(result.groups).toHaveLength(0);
    expect(result.bad).toHaveLength(3);
    expect([...suggestedPaths(result)]).toEqual(['/photos/black.jpg']);
    const burst = analyzeGroups([photo('clear'), photo('uncertain', { features: features({ peakSharpness: 35, dHash: 0x123456789abcdef0n ^ 0b1111n }) })]);
    expect(burst.groups).toHaveLength(1);
    expect(suggestedPaths(burst).size).toBe(0);
  });
  it('deduplicates the index by file path and excludes favorites from bad shots', () => {
    const a = photo('a', { protected: true, features: features({ std: 2 }) });
    const result = analyzeGroups([a, a]);
    expect(result.analyzed).toBe(1);
    expect(result.bad).toHaveLength(0);
    expect(canSelectPath(result, new Set(), a.photo.path)).toBe(false);
  });
});

describe('cleanup batches and retained choices', () => {
  it('preserves a manually chosen keeper after removing the original recommendation', () => {
    const result = analyzeGroups([photo('a'), photo('b'), photo('c')]);
    expect(result.groups[0].members.find((m) => m.best)?.photo.member_id).toBe('a');
    const selected = new Set(['/photos/a.jpg', '/photos/b.jpg']);
    const after = applyCleanupRemoval(result, new Set(['/photos/a.jpg']), selected);
    expect(after.groups[0].members.find((m) => m.best)?.photo.member_id).toBe('c');
    expect([...suggestedPaths(after)]).toEqual(['/photos/b.jpg']);
    expect(canSelectPath(after, new Set(['/photos/b.jpg']), '/photos/c.jpg')).toBe(false);
  });
  it('handles more than 500 choices as successive explicit batches without dropping survivors', () => {
    const result = analyzeGroups(Array.from({ length: 501 }, (_, i) => photo(String(i), { features: features({ std: 2 }) })));
    const selected = suggestedPaths(result), batch = cleanupBatchPhotos(result.bad, selected);
    expect(batch).toHaveLength(500);
    const removed = new Set(batch.map((p) => p.path));
    const after = applyCleanupRemoval(result, removed, selected);
    const remaining = new Set([...selected].filter((path) => !removed.has(path)));
    expect(after.bad).toHaveLength(1);
    expect(cleanupBatchPhotos(after.bad, remaining)).toEqual([{ path: '/photos/500.jpg', member_id: '500', size: '4000000', modify_time: '1700000000' }]);
    expect(() => cleanupBatchPhotos(after.bad, new Set(['/missing.jpg']))).toThrow('过期');
  });
});

describe('image metrics', () => {
  const pixels = (width: number, height: number, value: (x: number, y: number) => number) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = value(x, y); rgba[i + 3] = 255; }
    return rgba;
  };
  it('has known horizontal and vertical fingerprints for directional gradients', () => {
    const horizontal = computeFeatures(pixels(90, 80, (x) => x * 2), 90, 80);
    const vertical = computeFeatures(pixels(80, 90, (_, y) => y * 2), 80, 90);
    expect(horizontal.dHash).toBe(0xffffffffffffffffn);
    expect(horizontal.vHash).toBe(0n);
    expect(vertical.dHash).toBe(0n);
    expect(vertical.vHash).toBe(0xffffffffffffffffn);
  });
  it('does not mistake small thumbnail upscaling for blurry originals', () => {
    const f = computeFeatures(pixels(32, 32, (x) => x * 6), 32, 32);
    expect(f.peakSharpness).toBe(-1);
    expect(badReasons(f)).toEqual([]);
  });
  it('recognizes a black accidental shot and preserves a sharp subject on a smooth background', () => {
    const black = computeFeatures(pixels(64, 64, () => 0), 64, 64);
    expect(black.darkFrac).toBe(1);
    expect(badReasons(black)).toEqual(['画面近乎纯色', '太暗']);
    const subject = computeFeatures(pixels(512, 512, (x, y) => x > 180 && x < 330 && y > 180 && y < 330 ? (x + y) % 2 * 255 : 128), 512, 512);
    expect(subject.focusRatio).toBeGreaterThan(10);
    expect(badReasons(subject)).not.toContain('模糊');
  });
});
