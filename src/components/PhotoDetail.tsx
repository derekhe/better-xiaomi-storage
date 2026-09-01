import { Check, Download, Heart, MoreHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import type { Photo } from '../types';
import { formatDateTime } from '../lib/date';
import { Thumbnail } from './Thumbnail';

export function PhotoDetail({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const [favorite, setFavorite] = useState(false);
  const [showMore, setShowMore] = useState(false);

  async function downloadPreview() {
    const url = photo.mockUrl || (await window.smartStorage?.getThumbnail({ photoPath: photo.path, quality: 'preview' }));
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = photo.path.split(/[\\/]/).pop() || 'photo.jpg';
    link.click();
  }

  return (
    <aside className="detail-panel" aria-label="照片详情">
      <button className="detail-close" onClick={onClose} aria-label="关闭详情"><X size={22} /></button>
      <div className="detail-preview"><Thumbnail photo={photo} quality="preview" alt="当前照片" /></div>
      <h2>{photo.path.split(/[\\/]/).pop()}</h2>
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
        <button onClick={downloadPreview} aria-label="下载预览图"><Download size={20} /></button>
        <button className={showMore ? 'active' : ''} onClick={() => setShowMore((value) => !value)} aria-label="更多信息"><MoreHorizontal size={20} /></button>
      </div>
    </aside>
  );
}
