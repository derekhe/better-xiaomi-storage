/**
 * Ported and adapted from qingle-album ImageMetrics.kt / BadShotRules (Apache-2.0).
 * Copyright 2026 木妈AIdea. See THIRD_PARTY_NOTICES.md.
 */
export interface ImageFeatures {
  dHash: bigint;
  vHash: bigint;
  color: number[];
  sharpness: number;
  mean: number;
  std: number;
  darkFrac: number;
  brightFrac: number;
  p95: number;
  peakSharpness: number;
  focusRatio: number;
  anisotropy: number;
}

const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
const topMean = (values: number[], count: number) => [...values].sort((a, b) => b - a).slice(0, count).reduce((a, b) => a + b, 0) / count;

export function computeFeatures(rgba: Uint8ClampedArray, w: number, h: number, sourceLongEdge = Math.max(w, h)): ImageFeatures {
  if (w < 9 || h < 9 || rgba.length < w * h * 4) throw new Error('图片尺寸不足');
  const n = w * h;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    gray[i] = Math.floor((rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000);
    hist[gray[i]]++;
  }
  let sum = 0, sq = 0, dark = 0, bright = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * hist[i]; sq += i * i * hist[i];
    if (i < 16) dark += hist[i];
    if (i > 250) bright += hist[i];
  }
  const percentile = (q: number) => {
    let acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= Math.floor(n * q)) return i; }
    return 255;
  };
  const resize = (tw: number, th: number) => {
    const out = new Float64Array(tw * th);
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor(tx * w / tw), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * w / tw));
      const y0 = Math.floor(ty * h / th), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * h / th));
      let value = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) value += gray[y * w + x];
      out[ty * tw + tx] = value / ((x1 - x0) * (y1 - y0));
    }
    return out;
  };
  const horizontal = resize(9, 8), vertical = resize(8, 9);
  let dHash = 0n, vHash = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    dHash = (dHash << 1n) | (horizontal[y * 9 + x] < horizontal[y * 9 + x + 1] - 1.5 ? 1n : 0n);
    vHash = (vHash << 1n) | (vertical[y * 8 + x] < vertical[(y + 1) * 8 + x] - 1.5 ? 1n : 0n);
  }
  const color: number[] = [];
  for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
    const x0 = Math.floor(tx * w / 4), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * w / 4));
    const y0 = Math.floor(ty * h / 4), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * h / 4));
    let r = 0, g = 0, b = 0, count = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const i = (y * w + x) * 4;
      r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; count++;
    }
    color.push(Math.floor(r / count), Math.floor(g / count), Math.floor(b / count));
  }
  const sums = Array.from({ length: 4 }, () => new Float64Array(64));
  const squares = Array.from({ length: 4 }, () => new Float64Array(64));
  const counts = new Uint32Array(64);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, c2 = 2 * gray[i];
    const ds = [c2 - gray[i - 1] - gray[i + 1], c2 - gray[i - w] - gray[i + w],
      c2 - gray[i - w - 1] - gray[i + w + 1], c2 - gray[i - w + 1] - gray[i + w - 1]];
    const t = Math.min(7, Math.floor(y * 8 / h)) * 8 + Math.min(7, Math.floor(x * 8 / w));
    for (let k = 0; k < 4; k++) { sums[k][t] += ds[k]; squares[k][t] += ds[k] * ds[k]; }
    counts[t]++;
  }
  const variances = sums.map((s, k) => Array.from(s, (v, t) => counts[t] ? Math.max(0, squares[k][t] / counts[t] - (v / counts[t]) ** 2) : 0));
  const iso = Array.from({ length: 64 }, (_, t) => variances.reduce((a, v) => a + v[t], 0) / 4);
  const order = Array.from({ length: 64 }, (_, i) => i).sort((a, b) => iso[b] - iso[a]);
  const peak = topMean(iso, 3), sorted = [...iso].sort((a, b) => a - b);
  const directionSums = variances.map((v) => order.slice(0, 6).reduce((a, t) => a + v[t], 0));
  const p95 = percentile(.95), range = Math.max(p95 - percentile(.05), 40);
  return {
    dHash, vHash, color, sharpness: Math.min(...variances.map((v) => topMean(v, 6))),
    mean: sum / n, std: Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)),
    darkFrac: dark / n, brightFrac: bright / n, p95,
    peakSharpness: sourceLongEdge < 448 ? -1 : peak * clamp((180 / range) ** 2, 1, 12),
    focusRatio: peak / ((sorted[31] + sorted[32]) / 2 + 1),
    anisotropy: Math.min(...directionSums) / Math.max(1e-6, ...directionSums),
  };
}

export function hashDistance(a: ImageFeatures, b: ImageFeatures): number {
  let bits = (a.dHash ^ b.dHash), vertical = a.vHash ^ b.vHash, count = 0;
  while (bits) { bits &= bits - 1n; count++; }
  while (vertical) { vertical &= vertical - 1n; count++; }
  return count;
}

export function colorDistance(a: ImageFeatures, b: ImageFeatures): number {
  return a.color.reduce((sum, value, i) => sum + Math.abs(value - b.color[i]), 0) / (48 * 255);
}

export function blurLevel(f: ImageFeatures): 0 | 1 | 2 {
  if (f.peakSharpness < 0) return 0;
  const threshold = f.focusRatio >= 10 ? 30 : 45;
  if (f.peakSharpness < threshold * .6) return 2;
  if (f.peakSharpness < threshold || (f.anisotropy < .05 && f.peakSharpness < 135)) return 1;
  return 0;
}

export function badReasons(f: ImageFeatures): string[] {
  const out: string[] = [];
  if (f.std < 9) out.push('画面近乎纯色');
  if (f.mean < 30 && f.p95 < 70) out.push('太暗');
  if (f.mean > 232 && f.brightFrac > .55) out.push('过曝');
  if (!out.length) {
    const level = blurLevel(f);
    if (level) out.push(level === 2 ? '模糊' : '可能模糊');
  }
  return out;
}

export function excludedFromGrouping(f: ImageFeatures): boolean {
  return f.std < 9 || (f.mean < 30 && f.p95 < 70);
}
