import { Clock3, Heart, Image, Settings } from 'lucide-react';
import type { Album } from '../types';
import { Thumbnail } from './Thumbnail';

interface SidebarProps {
  albums: Album[];
  selectedAlbum: string;
  onSelectAlbum: (id: string, name: string) => void;
}

export function Sidebar({ albums, selectedAlbum, onSelectAlbum }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">拾光</div>
      <nav className="primary-nav" aria-label="主要导航">
        <button className={selectedAlbum === '1' ? 'active' : ''} onClick={() => onSelectAlbum('1', '所有照片')}>
          <Image size={20} /><span>照片</span>
        </button>
        <button onClick={() => onSelectAlbum('2', '收藏')}>
          <Heart size={20} /><span>收藏</span>
        </button>
        <button onClick={() => onSelectAlbum('1', '最近添加')}>
          <Clock3 size={20} /><span>最近添加</span>
        </button>
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-section-title"><span>相册</span></div>
      <div className="album-list">
        {albums.slice(0, 8).map((album) => {
          const coverPhoto = album.cover_path
            ? ({ member_id: `cover-${album.album_uuid}`, path: album.cover_path, shot_time: '', modify_time: album.cover_mtime || '', size: '0' })
            : null;
          return (
            <button
              key={album.album_uuid}
              className={selectedAlbum === album.album_uuid ? 'active' : ''}
              onClick={() => onSelectAlbum(album.album_uuid, album.name || '未命名相册')}
            >
              <span className="album-cover">{coverPhoto ? <Thumbnail photo={coverPhoto} /> : <Image size={17} />}</span>
              <span className="album-name">{album.name || '未命名相册'}</span>
              <span className="album-count">{Number(album.photo_count || 0) + Number(album.video_count || 0)}</span>
            </button>
          );
        })}
      </div>
      <button className="settings-button" aria-label="设置"><Settings size={20} /></button>
    </aside>
  );
}
