/** Adapted from qingle-album Grouping.kt (Apache-2.0), Copyright 2026 木妈AIdea. */
import type { CleanupPhotoSnapshot, Photo, QualityScore } from '../types';
import { badReasons, blurLevel, colorDistance, excludedFromGrouping, hashDistance, type ImageFeatures } from './cleanup-metrics';
import { photoVersionKey } from './cleanup-plan';

export interface AnalyzedPhoto {
  photo: Photo;
  timeMs: number;
  width: number;
  height: number;
  protected: boolean;
  features: ImageFeatures;
  quality?: QualityScore;
}
export interface CleanupItem { photo: Photo; score: number; keep: boolean; best: boolean; protected: boolean; reasons: string[]; quality?: QualityScore }
export interface CleanupGroup { key: string; members: CleanupItem[]; kind: 'duplicate' | 'similar'; nearIdentical: boolean }
export interface CleanupResult { groups: CleanupGroup[]; bad: CleanupItem[]; analyzed: number }
export interface CleanupOptions { strictness: 'strict' | 'standard'; keepCount: number }
export const defaultCleanupOptions: CleanupOptions = { strictness: 'standard', keepCount: 1 };
export const isAnalyzablePhoto = (path: string) => /\.(jpe?g|png|webp|heic|heif|bmp|avif|tiff?)$/i.test(path);
const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function isDuplicate(a: AnalyzedPhoto, b: AnalyzedPhoto): boolean {
  const aspect = (p: AnalyzedPhoto) => Math.max(p.width, p.height) / Math.max(1, Math.min(p.width, p.height));
  return hashDistance(a.features, b.features) <= 3 && colorDistance(a.features, b.features) <= .02 && Math.abs(aspect(a) - aspect(b)) < .02;
}

function rankGroup(group: AnalyzedPhoto[], keepCount: number): CleanupGroup {
  const maxSize = group.reduce((max, p) => Math.max(max, Number(p.photo.size) || 0), 1);
  const scores = group.map((p, i) => {
    const f = p.features;
    const log = Math.log1p(Math.max(0, f.sharpness));
    let top = log;
    for (const other of group) if (hashDistance(f, other.features) <= 10) top = Math.max(top, Math.log1p(Math.max(0, other.features.sharpness)));
    const level = blurLevel(f), absolute = level === 2 ? .15 : level === 1 ? .6 : 1;
    let exposure = 1 - Math.min(1, f.brightFrac * 3) * .6 - Math.min(1, f.darkFrac * 2) * .4;
    if (f.mean < 50) exposure -= (50 - f.mean) / 50 * .4;
    if (f.mean > 215) exposure -= (f.mean - 215) / 40 * .4;
    const rule = .97 * (.8 * clamp((log - top) / 1.5 + 1) * absolute + .2 * clamp(exposure)) + .03 * (Number(p.photo.size) || 0) / maxSize;
    return (p.quality ? .8 * clamp((p.quality.quality - 1) / 4) + .2 * rule : rule) - i * .0001;
  });
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const best = group[order[0]];
  const keep = new Set(order.slice(0, Math.max(1, keepCount)));
  const duplicate = group.every((p) => isDuplicate(p, best) && Math.abs(Math.log1p(Math.max(0, p.features.sharpness)) - Math.log1p(Math.max(0, best.features.sharpness))) < .12);
  const nearIdentical = group.every((p) => hashDistance(p.features, best.features) <= 10);
  return {
    key: group[0].photo.path, kind: duplicate ? 'duplicate' : 'similar', nearIdentical,
    members: group.map((p, i) => ({
      photo: p.photo, quality: p.quality, score: Math.round(clamp(scores[i]) * 100), keep: keep.has(i) || p.protected,
      best: i === order[0], protected: p.protected,
      reasons: p.protected ? ['已收藏'] : i === order[0] ? ['推荐保留'] : duplicate ? ['画面重复'] : photoReasons(p).length ? photoReasons(p) : ['画面相似'],
    })),
  };
}

export function photoReasons(p: Pick<AnalyzedPhoto, 'features' | 'quality'>): string[] {
  const reasons = badReasons(p.features), q = p.quality;
  if (!q) return reasons;
  const out = q.quality >= 3.5 ? reasons.filter(r => r !== '模糊' && r !== '可能模糊') : reasons;
  if (q.quality <= 2 && q.probabilities[0] + q.probabilities[1] >= .7) {
    const labels: Record<string, string> = { blur: 'AI 判断可能模糊', noise: 'AI 判断可能噪声偏多', overexposure: 'AI 判断可能过曝', underexposure: 'AI 判断可能欠曝' };
    out.push(q.confidence >= .45 ? labels[q.distortion] || 'AI 画质偏低' : 'AI 画质偏低');
  }
  return out;
}

