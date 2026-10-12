import type { ImageFeatures } from './lib/cleanup-metrics';
import type { CleanupOptions } from './lib/cleanup';
import type { ScanProgress, ScanResult } from './lib/cleanup-scan';

export interface QualityScore { modelId: string; quality: number; probabilities: number[]; scene: string; distortion: string; confidence: number }
export interface CleanupAnalysisParams { options: CleanupOptions; batchSize: number; model: 'liqe' | 'basic'; retryFailed?: boolean }
export interface CleanupAnalysisState { state: 'idle' | 'running' | 'pausing' | 'paused' | 'completed' | 'error'; revision: number; progress: ScanProgress | null; message: string; model?: 'liqe' | 'basic' }
export interface AnalysisHost {
  onStart(listener: (params: CleanupAnalysisParams & { jobId: number; modelId?: string }) => void): void;
  onPause(listener: () => void): void;
  update(jobId: number, update: object): Promise<void>;
  listPhotoIndex: SmartStorageApi['listPhotoIndex']; loadCleanupCache: SmartStorageApi['loadCleanupCache'];
  saveCleanupCache: SmartStorageApi['saveCleanupCache']; getThumbnail: SmartStorageApi['getThumbnail'];
  scorePhoto(dataUrl: string): Promise<QualityScore>;
}

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

export type CleanupPhotoSnapshot = Pick<Photo, 'path' | 'member_id' | 'modify_time' | 'size'>;

export interface CleanupCachedPhoto {
  photo: CleanupPhotoSnapshot;
  attemptedAt: number;
  metrics: { width: number; height: number; quality?: QualityScore; features: Omit<ImageFeatures, 'dHash' | 'vHash'> & { dHash: string; vHash: string } } | null;
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
  loadCleanupCache(): Promise<{ scope: string; entries: CleanupCachedPhoto[] }>;
  saveCleanupCache(params: { scope: string; entries: CleanupCachedPhoto[] }): Promise<void>;
  clearCleanupCache(): Promise<{ cancelled: boolean }>;
  trashPhotos(params: { photos: CleanupPhotoSnapshot[] }): Promise<{ cancelled: boolean; deletedPaths: string[]; failed: { path: string; message: string }[] }>;
  getThumbnail(params: { photoPath: string; quality?: 'small' | 'preview'; refresh?: boolean }): Promise<string>;
  getMediaUrl(params: { photoPath: string }): Promise<string>;
  reconnect(): Promise<ConnectionStatus>;
  getAnalysisState(): Promise<CleanupAnalysisState>;
  getAnalysisResult(): Promise<ScanResult | null>;
  getQualityModelStatus(): Promise<{ available: boolean; modelId: string; device: string }>;
  startAnalysis(params: CleanupAnalysisParams): Promise<CleanupAnalysisState>;
  pauseAnalysis(): Promise<CleanupAnalysisState>;
  onAnalysisChanged(listener: (state: CleanupAnalysisState) => void): () => void;
}

declare global {
  interface Window {
    smartStorage?: SmartStorageApi;
    analysisHost?: AnalysisHost;
  }
}
