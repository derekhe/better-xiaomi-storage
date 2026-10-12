export interface ConnectionStatus {
  connected: boolean;
  mode: 'companion' | 'standalone';
  port?: number;
  message?: string;
}

export interface AccountStatus {
  state: 'signed-out' | 'signing-in' | 'signed-in' | 'connecting' | 'connected' | 'error';
  runtimeAvailable: boolean;
  devices: { id: string; name: string; online: boolean }[];
  selectedDeviceId?: string;
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
  getAccountStatus(): Promise<AccountStatus>;
  login(): Promise<AccountStatus>;
  selectDevice(deviceId: string): Promise<AccountStatus>;
  logout(): Promise<AccountStatus>;
  onAccountChanged(listener: (status: AccountStatus) => void): () => void;
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
