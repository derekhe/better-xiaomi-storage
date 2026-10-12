import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
const { BackgroundAnalysis } = createRequire(import.meta.url)('./background-analysis.cjs');

function fixture() {
  const windows = [], messages = [];
  const analysis = new BackgroundAnalysis(() => {
    const window = new EventEmitter(); let destroyed = false;
    window.isDestroyed = () => destroyed;
    window.destroy = () => { destroyed = true; window.emit('closed'); };
    window.webContents = { send: (channel, value) => messages.push({ channel, value }) };
    windows.push(window); return { window, ready: Promise.resolve() };
  });
  return { analysis, windows, messages };
}
describe('independent background analysis lifecycle', () => {
  it('keeps one job alive independently of the UI and exposes checkpoint results', async () => {
    const { analysis, messages } = fixture();
    await analysis.start('device-a', { model: 'liqe', batchSize: 50 });
    expect(messages[0].channel).toBe('analysis:start');
    await expect(analysis.start('device-a', {})).rejects.toThrow('已经');
    analysis.accept(1, { type: 'result', result: { analyzed: 50 } });
    expect(analysis.result.analyzed).toBe(50); expect(analysis.state.revision).toBe(1);
    expect(analysis.running).toBe(true);
    analysis.accept(1, { type: 'completed' });
    expect(analysis.running).toBe(false); expect(analysis.result.analyzed).toBe(50);
  });
  it('waits for the worker checkpoint on pause and rejects updates from old jobs', async () => {
    const { analysis, messages } = fixture();
    await analysis.start('a', { model: 'basic' });
    const pause = analysis.pause();
    expect(analysis.state.state).toBe('pausing'); expect(messages.at(-1).channel).toBe('analysis:pause');
    analysis.accept(1, { type: 'paused', message: 'saved' }); await pause;
    await analysis.start('a', { model: 'liqe' });
    analysis.accept(1, { type: 'error', message: 'stale' });
    expect(analysis.state.state).toBe('running');
    analysis.accept(2, { type: 'completed' });
  });
  it('drops old-device results and reports a crashed worker instead of staying busy', async () => {
    const { analysis, windows } = fixture();
    await analysis.start('a', {}); analysis.accept(1, { type: 'result', result: { analyzed: 1 } }); analysis.accept(1, { type: 'completed' });
    await analysis.start('b', {}); expect(analysis.result).toBeNull();
    windows[1].emit('closed'); expect(analysis.state.state).toBe('error'); expect(analysis.running).toBe(false);
    analysis.reset(); expect(analysis.state.state).toBe('idle');
  });
});
