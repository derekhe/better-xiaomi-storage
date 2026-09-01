import { memo, useEffect, useRef, useState } from 'react';
import { ImageOff, Play } from 'lucide-react';
import type { Photo } from '../types';
import { isVideoPath } from '../lib/media';

interface ThumbnailProps {
  photo: Photo;
  quality?: 'small' | 'preview';
  alt?: string;
}

export const Thumbnail = memo(function Thumbnail({ photo, quality = 'small', alt = '' }: ThumbnailProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState(photo.mockUrl || '');
  const [visible, setVisible] = useState(quality === 'preview' || Boolean(photo.mockUrl));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (visible || quality === 'preview') return;
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { rootMargin: '280px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [quality, visible]);

  useEffect(() => {
    if (!visible || photo.mockUrl || !window.smartStorage) return;
    let active = true;
    setFailed(false);
    window.smartStorage
      .getThumbnail({ photoPath: photo.path, quality })
      .then((url) => active && setSrc(url))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [photo.path, photo.mockUrl, quality, visible]);

  return (
    <div ref={ref} className={`thumbnail-frame ${src && !failed ? 'is-loaded' : ''}`}>
      {src && !failed ? <img src={src} alt={alt} draggable={false} onError={() => setFailed(true)} /> : null}
      {!src && !failed ? <span className="thumbnail-shimmer" /> : null}
      {failed ? <ImageOff aria-label="缩略图加载失败" size={22} /> : null}
      {src && !failed && isVideoPath(photo.path) ? <span className="video-badge" aria-label="视频"><Play fill="currentColor" size={18} /></span> : null}
    </div>
  );
});
