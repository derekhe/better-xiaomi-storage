import { describe, expect, it } from 'vitest';
import { cachePhoto, planCleanupScan, restoreMetrics } from './cleanup-plan';
import { analyzeGroups, selectionWithDecisions } from './cleanup';
import { photoVersionKey, type PhotoMetrics } from './cleanup-plan';
import type { Photo } from '../types';
const photo = (id: string): Photo => ({ path: `/p/${id}.jpg`, member_id: id, modify_time: '1700000000', shot_time: '1700000000', size: '1000' });
const metrics: PhotoMetrics = { width: 512, height: 384, features: { dHash: 0xffffffffffffffffn, vHash: 0n, color: Array(48).fill(100), sharpness: 100, peakSharpness: 100, mean: 100, std: 40, darkFrac: 0, brightFrac: 0, p95: 150, focusRatio: 2, anisotropy: 1 } };
describe('incremental local analysis', () => {
  it('upgrades rule-only records and reuses only the requested AI model version', () => {
    const a = photo('a'), b = photo('b'), c = photo('c');
    const quality = { modelId: 'liqe-test-v1', quality: 4, probabilities: [0, 0, 0, 1, 0], scene: 'human', distortion: 'other', confidence: .5 };
    const saved = [cachePhoto(a, metrics), cachePhoto(b, { ...metrics, quality }), cachePhoto(c, { ...metrics, quality: { ...quality, modelId: 'liqe-old' } })];
    const plan = planCleanupScan([a, b, c], saved, 50, false, 'liqe-test-v1');
    expect(plan.batch).toEqual([a, c]); expect(plan.reused).toBe(1);
    expect(restoreMetrics(saved[1])?.quality).toEqual(quality);
  });
  it('resumes only the unprocessed photos and preserves 64-bit fingerprints', () => {
    const photos = Array.from({ length: 75 }, (_, i) => photo(String(i)));
    const saved = photos.slice(0, 50).map((p) => cachePhoto(p, metrics));
    const plan = planCleanupScan(photos, saved, 50);
    expect(plan.reused).toBe(50); expect(plan.batch).toEqual(photos.slice(50));
    expect(restoreMetrics(saved[0])).toEqual(metrics);
  });
  it('re-reads changed files and excludes records for removed photos', () => {
    const a = photo('a'), changed = { ...a, modify_time: '1800000000' }, b = photo('b');
    const plan = planCleanupScan([changed, b], [cachePhoto(a, metrics), cachePhoto(photo('removed'), metrics)], 200);
    expect(plan.reused).toBe(0); expect(plan.batch).toEqual([changed, b]);
  });
  it('skips failed records until explicitly retried and prioritizes the oldest failures', () => {
    const a = photo('a'), b = photo('b'), c = photo('c');
    const saved = [cachePhoto(a, null, 20), cachePhoto(b, null, 10)];
    expect(planCleanupScan([a, b, c], saved, 50).batch).toEqual([c]);
    expect(planCleanupScan([a, b, c], saved, 1, true).batch).toEqual([b]);
  });
  it('keeps reviewed choices across batches without applying them to replaced files', () => {
    const input = ['a', 'b', 'c'].map((id) => ({ photo: photo(id), ...metrics, timeMs: 1, protected: false }));
    const result = analyzeGroups(input);
    const decisions = new Map([['/p/b.jpg', { version: photoVersionKey(photo('b')), remove: false }], ['/p/a.jpg', { version: photoVersionKey(photo('a')), remove: true }]]);
    const selected = selectionWithDecisions(result, decisions);
    expect(selected.has('/p/b.jpg')).toBe(false); expect(selected.has('/p/a.jpg')).toBe(true);
    const changed = analyzeGroups(input.map((p) => p.photo.member_id === 'a' ? { ...p, photo: { ...p.photo, size: '9999' } } : p));
    expect(selectionWithDecisions(changed, decisions).has('/p/a.jpg')).toBe(false);
  });
});
