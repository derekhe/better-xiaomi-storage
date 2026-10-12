const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage } = require('electron');
const { SmartStorageClient } = require('./smart-storage-client.cjs');
const { StandaloneSession } = require('./standalone-session.cjs');
const { trashPhotos } = require('./cleanup-trash.cjs');
const { CleanupCache, cleanupScope } = require('./cleanup-cache.cjs');
const { BackgroundAnalysis } = require('./background-analysis.cjs');
const { LiqeProcess } = require('./liqe.cjs');

// Keep the existing account and analysis profile when the display name changes.
const configuredProfile = app.getPath('userData');
const defaultProfile = path.join(app.getPath('appData'), app.getName());
app.setName('映集');
app.setPath('userData', path.resolve(configuredProfile).toLowerCase() === path.resolve(defaultProfile).toLowerCase()
  ? path.join(app.getPath('appData'), 'better-xiaomi-storage') : configuredProfile);
if (process.platform === 'win32') app.setAppUserModelId('io.github.derekhe.better-xiaomi-storage');

let client;
let mainWindow;
let account;
let cleaning = false;
let cleanupCache;
let analysis;
let liqe;
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
    title: '映集',
    icon: path.join(__dirname, '..', 'dist', 'renderer', 'brand', 'app.ico'),
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
  window.once('closed', () => { if (mainWindow === window) { mainWindow = null; if (process.platform !== 'darwin') app.quit(); } });
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
  const handle = (channel, listener, backgroundAllowed = false) => {
    ipcMain.handle(channel, (event, ...args) => {
      const isMainWindow = BrowserWindow.fromWebContents(event.sender) === mainWindow;
      const isBackground = backgroundAllowed && BrowserWindow.fromWebContents(event.sender) === analysis.surface;
      const isMainFrame = event.senderFrame === event.sender.mainFrame;
      if ((!isMainWindow && !isBackground) || !isMainFrame) throw new Error('不受信任的页面无法访问设备');
      if (isBackground && analysis.state.scope !== cacheScope()) throw new Error('账号或设备已变化，后台分析已停止');
      return listener(...args);
    });
  };

  handle('smart-storage:account-status', () => account.status());
  handle('smart-storage:login', () => {
    if (cleaning) throw new Error('正在清理照片，请稍后再操作账号');
    return account.start();
  });
  handle('smart-storage:select-device', async (deviceId) => {
    if (cleaning) throw new Error('正在清理照片，请稍后再切换设备');
    if (typeof deviceId !== 'string' || deviceId.length > 128) throw new Error('设备选择无效');
    await analysis.pause(); analysis.reset();
    client.resetConnection(); mediaSources.clear();
    await account.getConnection({ force: true, deviceId });
    await client.connect();
    return account.status();
  });
  handle('smart-storage:logout', async () => {
    if (cleaning) throw new Error('正在清理照片，请稍后再退出账号');
    await analysis.pause(); analysis.reset(); await liqe.stop();
    client.resetConnection(); mediaSources.clear();
    return account.signOut();
  });

  handle('smart-storage:status', () => client.getStatus());
  handle('smart-storage:reconnect', async () => {
    if (cleaning) throw new Error('正在清理照片，请稍后再重新连接');
    await analysis.pause();
    await client.connect({ force: true });
    return client.getStatus();
  });
  handle('smart-storage:list-albums', () => client.listAlbums());
  handle('smart-storage:list-photos', (params = {}) => {
    const albumId = String(params.albumId || '1').slice(0, 128);
    const offset = params.offset ? String(params.offset).slice(0, 256) : undefined;
    return client.listPhotos({ albumId, offset, count: params.count });
  });
  handle('smart-storage:list-photo-index', async (params = {}) => {
    const albumId = String(params.albumId || '1').slice(0, 128);
    const scope = cacheScope(), result = await client.listPhotoIndex({ albumId });
    if (cacheScope() !== scope) throw new Error('账号或设备已变化，请重新读取照片');
    return result;
  }, true);
  const cacheScope = () => cleanupScope(account.session?.uid, account.session?.selectedDeviceId || account.status().selectedDeviceId);
  handle('smart-storage:load-cleanup-cache', async () => {
    const scope = cacheScope();
    const entries = await cleanupCache.load(scope);
    if (cacheScope() !== scope) throw new Error('账号或设备已变化，请重新打开照片清理');
    return { scope, entries };
  }, true);
  handle('smart-storage:save-cleanup-cache', async (params = {}) => {
    const scope = cacheScope();
    if (params.scope !== scope) throw new Error('账号或设备已变化，已停止保存旧设备的分析');
    await cleanupCache.save(scope, params.entries);
  }, true);
  handle('smart-storage:clear-cleanup-cache', async () => {
    if (analysis.running) throw new Error('请先暂停后台分析');
    const scope = cacheScope();
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: '重新开始照片分析', message: '清空这台设备在本机的分析进度？',
      detail: '下次分析需要重新读取照片预览图。', buttons: ['取消', '清空并重新分析'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response !== 1) return { cancelled: true };
    if (cacheScope() !== scope) throw new Error('账号或设备已变化，请重新打开照片清理');
    await cleanupCache.clear(scope);
    analysis.reset();
    return { cancelled: false };
  });
  handle('smart-storage:trash-photos', async (params = {}) => {
    if (cleaning) throw new Error('正在处理清理请求，请稍等');
    if (analysis.running) throw new Error('请先暂停后台分析，再确认清理');
    const deviceId = account.status().selectedDeviceId;
    const assertSession = () => {
      const status = account.status();
      if (!deviceId || status.state !== 'connected' || status.selectedDeviceId !== deviceId) {
        throw new Error('设备连接已变化，请重新连接并分析照片');
      }
    };
    assertSession();
    cleaning = true;
    try {
      return await trashPhotos(client, params.photos, async ({ count, bytes }) => {
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'warning', title: '确认清理照片',
          message: `将 ${count} 张照片移入设备回收站？`,
          detail: `所选文件共 ${(bytes / 1024 / 1024).toFixed(1)} MB。\n请确认已预览并保留需要的照片。回收站保留期间可能不会立即释放空间，可在官方客户端查看或恢复。`,
          buttons: ['取消', '移入回收站'], defaultId: 0, cancelId: 0, noLink: true,
        });
        return result.response === 1;
      }, assertSession);
    } finally { cleaning = false; }
  });
  handle('smart-storage:get-thumbnail', (params = {}) => {
    const photoPath = String(params.photoPath || '');
    if (!photoPath || photoPath.length > 4096) throw new Error('照片路径无效');
    const quality = params.quality === 'preview' ? 'preview' : 'small';
    return client.getThumbnail({ photoPath, quality, refresh: params.refresh === true });
  }, true);
  handle('smart-storage:analysis-state', () => analysis.state);
  handle('smart-storage:analysis-result', () => analysis.state.scope === cacheScope() ? analysis.result : null);
  handle('smart-storage:quality-model-status', () => liqe.status());
  handle('smart-storage:start-analysis', async (params = {}) => {
    if (cleaning || analysis.running) throw new Error('请等待当前操作结束');
    if (!['basic', 'liqe'].includes(params.model) || ![50, 200, 500].includes(params.batchSize)
      || !['strict', 'standard'].includes(params.options?.strictness) || ![1, 2, 3].includes(params.options?.keepCount)) throw new Error('分析选项无效');
    const scope = cacheScope();
    if (account.status().state !== 'connected') throw new Error('请先连接存储设备');
    if (params.model === 'liqe' && !liqe.status().available) throw new Error('LIQE 模型尚未准备，请先运行 npm run prepare:liqe');
    await liqe.stop();
    if (cacheScope() !== scope || analysis.running) throw new Error('设备或分析状态已变化，请重试');
    // Publish the job immediately; the first AI call initializes the model in its own process.
    return analysis.start(scope, { options: params.options, model: params.model, batchSize: params.batchSize,
      retryFailed: params.retryFailed === true, modelId: params.model === 'liqe' ? liqe.status().modelId : undefined });
  });
  handle('smart-storage:pause-analysis', () => analysis.pause());
  ipcMain.handle('analysis:update', (event, jobId, update) => {
    if (BrowserWindow.fromWebContents(event.sender) !== analysis.surface || event.senderFrame !== event.sender.mainFrame) throw new Error('后台分析来源无效');
    if (analysis.state.scope !== cacheScope()) throw new Error('账号或设备已变化，后台分析已停止');
    analysis.accept(jobId, update);
  });
  ipcMain.handle('analysis:score-photo', async (event, dataUrl) => {
    if (BrowserWindow.fromWebContents(event.sender) !== analysis.surface || event.senderFrame !== event.sender.mainFrame || analysis.state.scope !== cacheScope()) throw new Error('后台分析来源无效');
    const scope = cacheScope(), result = await liqe.score(dataUrl);
    if (cacheScope() !== scope) throw new Error('账号或设备已变化，后台分析已停止');
    return result;
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
  liqe = new LiqeProcess(app.isPackaged ? path.join(process.resourcesPath, 'liqe-runtime') : path.join(__dirname, '..', 'vendor', 'liqe-runtime'));
  analysis = new BackgroundAnalysis(() => {
    const window = new BrowserWindow({ show: false, width: 320, height: 240,
      webPreferences: { preload: path.join(__dirname, 'analysis-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.once('render-process-gone', () => analysis.finish('error', '后台分析进程已退出，已保存的进度可继续'));
    return { window, ready: window.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'analysis.html')) };
  });
  analysis.on('change', state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('smart-storage:analysis-changed', state); });
  analysis.on('settled', () => { void liqe.stop(); });
  cleanupCache = new CleanupCache({ root: path.join(app.getPath('userData'), 'photo-analysis'), safeStorage });
  account = new StandaloneSession({ userData: app.getPath('userData'), safeStorage,
    runtimeSource: app.isPackaged ? path.join(process.resourcesPath, 'xiaomi-runtime') : path.join(__dirname, '..', 'vendor', 'xiaomi-runtime') });
  client = new SmartStorageClient({ connectionProvider: options => account.getConnection(options) });
  account.on('status', status => {
    if (!['connected', 'connecting'].includes(status.state) && analysis.running) void analysis.pause();
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
  analysis.pause().then(() => liqe.stop()).finally(() => { client.resetConnection(); account.stop().finally(() => app.quit()); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
