const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { createHash } = require('node:crypto');

const MODEL_SHA = '66526600218226c4bc34d4c06d11e47f0e71f910248fa103d39f9c8f46c63b82';
const MODEL_ID = `liqe-15-v1-${MODEL_SHA.slice(0, 12)}`;
class LiqeProcess {
  constructor(runtimeRoot) { this.root = runtimeRoot; this.child = null; this.readyPromise = null; this.pending = new Map(); this.sequence = 0; this.device = ''; }
  status() {
    const python = path.join(this.root, 'python.exe');
    return { available: fs.existsSync(python) && fs.existsSync(path.join(this.root, 'LIQE.pt')) && fs.existsSync(path.join(this.root, 'ViT-B-32.pt')), modelId: MODEL_ID, device: this.device };
  }
  async ready() {
    if (this.readyPromise) return this.readyPromise;
    if (!this.status().available) throw new Error('LIQE 模型尚未准备，请先运行 npm run prepare:liqe');
    this.readyPromise = (async () => {
      const bytes = await fs.promises.readFile(path.join(this.root, 'LIQE.pt'));
      if (createHash('sha256').update(bytes).digest('hex') !== MODEL_SHA) throw new Error('LIQE 模型校验失败，请重新准备模型');
      await new Promise((resolve, reject) => {
        const child = spawn(path.join(this.root, 'python.exe'), ['-I', '-u', path.join(__dirname, 'liqe_worker.py'), '--runtime', this.root],
          { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2' } });
        this.child = child;
        const timer = setTimeout(() => { reject(new Error('LIQE 模型启动超时，请重试')); child.kill(); }, 120000);
        child.stderr.on('data', () => {});
        child.once('error', () => { clearTimeout(timer); reject(new Error('无法启动 LIQE 分析进程')); });
        child.once('exit', () => {
          clearTimeout(timer); if (this.child === child) { this.child = null; this.readyPromise = null; this.device = ''; }
          reject(new Error('LIQE 分析进程已退出，请检查模型环境后重试'));
          for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('LIQE 分析已停止')); }
          this.pending.clear();
        });
        readline.createInterface({ input: child.stdout }).on('line', line => {
          if (line.length > 32768) return;
          let message; try { message = JSON.parse(line); } catch { return; }
          if (message.type === 'ready') { clearTimeout(timer); this.device = message.device; resolve(); }
          else if (message.type === 'fatal') { clearTimeout(timer); reject(new Error('LIQE 模型初始化失败，请重新准备模型环境')); child.kill(); }
          else {
            const task = this.pending.get(message.id); if (!task) return;
            this.pending.delete(message.id); clearTimeout(task.timer);
            if (message.error) task.reject(new Error('这张预览图无法进行 LIQE 分析')); else task.resolve({ ...message.result, modelId: MODEL_ID });
          }
        });
      });
    })();
    try { await this.readyPromise; } catch (error) { this.readyPromise = null; throw error; }
  }
  async score(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.length > 16 * 1024 * 1024 || !/^data:image\/(jpeg|png|webp|bmp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('AI 分析仅支持有效的照片预览图');
    await this.ready();
    const child = this.child;
    if (!child || child.stdin.destroyed) throw new Error('LIQE 分析已停止');
    if (this.pending.size >= 2) throw new Error('AI 分析队列已满');
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('LIQE 分析超时，请暂停后重试')); child.kill(); }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, image: dataUrl.slice(dataUrl.indexOf(',') + 1) }) + '\n');
    });
  }
  async stop() {
    const child = this.child; if (!child) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill(), 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  }
}
module.exports = { LiqeProcess, MODEL_ID, MODEL_SHA };
