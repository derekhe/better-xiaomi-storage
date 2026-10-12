const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smartStorage', {
  getAccountStatus: () => ipcRenderer.invoke('smart-storage:account-status'),
  login: () => ipcRenderer.invoke('smart-storage:login'),
  selectDevice: (deviceId) => ipcRenderer.invoke('smart-storage:select-device', deviceId),
  logout: () => ipcRenderer.invoke('smart-storage:logout'),
  onAccountChanged: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('smart-storage:account-changed', handler);
    return () => ipcRenderer.removeListener('smart-storage:account-changed', handler);
  },
  getStatus: () => ipcRenderer.invoke('smart-storage:status'),
  listAlbums: () => ipcRenderer.invoke('smart-storage:list-albums'),
  listPhotos: (params) => ipcRenderer.invoke('smart-storage:list-photos', params),
  listPhotoIndex: (params) => ipcRenderer.invoke('smart-storage:list-photo-index', params),
  getThumbnail: (params) => ipcRenderer.invoke('smart-storage:get-thumbnail', params),
  getMediaUrl: (params) => ipcRenderer.invoke('smart-storage:get-media-url', params),
  reconnect: () => ipcRenderer.invoke('smart-storage:reconnect'),
});
