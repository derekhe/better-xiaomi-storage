const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { validatePhotos } = require('./cleanup-trash.cjs');

const CHUNK = /^\d{13}-[a-f0-9-]{36}\.bin$/;
const NUMBERS = ['sharpness', 'mean', 'std', 'darkFrac', 'brightFrac', 'p95', 'peakSharpness', 'focusRatio', 'anisotropy'];

function cleanupScope(uid, deviceId) {
  if (!uid || !deviceId) throw new Error('请先登录并选择存储设备');
  return createHash('sha256').update(JSON.stringify(['photo-analysis-v1', String(uid), String(deviceId)])).digest('hex');
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 50) throw new Error('本地分析记录数量无效');
  validatePhotos(entries.map((entry) => entry?.photo));
  return entries.map((entry) => {
    if (!Number.isSafeInteger(entry.attemptedAt) || entry.attemptedAt < 0) throw new Error('本地分析时间无效');
    const photo = Object.fromEntries(['path', 'member_id', 'modify_time', 'size'].map((key) => [key, entry.photo[key]]));
    if (entry.metrics === null) return { photo, attemptedAt: entry.attemptedAt, metrics: null };
    const m = entry.metrics, f = m?.features;
    if (!m || !Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 9 || m.height < 9 || Math.max(m.width, m.height) > 65536
      || !f || typeof f.dHash !== 'string' || typeof f.vHash !== 'string' || !/^[a-f0-9]{1,16}$/.test(f.dHash) || !/^[a-f0-9]{1,16}$/.test(f.vHash)
      || !Array.isArray(f.color) || f.color.length !== 48 || f.color.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
      || NUMBERS.some((key) => typeof f[key] !== 'number' || !Number.isFinite(f[key]))) throw new Error('本地照片特征无效');
    let quality;
    if (m.quality !== undefined) {
      const q = m.quality;
      if (!q || typeof q.modelId !== 'string' || !/^liqe-[a-z0-9-]{1,80}$/.test(q.modelId)
        || !Number.isFinite(q.quality) || q.quality < 1 || q.quality > 5.001
        || !Array.isArray(q.probabilities) || q.probabilities.length !== 5 || q.probabilities.some(v => !Number.isFinite(v) || v < 0 || v > 1.001)
        || Math.abs(q.probabilities.reduce((a, b) => a + b, 0) - 1) > .01
        || typeof q.scene !== 'string' || q.scene.length > 40 || typeof q.distortion !== 'string' || q.distortion.length > 40
        || !Number.isFinite(q.confidence) || q.confidence < 0 || q.confidence > 1.001) throw new Error('本地 AI 评分无效');
      quality = { modelId: q.modelId, quality: q.quality, probabilities: [...q.probabilities], scene: q.scene, distortion: q.distortion, confidence: q.confidence };
    }
    return { photo, attemptedAt: entry.attemptedAt, metrics: { width: m.width, height: m.height, ...(quality ? { quality } : {}), features: {
      dHash: f.dHash, vHash: f.vHash, color: [...f.color], ...Object.fromEntries(NUMBERS.map((key) => [key, f[key]])),
    } } };
  });
}

class CleanupCache {
  constructor({ root, safeStorage }) { this.root = path.resolve(root); this.safeStorage = safeStorage; this.states = new Map(); }
  directory(scope) {
    if (typeof scope !== 'string' || !/^[a-f0-9]{64}$/.test(scope)) throw new Error('本地分析范围无效');
    const directory = path.resolve(this.root, scope);
    if (!directory.startsWith(`${this.root}${path.sep}`)) throw new Error('本地分析目录无效');
    return directory;
  }
  state(scope) {
    const directory = this.directory(scope);
    if (!this.states.has(scope)) this.states.set(scope, { directory, records: null, timestamp: 0, queue: Promise.resolve() });
    return this.states.get(scope);
  }
  async files(state) {
    try { return (await fs.readdir(state.directory, { withFileTypes: true })).filter((f) => f.isFile() && CHUNK.test(f.name)).map((f) => f.name).sort(); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  enqueue(scope, operation) {
    const state = this.state(scope);
    const job = state.queue.then(() => operation(state));
    state.queue = job.catch(() => {});
    return job;
  }
  async read(state) {
    if (state.records) return;
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('本机加密不可用，无法保存分析进度');
    const records = new Map();
    for (const name of await this.files(state)) {
      const file = path.join(state.directory, name);
      if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw new Error('本地分析记录异常，请重新开始分析');
      let data;
      try { data = JSON.parse(this.safeStorage.decryptString(await fs.readFile(file))); }
      catch { throw new Error('本地分析记录无法读取，请重新开始分析'); }
      if (data.version !== 1) throw new Error('本地分析记录版本已变化，请重新开始分析');
      for (const entry of validateEntries(data.entries)) records.set(entry.photo.path, entry);
      state.timestamp = Math.max(state.timestamp, Number(name.slice(0, 13)));
    }
    state.records = records;
  }
  load(scope) { return this.enqueue(scope, async (state) => { await this.read(state); return [...state.records.values()]; }); }
  save(scope, entries) {
    const packet = validateEntries(entries);
    return this.enqueue(scope, async (state) => {
      await this.read(state);
      await fs.mkdir(state.directory, { recursive: true });
      state.timestamp = Math.max(Date.now(), state.timestamp + 1);
      const file = path.join(state.directory, `${state.timestamp}-${randomUUID()}.bin`);
      const bytes = this.safeStorage.encryptString(JSON.stringify({ version: 1, entries: packet }));
      // Publish a complete checkpoint only; interrupted writes leave an ignored .tmp.
      await fs.writeFile(`${file}.tmp`, bytes, { flag: 'wx', mode: 0o600 });
      await fs.rename(`${file}.tmp`, file);
      for (const entry of packet) state.records.set(entry.photo.path, entry);
    });
  }
  clear(scope) {
    return this.enqueue(scope, async (state) => {
      // Only our validated checkpoint files inside this account/device directory.
      for (const name of await this.files(state)) await fs.unlink(path.join(state.directory, name));
      state.records = new Map(); state.timestamp = 0;
    });
  }
}

module.exports = { CleanupCache, cleanupScope, validateEntries };
