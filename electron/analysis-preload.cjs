const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('analysisHost', {
  onStart: listener => ipcRenderer.once('analysis:start', (_event, params) => listener(params)),
  onPause: listener => ipcRenderer.on('analysis:pause', listener),
  update: (jobId, update) => ipcRenderer.invoke('analysis:update', jobId, update),
  listPhotoIndex: params => ipcRenderer.invoke('smart-storage:list-photo-index', params),
  loadCleanupCache: () => ipcRenderer.invoke('smart-storage:load-cleanup-cache'),
  saveCleanupCache: params => ipcRenderer.invoke('smart-storage:save-cleanup-cache', params),
  getThumbnail: params => ipcRenderer.invoke('smart-storage:get-thumbnail', params),
  scorePhoto: dataUrl => ipcRenderer.invoke('analysis:score-photo', dataUrl),
});
