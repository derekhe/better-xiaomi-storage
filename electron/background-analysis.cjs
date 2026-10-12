const { EventEmitter } = require('node:events');

class BackgroundAnalysis extends EventEmitter {
  constructor(createSurface) {
    super(); this.createSurface = createSurface; this.surface = null; this.result = null; this.sequence = 0;
    this.state = { state: 'idle', revision: 0, progress: null, message: '' };
  }
  get running() { return ['running', 'pausing'].includes(this.state.state); }
  publish(patch) { this.state = { ...this.state, ...patch }; this.emit('change', this.state); }
  async start(scope, params) {
    if (this.running) throw new Error('后台分析已经在运行');
    const jobId = ++this.sequence;
    if (this.state.scope !== scope) this.result = null;
    this.publish({ state: 'running', scope, jobId, progress: null, message: '', model: params.model });
    try {
      const { window, ready } = this.createSurface(); this.surface = window;
      window.once('closed', () => {
        if (this.surface === window) {
          this.surface = null;
          if (this.running) { this.publish({ state: 'error', message: '后台分析进程已退出，已保存的进度可继续' }); this.emit('settled'); }
        }
      });
      await ready;
      if (this.surface !== window || jobId !== this.state.jobId) return this.state;
      window.webContents.send('analysis:start', { jobId, ...params });
      if (this.state.state === 'pausing') window.webContents.send('analysis:pause');
    } catch (error) { if (jobId === this.state.jobId && this.running) this.finish('error', error.message); }
    return this.state;
  }
  accept(jobId, update) {
    if (jobId !== this.state.jobId || !this.running) return;
    if (update.type === 'progress') this.publish({ progress: update.progress });
    else if (update.type === 'result') { this.result = update.result; this.publish({ revision: this.state.revision + 1 }); }
    else if (['paused', 'completed', 'error'].includes(update.type)) this.finish(update.type, update.message || '');
  }
  finish(state, message = '') {
    this.publish({ state, progress: null, message });
    const window = this.surface; this.surface = null;
    if (window && !window.isDestroyed()) window.destroy();
    this.emit('settled');
  }
  async pause() {
    if (!this.running) return this.state;
    this.publish({ state: 'pausing' });
    this.surface?.webContents.send('analysis:pause');
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.removeListener('settled', done); resolve(); };
      const timer = setTimeout(() => { this.finish('paused', '分析已暂停；已保存的记录可继续'); }, 8000);
      this.once('settled', done);
    });
    return this.state;
  }
  reset() {
    if (this.running) throw new Error('请先暂停后台分析');
    this.result = null; this.publish({ state: 'idle', scope: undefined, progress: null, revision: this.state.revision + 1, message: '' });
  }
}
module.exports = { BackgroundAnalysis };
