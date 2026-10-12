import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
const { CleanupCache, cleanupScope, validateEntries } = createRequire(import.meta.url)('./cleanup-cache.cjs');
const roots = [];
const encryption = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`sealed:${Buffer.from(s).toString('base64')}`), decryptString: (b) => { if (!b.toString().startsWith('sealed:')) throw new Error('bad'); return Buffer.from(b.toString().slice(7), 'base64').toString(); } };
const entry = (id, size = '1000') => ({ photo: { path: `/photos/${id}.jpg`, member_id: id, modify_time: '1700000000', size }, attemptedAt: 1, metrics: null });
async function fixture() { const root = await mkdtemp(path.join(os.tmpdir(), 'xiaomi-cache-test-')); roots.push(root); return { root, cache: new CleanupCache({ root, safeStorage: encryption }) }; }
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}xiaomi-cache-test-`)) throw new Error('Invalid test cleanup target'); await rm(root, { recursive: true, force: true }); } });
describe('durable local photo analysis', () => {
  it('persists bounded AI scores and rejects corrupt model probabilities', async () => {
    const { cache } = await fixture(), scope = cleanupScope('u', 'd');
    const quality = { modelId: 'liqe-test-v1', quality: 4, probabilities: [0, 0, 0, 1, 0], scene: 'human', distortion: 'other', confidence: .6 };
    const scored = { ...entry('a'), metrics: { width: 512, height: 384, quality, features: { dHash: 'ff', vHash: 'ee', color: Array(48).fill(100), sharpness: 10, mean: 100, std: 40, darkFrac: 0, brightFrac: 0, p95: 200, peakSharpness: 10, focusRatio: 1, anisotropy: 1 } } };
    await cache.save(scope, [scored]); expect((await cache.load(scope))[0].metrics.quality).toEqual(quality);
    expect(() => validateEntries([{ ...scored, metrics: { ...scored.metrics, quality: { ...quality, probabilities: [1, 1, 1, 1, 1] } } }])).toThrow('AI 评分');
  });
  it('restores checkpoints after restarting and keeps the newest revision', async () => {
    const { root, cache } = await fixture(), scope = cleanupScope('user', 'device');
    await cache.save(scope, [entry('a')]); await cache.save(scope, [entry('a', '2000'), entry('b')]);
    expect(await new CleanupCache({ root, safeStorage: encryption }).load(scope)).toEqual([entry('a', '2000'), entry('b')]);
    const file = (await readdir(path.join(root, scope)))[0];
    expect((await readFile(path.join(root, scope, file))).toString()).not.toContain('/photos/');
  });
  it('isolates accounts and devices and rejects traversal', async () => {
    const { cache } = await fixture(), scope = cleanupScope('u1', 'd1');
    await cache.save(scope, [entry('a')]);
    expect(await cache.load(cleanupScope('u2', 'd1'))).toEqual([]);
    expect(await cache.load(cleanupScope('u1', 'd2'))).toEqual([]);
    expect(() => cache.load('../outside')).toThrow();
    expect(() => cleanupScope('', 'd1')).toThrow();
  });
  it('can reset corrupt checkpoints without deleting another device', async () => {
    const { root, cache } = await fixture(), a = cleanupScope('u', 'a'), b = cleanupScope('u', 'b');
    await cache.save(a, [entry('a')]); await cache.save(b, [entry('b')]);
    const file = (await readdir(path.join(root, a)))[0]; await writeFile(path.join(root, a, file), 'corrupt');
    const reopened = new CleanupCache({ root, safeStorage: encryption });
    await expect(reopened.load(a)).rejects.toThrow('无法读取');
    await reopened.clear(a); expect(await reopened.load(a)).toEqual([]); expect(await reopened.load(b)).toEqual([entry('b')]);
  });
  it('refuses plaintext fallback or malformed feature packets', async () => {
    const { root } = await fixture();
    await expect(new CleanupCache({ root, safeStorage: { ...encryption, isEncryptionAvailable: () => false } }).save(cleanupScope('u', 'd'), [entry('a')])).rejects.toThrow('加密不可用');
    expect(() => validateEntries([{ ...entry('a'), metrics: { width: 512, height: 384, features: {} } }])).toThrow('特征无效');
  });
});