export function analyzeGroups(input: AnalyzedPhoto[], options = defaultCleanupOptions): CleanupResult {
  // One file can appear in several device albums. Never count or select it twice.
  const unique = [...new Map(input.map((p) => [p.photo.path, p])).values()];
  const photos = unique.filter((p) => !excludedFromGrouping(p.features)).sort((a, b) => a.timeMs - b.timeMs);
  const strict = options.strictness === 'strict' ? 10 : 14, loose = options.strictness === 'strict' ? 22 : 30;
  const maxColor = options.strictness === 'strict' ? .045 : .06;
  const parents = photos.map((_, i) => i);
  const find = (x: number): number => { let root = x; while (parents[root] !== root) root = parents[root]; while (parents[x] !== x) { const next = parents[x]; parents[x] = root; x = next; } return root; };
  const union = (a: number, b: number) => { parents[find(a)] = find(b); };
  const active: { anchor: number; recent: number[]; lastTime: number }[] = [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    // Missing dates may participate only in cross-date duplicate detection.
    if (!p.timeMs) continue;
    for (let j = active.length - 1; j >= 0; j--) if (p.timeMs - active[j].lastTime > 120_000) active.splice(j, 1);
    let best: typeof active[number] | undefined, distance = Infinity;
    for (const g of active) {
      if (hashDistance(photos[g.anchor].features, p.features) > loose + 10) continue;
      for (const m of g.recent) {
        const h = hashDistance(photos[m].features, p.features), c = colorDistance(photos[m].features, p.features);
        if (h <= loose && c <= maxColor * (h <= strict ? 2 : 1) && h < distance) { best = g; distance = h; }
      }
    }
    if (best) { union(i, best.anchor); best.recent.push(i); if (best.recent.length > 6) best.recent.shift(); best.lastTime = p.timeMs; }
    else active.push({ anchor: i, recent: [i], lastTime: p.timeMs });
  }
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < photos.length; i++) for (let k = 0; k < 4; k++) {
    const key = `${k}:${(photos[i].features.dHash >> BigInt(k * 16)) & 65535n}`;
    const list = buckets.get(key) || []; list.push(i); buckets.set(key, list);
  }
  for (const list of buckets.values()) {
    if (list.length > 300) continue; // Flat skies create large buckets: avoid quadratic comparisons.
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const a = list[x], b = list[y];
      if (find(a) !== find(b) && isDuplicate(photos[a], photos[b])) union(a, b);
    }
  }
  const components = new Map<number, AnalyzedPhoto[]>();
  for (let i = 0; i < photos.length; i++) { const key = find(i), list = components.get(key) || []; list.push(photos[i]); components.set(key, list); }
  const groups = [...components.values()].filter((g) => g.length > 1).map((g) => rankGroup(g, options.keepCount));
  const grouped = new Set(groups.flatMap((g) => g.members.map((p) => p.photo.path)));
  const bad = unique.filter((p) => !p.protected && !grouped.has(p.photo.path)).flatMap((p) => {
    const reasons = photoReasons(p);
    return reasons.length ? [{ photo: p.photo, quality: p.quality, reasons, keep: reasons.every((r) => r === '可能模糊' || r.startsWith('AI ')), best: false, protected: false, score: 0 }] : [];
  });
  return { groups, bad, analyzed: unique.length };
}

export function suggestedPaths(result: CleanupResult): Set<string> {
  // Without OCR, different pages can look alike. Only close framing is preselected.
  return new Set([
    ...result.groups.filter((g) => g.nearIdentical).flatMap((g) => g.members.filter((m) => !m.keep && !m.protected && !m.reasons.includes('可能模糊') && !/screenshot|屏幕截图|截屏|证件|document|scan/i.test(m.photo.path)).map((m) => m.photo.path)),
    ...result.bad.filter((m) => !m.keep && !/screenshot|屏幕截图|截屏|证件|document|scan/i.test(m.photo.path)).map((m) => m.photo.path),
  ]);
}

export function canSelectPath(result: CleanupResult, selected: Set<string>, path: string): boolean {
  const group = result.groups.find((g) => g.members.some((m) => m.photo.path === path));
  if (!group) return result.bad.some((m) => m.photo.path === path && !m.protected);
  return !group.members.find((m) => m.photo.path === path)!.protected && group.members.some((m) => m.photo.path !== path && !selected.has(m.photo.path));
}

export interface CleanupDecision { version: string; remove: boolean }
export function selectionWithDecisions(result: CleanupResult, decisions: Map<string, CleanupDecision>): Set<string> {
  const selected = suggestedPaths(result);
  const items = new Map([...result.groups.flatMap((g) => g.members), ...result.bad].map((m) => [m.photo.path, m]));
  const valid = [...decisions].filter(([path, d]) => items.has(path) && photoVersionKey(items.get(path)!.photo) === d.version);
  for (const [path, d] of valid) if (!d.remove) selected.delete(path);
  for (const [path, d] of valid) if (d.remove && canSelectPath(result, selected, path)) selected.add(path);
  return selected;
}

export function cleanupBatchPhotos(items: CleanupItem[], selected: Set<string>): CleanupPhotoSnapshot[] {
  const chosen = items.filter((item) => selected.has(item.photo.path));
  if (chosen.length !== selected.size) throw new Error('清理选择已过期，请重新分析');
  return chosen.slice(0, 500).map(({ photo }) => ({
    path: photo.path, member_id: photo.member_id, modify_time: photo.modify_time, size: photo.size,
  }));
}

export function applyCleanupRemoval<T extends CleanupResult>(result: T, removed: Set<string>, selected: Set<string>): T {
  return {
    ...result,
    groups: result.groups.flatMap((group) => {
      if (!group.members.some((m) => removed.has(m.photo.path))) return [group];
      const members = group.members.filter((m) => !removed.has(m.photo.path));
      if (members.length < 2) return [];
      const keepers = members.filter((m) => m.protected || !selected.has(m.photo.path));
      const best = (keepers.length ? keepers : members).reduce((a, b) => a.score >= b.score ? a : b);
      return [{ ...group, members: members.map((m) => {
        const keep = m === best || m.protected || !selected.has(m.photo.path);
        const reasons = m.protected ? ['已收藏'] : m === best ? ['推荐保留'] : m.reasons.filter((r) => r !== '推荐保留');
        return { ...m, keep, best: m === best, reasons: reasons.length ? reasons : [group.kind === 'duplicate' ? '画面重复' : '画面相似'] };
      }) }];
    }),
    bad: result.bad.filter((m) => !removed.has(m.photo.path)),
  };
}
