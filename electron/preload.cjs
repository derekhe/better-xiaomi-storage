const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smartStorage', {
  getStatus: () => ipcRenderer.invoke('smart-storage:status'),
  listAlbums: () => ipcRenderer.invoke('smart-storage:list-albums'),
  listPhotos: (params) => ipcRenderer.invoke('smart-storage:list-photos', params),
  listPhotoIndex: (params) => ipcRenderer.invoke('smart-storage:list-photo-index', params),
  getThumbnail: (params) => ipcRenderer.invoke('smart-storage:get-thumbnail', params),
  getMediaUrl: (params) => ipcRenderer.invoke('smart-storage:get-media-url', params),
  reconnect: () => ipcRenderer.invoke('smart-storage:reconnect'),
});
