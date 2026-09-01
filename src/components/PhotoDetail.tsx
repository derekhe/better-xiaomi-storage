import { Check, Download, Heart, ImageOff, LoaderCircle, MoreHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Photo } from '../types';
import { formatDateTime } from '../lib/date';
import { isVideoPath } from '../lib/media';

export function PhotoDetail({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const [favorite, setFavorite] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usingPreviewFallback, setUsingPreviewFallback] = useState(false);
  const isVideo = isVideoPath(photo.path);
  const fileName = photo.path.split(/[\\/]/).pop() || (isVideo ? '视频' : '照片');

  useEffect(() => {
    let active = true;
    setSource('');
    setLoading(true);
    setError('');
    setUsingPreviewFallback(false);

    const loadSource = async () => {
      try {
        const nextSource = photo.mockMediaUrl
          || photo.mockUrl
          || (await window.smartStorage?.getMediaUrl({ photoPath: photo.path }));
        if (!nextSource) throw new Error('无法获得媒体文件地址');
        if (active) setSource(nextSource);
      } catch (reason) {
        if (!active) return;
        setLoading(false);
        setError(reason instanceof Error ? reason.message : '媒体文件加载失败');
      }
    };

    loadSource();
    return () => {
      active = false;
    };
  }, [photo.mockMediaUrl, photo.mockUrl, photo.path]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  async function downloadPreview() {
    const url = photo.mockUrl || (await window.smartStorage?.getThumbnail({ photoPath: photo.path, quality: 'preview' }));
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
  }

  async function handleImageError() {
    if (!usingPreviewFallback && !photo.mockUrl && window.smartStorage) {
      setUsingPreviewFallback(true);
      setLoading(true);
      setError('');
      try {
        const preview = await window.smartStorage.getThumbnail({ photoPath: photo.path, quality: 'preview' });
        setSource(preview);
        return;
      } catch {
        // Fall through to the visible error state.
      }
    }
    setLoading(false);
    setError('原图读取失败');
  }

  return (
    <div className="viewer-overlay" role="dialog" aria-modal="true" aria-label={`${isVideo ? '视频' : '照片'}预览`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="viewer-shell">
        <div className="viewer-stage">
          {loading ? <div className="viewer-status"><LoaderCircle className="spin" size={28} /><span>正在读取{isVideo ? '视频' : '原图'}…</span></div> : null}
          {error ? <div className="viewer-status viewer-error"><ImageOff size={32} /><span>{error}</span></div> : null}
          {source && isVideo ? (
            <video
              src={source}
              controls
              autoPlay
              playsInline
              onCanPlay={() => setLoading(false)}
              onError={() => { setLoading(false); setError('视频无法播放或编码暂不受支持'); }}
            />
          ) : null}
          {source && !isVideo ? (
            <img
              src={source}
              alt={fileName}
              draggable={false}
              onLoad={() => setLoading(false)}
              onError={handleImageError}
            />
          ) : null}
        </div>

        <aside className="detail-panel">
          <button className="detail-close" onClick={onClose} aria-label="关闭预览"><X size={22} /></button>
          <div className="detail-kind">{isVideo ? '视频' : '照片'}</div>
          <h2 title={fileName}>{fileName}</h2>
          <dl>
            <div><dt>日期</dt><dd>{formatDateTime(photo)}</dd></div>
            <div><dt>地点</dt><dd>{photo.location || '未记录'}</dd></div>
            <div><dt>大小</dt><dd>{(Number(photo.size || 0) / 1024 / 1024).toFixed(1)} MB</dd></div>
            {showMore ? <div><dt>路径</dt><dd className="path-value">{photo.path}</dd></div> : null}
          </dl>
          <div className="detail-actions">
            <button className={favorite ? 'active' : ''} onClick={() => setFavorite((value) => !value)} aria-label="收藏">
              {favorite ? <Check size={20} /> : <Heart size={20} />}
            </button>
            {!isVideo ? <button onClick={downloadPreview} aria-label="下载预览图"><Download size={20} /></button> : null}
            <button className={showMore ? 'active' : ''} onClick={() => setShowMore((value) => !value)} aria-label="更多信息"><MoreHorizontal size={20} /></button>
          </div>
        </aside>
      </section>
    </div>
  );
}
