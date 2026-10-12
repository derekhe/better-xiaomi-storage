import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Images, LoaderCircle, ScanLine, ShieldCheck, Sparkles, Square, Trash2 } from 'lucide-react';
import type { Photo, CleanupAnalysisState } from '../types';
import { applyCleanupRemoval, canSelectPath, cleanupBatchPhotos, defaultCleanupOptions, selectionWithDecisions, suggestedPaths, type CleanupDecision, type CleanupItem, type CleanupOptions } from '../lib/cleanup';
import { clearDemoCleanupCache, scanPhotos, type ScanProgress, type ScanResult } from '../lib/cleanup-scan';
import { photoVersionKey } from '../lib/cleanup-plan';
import { formatDateTime } from '../lib/date';
import { Thumbnail } from './Thumbnail';

type Category = 'similar' | 'duplicate' | 'bad' | 'selected';
const PAGE_SIZE = 12;
const formatSize = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const filename = (p: Photo) => p.path.split(/[\\/]/).pop() || p.path;

export function PhotoCleanup({ active, demoPhotos, onPreview, onRemoved }: {
  active: boolean; demoPhotos: Photo[]; onPreview: (photo: Photo) => void; onRemoved: (paths: string[]) => void;
}) {
  const [options, setOptions] = useState<CleanupOptions>(defaultCleanupOptions);
  const [batchSize, setBatchSize] = useState(200);
  const [resetting, setResetting] = useState(false);
  const [model, setModel] = useState<'liqe' | 'basic'>('liqe');
  const [modelAvailable, setModelAvailable] = useState(false);
  const [background, setBackground] = useState<CleanupAnalysisState>({ state: 'idle', revision: 0, progress: null, message: '' });
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [category, setCategory] = useState<Category>('similar');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [needsRescan, setNeedsRescan] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const decisions = useRef(new Map<string, CleanupDecision>());
  const mounted = useRef(true);
  const backgroundRunning = background.state === 'running' || background.state === 'pausing';
  const busy = Boolean(progress) || backgroundRunning || starting || deleting || resetting;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    const api = window.smartStorage;
    if (!api) return;
    let live = true, revision = -1, request = 0;
    const update = (state: CleanupAnalysisState) => {
      if (!live) return;
      setBackground(state); setProgress(state.progress);
      if (state.model) setModel(state.model);
      if (state.state === 'error') setError(state.message);
      else if (state.state === 'paused' || state.state === 'completed') setMessage(state.message);
      if (state.revision !== revision) {
        revision = state.revision; const current = ++request;
        api.getAnalysisResult().then(next => {
          if (!live || current !== request) return;
          setResult(next);
          setSelected(next ? selectionWithDecisions(next, decisions.current) : new Set());
          if (next) setCategory(current => current === 'similar' && !next.groups.some(g => g.kind === 'similar') ? next.groups.length ? 'duplicate' : 'bad' : current);
        }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : '无法读取分析结果'); });
      }
    };
    const unsubscribe = api.onAnalysisChanged(update);
    api.getAnalysisState().then(update).catch(() => {});
    api.getQualityModelStatus().then(status => { if (live) { setModelAvailable(status.available); if (!status.available) setModel('basic'); } }).catch(() => {});
    return () => { live = false; unsubscribe(); };
  }, []);

  const allItems = useMemo(() => result ? [...result.groups.flatMap((g) => g.members), ...result.bad] : [], [result]);
  const selectedBytes = useMemo(() => allItems.reduce((sum, m) => sum + (selected.has(m.photo.path) ? Number(m.photo.size) || 0 : 0), 0), [allItems, selected]);
  const rows = useMemo(() => {
    if (!result) return [];
    if (category === 'bad') return result.bad.map((m) => ({ key: m.photo.path, label: m.reasons.join(' · '), members: [m], group: false }));
    if (category === 'selected') return allItems.filter((m) => selected.has(m.photo.path)).map((m) => ({ key: m.photo.path, label: '待清理照片', members: [m], group: false }));
    return result.groups.filter((g) => g.kind === category).map((g) => ({
      key: g.key, label: `${g.kind === 'duplicate' ? '画面重复' : '相似照片'} · ${g.members.length} 张`, members: g.members, group: true,
    }));
  }, [allItems, category, result, selected]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1);
  const displayRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const counts: Record<Category, number> = {
    similar: result?.groups.filter((g) => g.kind === 'similar').length || 0,
    duplicate: result?.groups.filter((g) => g.kind === 'duplicate').length || 0,
    bad: result?.bad.length || 0, selected: selected.size,
  };

  async function startScan(retryFailed = false) {
    if (controller.current || deleting) return;
    if (window.smartStorage) {
      setStarting(true); setError(''); setMessage(''); setNeedsRescan(false);
      try { setBackground(await window.smartStorage.startAnalysis({ options, batchSize, model, retryFailed })); }
      catch (reason) { setError(reason instanceof Error ? reason.message : '无法启动后台分析'); }
      finally { setStarting(false); }
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setError(''); setMessage(''); setPage(0); setNeedsRescan(false);
    try {
      const next = await scanPhotos({ api: window.smartStorage, demoPhotos, options, batchSize, retryFailed, signal: abort.signal, onProgress: (p) => { if (mounted.current && !abort.signal.aborted) setProgress(p); } });
      if (!mounted.current || abort.signal.aborted) return;
      setResult(next); setSelected(selectionWithDecisions(next, decisions.current));
      setCategory(next.groups.some((g) => g.kind === 'similar') ? 'similar' : next.groups.length ? 'duplicate' : 'bad');
    } catch (reason) {
      if (!mounted.current) return;
      if (abort.signal.aborted && reason instanceof Error && reason.name === 'AbortError') setMessage('分析已暂停，完成的进度已保存。下次开始分析会继续。');
      else setError(reason instanceof Error ? reason.message : '分析失败，请重试');
    } finally {
      controller.current = null;
      if (mounted.current) setProgress(null);
    }
  }

  async function pauseScan() {
    if (!window.smartStorage) { controller.current?.abort(); return; }
    try { setBackground(await window.smartStorage.pauseAnalysis()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法暂停分析'); }
  }

  async function restartScan() {
    if (busy) return;
    setResetting(true); setError('');
    try {
      if (window.smartStorage) { if ((await window.smartStorage.clearCleanupCache()).cancelled) return; }
      else { if (!window.confirm('清空本机样例分析进度并重新开始？')) return; clearDemoCleanupCache(); }
      decisions.current.clear(); setResult(null); setSelected(new Set());
      await startScan();
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '无法重新开始分析'); }
    finally { if (mounted.current) setResetting(false); }
  }

  function toggle(item: CleanupItem) {
    if (!result || busy || item.protected) return;
    setMessage('');
    if (!selected.has(item.photo.path) && !canSelectPath(result, selected, item.photo.path)) {
      setMessage('每组至少保留一张。请先取消勾选想保留的照片。'); return;
    }
    decisions.current.set(item.photo.path, { version: photoVersionKey(item.photo), remove: !selected.has(item.photo.path) });
    setSelected((current) => { const next = new Set(current); if (next.has(item.photo.path)) next.delete(item.photo.path); else next.add(item.photo.path); return next; });
  }

  function keepPhoto(members: CleanupItem[], path: string) {
    if (busy) return;
    for (const m of members) decisions.current.set(m.photo.path, { version: photoVersionKey(m.photo), remove: m.photo.path !== path && !m.protected });
    // The explicit choice is local to this group, and favorites always remain protected.
    setSelected((current) => {
      const next = new Set(current);
      for (const m of members) if (m.photo.path === path || m.protected) next.delete(m.photo.path); else next.add(m.photo.path);
      return next;
    });
    setMessage('已更新这一组的保留选择。');
  }

  async function removeSelected() {
    if (!window.smartStorage || !result || busy || needsRescan || !selected.size) return;
    setDeleting(true); setError(''); setMessage('');
    try {
      const photos = cleanupBatchPhotos(allItems, selected);
      const response = await window.smartStorage.trashPhotos({ photos });
      if (!mounted.current) return;
      if (response.cancelled) { setMessage('已取消清理。'); return; }
      const removed = new Set(response.deletedPaths);
      setResult((current) => current ? applyCleanupRemoval(current, removed, selected) : null);
      setSelected((current) => new Set([...current].filter((path) => !removed.has(path))));
      onRemoved(response.deletedPaths);
      setMessage(`已将 ${response.deletedPaths.length} 张照片移入回收站。可在官方客户端查看或恢复。`);
      if (response.failed.length) { setNeedsRescan(true); setError(`${response.failed.length} 张未确认成功：${response.failed[0].message}。请重新分析后检查。`); }
    } catch (reason) {
      if (mounted.current) { setNeedsRescan(true); setError(`${reason instanceof Error ? reason.message : '清理失败'}。请重新分析后检查，避免直接重复清理。`); }
    } finally { if (mounted.current) setDeleting(false); }
  }

  return (
    <section className="cleanup-content" hidden={!active}>
      <div className="gallery-heading cleanup-heading">
        <div><h1>照片清理</h1><p>挑出重复和拍得不好的照片，留下值得保留的瞬间</p></div>
        <span className="cleanup-local"><ShieldCheck size={16} />本机分析</span>
      </div>
      <div className="cleanup-intro">
        <div className="cleanup-intro-icon"><Sparkles size={26} /></div>
        <div><h2>先帮你挑，再由你决定</h2><p>后台分批分析照片，切换页面或最小化窗口后继续运行；收藏会受到保护。暂停后可检查建议并清理。</p><p>LIQE 在本机评估画质并辅助选优，照片不会上传。进度自动保存，关闭应用后可继续。</p></div>
      </div>
      <div className="cleanup-scan-controls">
        <label>分析方式<select aria-label="分析方式" disabled={busy || !window.smartStorage} value={window.smartStorage ? model : 'basic'} onChange={e => setModel(e.target.value as 'liqe' | 'basic')}><option value="liqe" disabled={!modelAvailable}>LIQE · AI 画质</option><option value="basic">快速规则分析</option></select></label>
        <label>相似程度<select aria-label="相似程度" disabled={busy} value={options.strictness} onChange={(e) => setOptions((v) => ({ ...v, strictness: e.target.value as CleanupOptions['strictness'] }))}><option value="standard">标准</option><option value="strict">严格</option></select></label>
        <label>每组推荐保留<select aria-label="每组推荐保留" disabled={busy} value={options.keepCount} onChange={(e) => setOptions((v) => ({ ...v, keepCount: Number(e.target.value) }))}><option value="1">1 张</option><option value="2">2 张</option><option value="3">3 张</option></select></label>
        <label>每批分析<select aria-label="每批分析" disabled={busy} value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))}><option value="50">50 张</option><option value="200">200 张</option><option value="500">500 张</option></select></label>
        <button className="cleanup-primary" disabled={busy} onClick={() => startScan()}><ScanLine size={17} />{result ? result.remaining ? '继续后台分析' : '检查新照片' : '开始后台分析'}</button>
        {result?.failed ? <button className="cleanup-secondary" disabled={busy} onClick={() => startScan(true)}>重试失败</button> : null}
        <button className="cleanup-secondary" disabled={busy} onClick={restartScan}>{resetting ? '正在重置…' : '重新开始'}</button>
        {!window.smartStorage ? <span className="cleanup-muted">样例相册 · 仅演示分析</span> : null}
      </div>
      {progress || backgroundRunning || starting ? <div className="cleanup-progress" role="status">
        <div><LoaderCircle className="spin" size={18} /><span>{!progress ? '正在启动后台分析…' : progress.phase === 'index' ? '正在核对照片和已保存的进度…' : progress.phase === 'saving' ? '正在保存本机进度…' : progress.phase === 'groups' ? '正在更新清理建议…' : `本批 ${progress.batchDone} / ${progress.batchTotal} · 总计已处理 ${progress.done} / ${progress.total} 张`}</span><button disabled={background.state === 'pausing' || starting} onClick={pauseScan}>{background.state === 'pausing' ? '正在保存并暂停…' : '暂停分析'}</button></div>
        <progress max={Math.max(1, progress?.total || 0)} value={progress?.done || 0} aria-label="照片分析进度" />
      </div> : null}
      {error ? <p className="cleanup-error" role="alert">{error}</p> : null}
      {message ? <p className="cleanup-message" role="status">{message}</p> : null}
      {result ? <>
        <div className="cleanup-summary"><span>已分析 <strong>{result.analyzed}</strong> / {result.total} 张照片</span><span>剩余 <strong>{result.remaining}</strong> 张待分析</span><span>找到 <strong>{result.groups.length}</strong> 组重复 / 相似</span><span>待清理 <strong>{selected.size}</strong> 张 · {formatSize(selectedBytes)}</span></div>
        <p className="cleanup-muted">本批处理 {result.processed} 张，复用 {result.reused} 张已完成记录。不同批次的照片会一起比较和分组。</p>
        {result.failed ? <p className="cleanup-error">{result.failed} 张照片读取失败或格式暂不支持，未纳入建议。点击“重试失败”可单独重试。</p> : null}
        <p className="cleanup-muted">根据预览图判断；LIQE 画质为 1–5 分，不是审美评分。仅因 AI 画质偏低的照片不会默认勾选，请预览后决定。</p>
        <div className="cleanup-tabs" role="tablist" aria-label="清理分类">
          {([['duplicate', '画面重复'], ['similar', '相似照片'], ['bad', '模糊与曝光'], ['selected', '待清理']] as const).map(([value, label]) => <button role="tab" aria-selected={category === value} key={value} className={category === value ? 'active' : ''} onClick={() => { setCategory(value); setPage(0); }}>{label}<span>{counts[value]}</span></button>)}
        </div>
        <div className="cleanup-results" role="tabpanel" aria-label="清理结果">
          {displayRows.map((row) => <section className="cleanup-group" key={row.key}>
            <div className="cleanup-group-heading"><h2>{row.label}</h2>{row.group ? <span>保留 {row.members.filter((m) => !selected.has(m.photo.path)).length} 张</span> : null}</div>
            <div className="cleanup-photo-grid">
              {row.members.map((item) => <article className={`cleanup-photo ${selected.has(item.photo.path) ? 'to-remove' : ''}`} key={item.photo.path}>
                <button className="cleanup-preview" onClick={() => onPreview(item.photo)} aria-label={`预览 ${filename(item.photo)}`}><Thumbnail photo={item.photo} />{item.best ? <span className="cleanup-best"><Sparkles size={12} />推荐保留</span> : null}</button>
                <div className="cleanup-photo-info"><strong title={filename(item.photo)}>{filename(item.photo)}</strong><span>{formatSize(Number(item.photo.size) || 0)}{item.quality ? ` · LIQE ${item.quality.quality.toFixed(2)} / 5` : row.group ? ` · 推荐分 ${item.score}` : ''}</span><small>{item.reasons.join(' · ')}</small><small>{formatDateTime(item.photo)}</small></div>
                <div className="cleanup-photo-actions"><button disabled={item.protected || busy} aria-pressed={selected.has(item.photo.path)} aria-label={`清理 ${filename(item.photo)}`} onClick={() => toggle(item)}>{item.protected ? <ShieldCheck size={15} /> : selected.has(item.photo.path) ? <Check size={15} /> : <Square size={15} />}{item.protected ? '收藏保护' : selected.has(item.photo.path) ? '待清理' : '保留'}</button>{row.group ? <button disabled={busy} onClick={() => keepPhoto(row.members, item.photo.path)}>保留这张</button> : null}</div>
              </article>)}
            </div>
          </section>)}
          {!rows.length ? <div className="cleanup-empty"><Images size={30} /><p>{category === 'selected' ? '还没有勾选待清理照片' : '这个分类没有发现需要整理的照片'}</p></div> : null}
        </div>
        {pages > 1 ? <div className="cleanup-pagination"><button aria-label="上一页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span>{currentPage + 1} / {pages}</span><button aria-label="下一页" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div> : null}
        <div className="cleanup-footer"><div><strong>{selected.size} 张待清理 · {formatSize(selectedBytes)}</strong><span>{needsRescan ? '请检查新照片，核对设备上的实际结果' : selected.size > 500 ? '本次处理前 500 张，其余保留勾选，每批都需确认' : '清理前请查看大图并确认保留选择'}</span></div><div className="cleanup-footer-actions"><button disabled={busy} onClick={() => { for (const item of allItems) decisions.current.set(item.photo.path, { version: photoVersionKey(item.photo), remove: false }); setSelected(new Set()); setMessage(''); }}>取消勾选</button><button disabled={busy} onClick={() => { decisions.current.clear(); setSelected(suggestedPaths(result)); setMessage(''); }}>使用推荐</button><button className="cleanup-primary" disabled={!window.smartStorage || busy || needsRescan || !selected.size} onClick={removeSelected}>{deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}{deleting ? '正在清理…' : selected.size > 500 ? '清理前 500 张' : '移入回收站'}</button></div></div>
      </> : !progress ? <div className="cleanup-empty"><ScanLine size={36} /><h2>从一次分析开始</h2><p>照片逐张读取，视频会跳过。分析时间取决于照片数量和设备连接速度。</p></div> : null}
    </section>
  );
}
