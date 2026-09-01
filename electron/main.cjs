const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { SmartStorageClient } = require('./smart-storage-client.cjs');

let client;
let mainWindow;
const DEVELOPMENT_URL = 'http://127.0.0.1:5173/';

function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1050,
    minHeight: 680,
    title: '拾光',
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = app.isPackaged ? url.startsWith('file:') : url.startsWith(DEVELOPMENT_URL);
    if (!allowed) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL === DEVELOPMENT_URL.slice(0, -1)) {
    window.loadURL(DEVELOPMENT_URL);
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  }
}

function registerIpc() {
  const handle = (channel, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      const isMainWindow = BrowserWindow.fromWebContents(event.sender) === mainWindow;
      const isMainFrame = event.senderFrame === event.sender.mainFrame;
      if (!isMainWindow || !isMainFrame) throw new Error('不受信任的页面无法访问设备');
      return listener(...args);
    });
  };

  handle('smart-storage:status', () => client.getStatus());
  handle('smart-storage:reconnect', async () => {
    await client.connect({ force: true });
    return client.getStatus();
  });
  handle('smart-storage:list-albums', () => client.listAlbums());
  handle('smart-storage:list-photos', (params = {}) => {
    const albumId = String(params.albumId || '1').slice(0, 128);
    const offset = params.offset ? String(params.offset).slice(0, 256) : undefined;
    return client.listPhotos({ albumId, offset, count: params.count });
  });
  handle('smart-storage:list-photo-index', (params = {}) => {
    const albumId = String(params.albumId || '1').slice(0, 128);
    return client.listPhotoIndex({ albumId });
  });
  handle('smart-storage:get-thumbnail', (params = {}) => {
    const photoPath = String(params.photoPath || '');
    if (!photoPath || photoPath.length > 4096) throw new Error('照片路径无效');
    const quality = params.quality === 'preview' ? 'preview' : 'small';
    return client.getThumbnail({ photoPath, quality });
  });
}

app.whenReady().then(() => {
  client = new SmartStorageClient({ documentsPath: app.getPath('documents') });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
