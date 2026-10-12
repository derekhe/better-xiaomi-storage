const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { app, BrowserWindow, ipcMain, protocol, safeStorage } = require('electron');
const { SmartStorageClient } = require('./smart-storage-client.cjs');
const { StandaloneSession } = require('./standalone-session.cjs');

let client;
let mainWindow;
let account;
const mediaSources = new Map();
const DEVELOPMENT_URL = 'http://127.0.0.1:5173/';
const mediaTypes = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.gif', 'image/gif'],
  ['.webp', 'image/webp'], ['.heic', 'image/heic'], ['.mp4', 'video/mp4'], ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'], ['.webm', 'video/webm'], ['.mkv', 'video/x-matroska'], ['.avi', 'video/x-msvideo'],
  ['.3gp', 'video/3gpp'], ['.mpg', 'video/mpeg'], ['.mpeg', 'video/mpeg'], ['.vob', 'video/mpeg'],
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'better-xiaomi-storage',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
  },
]);

function registerMediaProtocol() {
  protocol.handle('better-xiaomi-storage', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'media' || request.method !== 'GET') {
      return new Response('Not found', { status: 404 });
    }
    const photoPath = mediaSources.get(url.pathname.slice(1));
    if (!photoPath) return new Response('Media link expired', { status: 404 });
    const range = request.headers.get('range');
    if (range && !/^bytes=\d*-\d*$/.test(range)) {
      return new Response('Invalid range', { status: 416 });
    }

    try {
      const upstream = await client.openMediaStream({ photoPath, range });
      const headers = new Headers();
      for (const name of ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
        const value = upstream.headers[name];
        if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      }
      if (!headers.get('content-type') || headers.get('content-type') === 'application/octet-stream') {
        headers.set('content-type', mediaTypes.get(path.extname(photoPath).toLowerCase()) || 'application/octet-stream');
      }
      headers.set('cache-control', 'private, max-age=3600');
      return new Response(Readable.toWeb(upstream), { status: upstream.statusCode, headers });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : 'Media unavailable', { status: 502 });
    }
  });
}

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

  handle('smart-storage:account-status', () => account.status());
  handle('smart-storage:login', () => account.start());
  handle('smart-storage:select-device', async (deviceId) => {
    if (typeof deviceId !== 'string' || deviceId.length > 128) throw new Error('设备选择无效');
    client.resetConnection(); mediaSources.clear();
    await account.getConnection({ force: true, deviceId });
    await client.connect();
    return account.status();
  });
  handle('smart-storage:logout', async () => {
    client.resetConnection(); mediaSources.clear();
    return account.signOut();
  });

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
  handle('smart-storage:get-media-url', (params = {}) => {
    const photoPath = String(params.photoPath || '');
    if (!photoPath || photoPath.length > 4096) throw new Error('媒体路径无效');
    const token = randomUUID();
    mediaSources.set(token, photoPath);
    if (mediaSources.size > 200) mediaSources.delete(mediaSources.keys().next().value);
    return `better-xiaomi-storage://media/${token}`;
  });
}

app.whenReady().then(() => {
  account = new StandaloneSession({ userData: app.getPath('userData'), safeStorage,
    runtimeSource: app.isPackaged ? path.join(process.resourcesPath, 'xiaomi-runtime') : path.join(__dirname, '..', 'vendor', 'xiaomi-runtime') });
  client = new SmartStorageClient({ connectionProvider: options => account.getConnection(options) });
  account.on('status', status => {
    if (!['connecting', 'connected'].includes(status.state)) { client.resetConnection(); mediaSources.clear(); }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('smart-storage:account-changed', status);
  });
  registerMediaProtocol();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let exiting = false;
app.on('before-quit', event => {
  if (!account || exiting) return;
  event.preventDefault(); exiting = true;
  client.resetConnection(); account.stop().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
