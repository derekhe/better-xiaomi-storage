import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, Check, ChevronDown, Filter, RefreshCw, Search, Wifi, WifiOff, X } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { PhotoDetail } from './components/PhotoDetail';
import { Thumbnail } from './components/Thumbnail';
import { TimeNavigator } from './components/TimeNavigator';
import { groupPhotos, photoDate } from './lib/date';
import { isVideoPath } from './lib/media';
import { mockAlbums, mockPhotos } from './lib/mock';
import type { Album, ConnectionStatus, Photo } from './types';

type MediaFilter = 'all' | 'photo' | 'video';

export default function App() {
  const isMock = !window.smartStorage;
  const [status, setStatus] = useState<ConnectionStatus>(
    isMock ? { connected: true, mode: 'companion' } : { connected: false, mode: 'companion' },
  );
  const [albums, setAlbums] = useState<Album[]>(isMock ? mockAlbums : []);
  const [photos, setPhotos] = useState<Photo[]>(isMock ? mockPhotos : []);
  const [albumId, setAlbumId] = useState('1');
  const [title, setTitle] = useState('所有照片');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [filterOpen, setFilterOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [timeIndex, setTimeIndex] = useState<Photo[] | null>(isMock ? mockPhotos : null);
  const [timeIndexLoading, setTimeIndexLoading] = useState(false);
  const [timeMessage, setTimeMessage] = useState('');
  const [pendingDateKey, setPendingDateKey] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(!isMock);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(!isMock);
  const [error, setError] = useState('');
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadInitial = useCallback(async (nextAlbumId = albumId) => {
    if (!window.smartStorage) return;
    setLoading(true);
    setError('');
    setPhotos([]);
    setHasMore(true);
    try {
      const nextStatus = await window.smartStorage.getStatus();
      setStatus(nextStatus);
      if (!nextStatus.connected) throw new Error(nextStatus.message || '设备未连接');
      const [albumList, photoList] = await Promise.all([
        window.smartStorage.listAlbums(),
        window.smartStorage.listPhotos({ albumId: nextAlbumId, count: 80 }),
      ]);
      setAlbums(albumList.filter((album) => album.name && Number(album.photo_count || 0) + Number(album.video_count || 0) > 0));
      setPhotos(photoList);
      setHasMore(photoList.length === 80);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载相册失败');
    } finally {
      setLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    loadInitial('1');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (!window.smartStorage || loading || loadingMore || !hasMore || !photos.length) return;
    setLoadingMore(true);
    try {
      const next = await window.smartStorage.listPhotos({
        albumId,
        offset: photos[photos.length - 1].member_id,
        count: 80,
      });
      setPhotos((current) => [...current, ...next.filter((photo) => !current.some((item) => item.member_id === photo.member_id))]);
      setHasMore(next.length === 80);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '继续加载失败');
    } finally {
      setLoadingMore(false);
    }
  }, [albumId, hasMore, loading, loadingMore, photos]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && loadMore(), { rootMargin: '500px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const visiblePhotos = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return photos.filter((photo) => {
      const searchableDate = photoDate(photo).toLocaleDateString('zh-CN');
      const matchesQuery = !needle || `${photo.path} ${photo.location || ''} ${searchableDate}`.toLowerCase().includes(needle);
      const isVideo = isVideoPath(photo.path);
      const matchesType = filter === 'all' || (filter === 'video' ? isVideo : !isVideo);
      return matchesQuery && matchesType;
    });
  }, [deferredQuery, filter, photos]);
  const groups = useMemo(() => {
    const nextGroups = groupPhotos(visiblePhotos);
    if (sortOrder === 'desc') return nextGroups;
    return nextGroups
      .map((group) => ({ ...group, photos: [...group.photos].reverse() }))
      .reverse();
  }, [sortOrder, visiblePhotos]);

  useEffect(() => {
    if (!pendingDateKey) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`date-${pendingDateKey}`)?.scrollIntoView({ block: 'start' });
      setPendingDateKey('');
    });
    return () => cancelAnimationFrame(frame);
  }, [groups, pendingDateKey]);

  async function toggleTimeNavigator() {
    const opening = !timeOpen;
    setTimeOpen(opening);
    setFilterOpen(false);
    setTimeMessage('');
    if (!opening || timeIndex || timeIndexLoading) return;
    setTimeIndexLoading(true);
    try {
      const index = await window.smartStorage!.listPhotoIndex({ albumId });
      setTimeIndex([...index].sort((a, b) => photoDate(b).getTime() - photoDate(a).getTime()));
    } catch (reason) {
      setTimeMessage(reason instanceof Error ? reason.message : '建立时间索引失败');
    } finally {
      setTimeIndexLoading(false);
    }
  }

  function locateTime(year: number, month: number, day: number) {
    const index = timeIndex || [];
    const targetIndex = index.findIndex((photo) => {
      const date = photoDate(photo);
      return date.getFullYear() === year
        && (!month || date.getMonth() + 1 === month)
        && (!day || date.getDate() === day);
    });
    if (targetIndex < 0) {
      setTimeMessage('这个日期没有照片');
      return;
    }
    const targetDate = photoDate(index[targetIndex]);
    const start = Math.max(0, targetIndex - 20);
    const end = Math.min(index.length, start + 120);
    setPhotos(index.slice(start, end));
    setHasMore(end < index.length);
    setSortOrder('desc');
    setFilter('all');
    setQuery('');
    setDetail(null);
    setPendingDateKey(`${targetDate.getFullYear()}-${targetDate.getMonth() + 1}-${targetDate.getDate()}`);
    setTimeOpen(false);
  }

  function selectAlbum(nextAlbumId: string, nextTitle: string) {
    setAlbumId(nextAlbumId);
    setTitle(nextTitle);
    setDetail(null);
    setSelected(new Set());
    setTimeOpen(false);
    setTimeIndex(isMock ? mockPhotos : null);
    if (window.smartStorage) loadInitial(nextAlbumId);
  }

  function togglePhoto(photo: Photo) {
    if (!selecting) {
      setDetail(photo);
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(photo.member_id)) next.delete(photo.member_id);
      else next.add(photo.member_id);
      return next;
    });
  }

  return (
    <div className="app-shell">
      <Sidebar albums={albums} selectedAlbum={albumId} onSelectAlbum={selectAlbum} />
      <main className="main-content">
        <header className="topbar">
          <label className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索照片、地点或日期" />
            {query ? <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={16} /></button> : null}
          </label>
          <div className={`connection ${status.connected ? 'online' : 'offline'}`}>
            {status.connected ? <Wifi size={18} /> : <WifiOff size={18} />}
            <span>{status.connected ? '已连接' : '未连接'}</span>
          </div>
        </header>

        <section className="gallery-content">
          <div className="gallery-heading">
            <div>
              <h1>{selecting && selected.size ? `已选择 ${selected.size} 项` : title}</h1>
              <p>{visiblePhotos.length ? `${visiblePhotos.length} 张已加载` : ''}</p>
            </div>
            <div className="toolbar">
              <div className="time-wrap">
                <button className={timeOpen ? 'active' : ''} onClick={toggleTimeNavigator}>
                  <CalendarRange size={17} /><span>时间定位</span>
                </button>
                {timeOpen ? <TimeNavigator loading={timeIndexLoading} message={timeMessage} photos={timeIndex} onClose={() => setTimeOpen(false)} onLocate={locateTime} /> : null}
              </div>
              <button
                aria-label={`按时间${sortOrder === 'desc' ? '倒序' : '正序'}，点击切换`}
                onClick={() => setSortOrder((value) => value === 'desc' ? 'asc' : 'desc')}
              >
                <span>按时间</span><ChevronDown className={sortOrder === 'asc' ? 'sort-ascending' : ''} size={16} />
              </button>
              <div className="filter-wrap">
                <button className={filter !== 'all' ? 'active' : ''} onClick={() => setFilterOpen((value) => !value)}>
                  <Filter size={17} /><span>筛选</span>
                </button>
                {filterOpen ? (
                  <div className="filter-menu">
                    {([['all', '全部'], ['photo', '仅照片'], ['video', '仅视频']] as const).map(([value, label]) => (
                      <button key={value} className={filter === value ? 'active' : ''} onClick={() => { setFilter(value); setFilterOpen(false); }}>
                        <span>{label}</span>{filter === value ? <Check size={15} /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button className={selecting ? 'active' : ''} onClick={() => { setSelecting((value) => !value); setSelected(new Set()); }}>
                <Check size={17} /><span>{selecting ? '完成' : '选择'}</span>
              </button>
            </div>
          </div>

          {error ? (
            <div className="error-state">
              <WifiOff size={32} />
              <h2>暂时无法打开相册</h2>
              <p>{error}</p>
              <button onClick={() => loadInitial(albumId)}><RefreshCw size={17} />重新连接</button>
            </div>
          ) : null}

          {loading ? <div className="loading-grid">{Array.from({ length: 15 }, (_, index) => <span key={index} />)}</div> : null}

          {!loading && !error ? (
            <div className="timeline">
              {groups.map((group) => (
                <section className="date-group" id={`date-${group.date.getFullYear()}-${group.date.getMonth() + 1}-${group.date.getDate()}`} key={`${group.date.getTime()}-${group.label}`}>
                  <h2>{group.label}</h2>
                  <div className="photo-grid">
                    {group.photos.map((photo) => {
                      const isSelected = selected.has(photo.member_id);
                      return (
                        <button
                          className={`photo-tile ${isSelected ? 'selected' : ''}`}
                          key={photo.member_id}
                          onClick={() => togglePhoto(photo)}
                          aria-label={photo.path.split(/[\\/]/).pop()}
                        >
                          <Thumbnail photo={photo} />
                          {selecting ? <span className="selection-mark">{isSelected ? <Check size={15} /> : null}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {!groups.length ? <div className="empty-state">没有找到相关照片</div> : null}
              <div ref={sentinelRef} className="load-sentinel">{loadingMore ? '正在加载更多照片…' : ''}</div>
            </div>
          ) : null}
        </section>
      </main>
      {detail ? <PhotoDetail photo={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}
