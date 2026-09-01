export interface ConnectionStatus {
  connected: boolean;
  mode: 'companion';
  port?: number;
  message?: string;
}

export interface Album {
  album_uuid: string;
  name: string;
  type: string;
  photo_count: number;
  video_count: number;
  cover_path?: string;
  cover_mtime?: string;
  attr?: string;
}

export interface Photo {
  member_id: string;
  path: string;
  size: string;
  modify_time: string;
  shot_time: string;
  latitude?: string;
  longitude?: string;
  location?: string;
  mockUrl?: string;
  mockMediaUrl?: string;
}

export interface SmartStorageApi {
  getStatus(): Promise<ConnectionStatus>;
  listAlbums(): Promise<Album[]>;
  listPhotos(params: { albumId: string; offset?: string; count?: number }): Promise<Photo[]>;
  listPhotoIndex(params: { albumId: string }): Promise<Photo[]>;
  getThumbnail(params: { photoPath: string; quality?: 'small' | 'preview' }): Promise<string>;
  getMediaUrl(params: { photoPath: string }): Promise<string>;
  reconnect(): Promise<ConnectionStatus>;
}

declare global {
  interface Window {
    smartStorage?: SmartStorageApi;
  }
}
