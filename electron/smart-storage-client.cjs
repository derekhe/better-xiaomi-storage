const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { X509Certificate } = require('node:crypto');

const TOKEN_PATH = '/cgi-bin/luci/plugincenter/get_access_token';
const ALBUM_ROOT = '/cgi-bin/luci/album';
const THUMBNAIL_PATH = '/cgi-bin/luci/filemgr/get_thumbnail';

function extractPortCandidatesFromText(text) {
  const matches = [];
  const patterns = [
    /["']?urlport["']?\s*[:=]\s*["']?(\d{4,5})/gi,
    /port=(\d{4,5})[^\r\n]*hasToken/gi,
    /https:\/\/127\.0\.0\.1:(\d{4,5})\/cgi-bin\/luci\/(?:plugincenter|get_thumbnail|filemgr)/gi,
    /https:\/\/127\.0\.0\.1:(\d{4,5})\/cgi-bin\/luci\//gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const port = Number(match[1]);
      if (port > 1024 && port < 65536) matches.push({ port, index: match.index });
    }
  }

  return [...new Map(matches.sort((a, b) => b.index - a.index).map((item) => [item.port, item])).keys()];
}

function readTail(filePath, maxBytes = 2 * 1024 * 1024) {
  const stat = fs.statSync(filePath);
  const size = Math.min(stat.size, maxBytes);
  const buffer = Buffer.alloc(size);
  const file = fs.openSync(filePath, 'r');
  try {
    fs.readSync(file, buffer, 0, size, stat.size - size);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(file);
  }
}

function parseStreamPhotoList(text) {
  return String(text || '')
    .trim()
    .split(/\n\s*=\s*\n/)
    .filter(Boolean)
    .slice(1)
    .map((record) => {
      const photo = {};
      for (const line of record.split('\n').filter((value) => value.trim())) {
        const separator = line.indexOf(':');
        if (separator < 0) continue;
        let key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (key === 'id') key = 'member_id';
        if (key === 'mtime') key = 'modify_time';
        if (key === 'stime') key = 'shot_time';
        photo[key] = value;
      }
      if (photo.shot_time === '3600000000' && photo.modify_time) photo.shot_time = photo.modify_time;
      return photo;
    })
    .filter((photo) => Object.prototype.hasOwnProperty.call(photo, 'path'));
}

class SmartStorageClient {
  constructor({ documentsPath, localAppData = process.env.LOCALAPPDATA } = {}) {
    this.documentsPath = documentsPath || path.join(process.env.USERPROFILE || '', 'Documents');
    this.localAppData = localAppData;
    this.port = null;
    this.agent = null;
    this.certificate = null;
    this.connectPromise = null;
    this.thumbnailCache = new Map();
  }

  findCertificate() {
    if (!this.localAppData) throw new Error('无法定位 Windows 本地应用数据目录');
    const certDirectory = path.join(this.localAppData, 'minasCert');
    if (!fs.existsSync(certDirectory)) {
      throw new Error('尚未找到设备证书，请先登录并打开小米智能存储客户端');
    }

    const candidates = fs
      .readdirSync(certDirectory)
      .filter((name) => name.endsWith('_cert.pem'))
      .map((name) => ({ name, mtime: fs.statSync(path.join(certDirectory, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const candidate of candidates) {
      const match = candidate.name.match(/^(.+)_([^_]+)_cert\.pem$/);
      if (!match) continue;
      const [, uid, did] = match;
      const certPath = path.join(certDirectory, candidate.name);
      const keyPath = path.join(certDirectory, `${uid}_${did}_private_key.pem`);
      const caPath = path.join(certDirectory, 'ca_chain.pem');
      if (![certPath, keyPath, caPath].every(fs.existsSync)) continue;

      const certificate = new X509Certificate(fs.readFileSync(certPath));
      const now = Date.now();
      if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo)) continue;
      return { uid, did, certPath, keyPath, caPath, certDirectory };
    }

    throw new Error('没有找到完整且有效的设备证书，请重新打开官方客户端');
  }

  createAgent(certificate) {
    const expectedHash = crypto.createHash('sha1').update(certificate.did).digest('hex');
    return new https.Agent({
      cert: fs.readFileSync(certificate.certPath),
      key: fs.readFileSync(certificate.keyPath),
      ca: fs.readFileSync(certificate.caPath),
      rejectUnauthorized: true,
      keepAlive: true,
      maxSockets: 10,
      checkServerIdentity: (_hostname, peerCertificate) => {
        const cn = peerCertificate.subject?.CN;
        if (!cn) return new Error('设备证书缺少 CN');
        const parts = cn.split('.');
        if (parts.length < 4 || parts[0] !== 'nas') return new Error('设备证书 CN 格式无效');
        if (parts[2] !== expectedHash || parts[3] !== '0') return new Error('设备证书身份校验失败');
        return undefined;
      },
    });
  }

  findPortCandidates() {
    const logDirectory = path.join(this.documentsPath, 'mijiaNas', 'log');
    if (!fs.existsSync(logDirectory)) return [];
    const logs = fs
      .readdirSync(logDirectory)
      .filter((name) => /^(?:app|request)-.*\.log$/i.test(name))
      .map((name) => ({ path: path.join(logDirectory, name), mtime: fs.statSync(path.join(logDirectory, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 4);
    const candidates = [];
    for (const log of logs) {
      for (const port of extractPortCandidatesFromText(readTail(log.path))) {
        if (!candidates.includes(port)) candidates.push(port);
      }
    }
    return candidates;
  }

  rawRequest(port, requestPath, data, { responseType = 'json', timeout = 8000, maxBytes } = {}) {
    return new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify(data ?? {}));
      const responseLimit = maxBytes || (responseType === 'text' ? 128 * 1024 * 1024 : responseType === 'buffer' ? 32 * 1024 * 1024 : 16 * 1024 * 1024);
      const request = https.request(
        {
          hostname: '127.0.0.1',
          port,
          path: requestPath,
          method: 'POST',
          agent: this.agent,
          timeout,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
            'User-Agent': 'ShiguangGallery/0.1 (Windows)',
          },
        },
        (response) => {
          const chunks = [];
          let receivedBytes = 0;
          response.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (receivedBytes > responseLimit) {
              request.destroy(new Error('设备返回的数据过大'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (response.statusCode < 200 || response.statusCode >= 300) {
              reject(new Error(`设备返回 HTTP ${response.statusCode}`));
              return;
            }
            if (responseType === 'buffer') {
              resolve({ data: buffer, contentType: response.headers['content-type'] || 'application/octet-stream' });
              return;
            }
            if (responseType === 'text') {
              resolve(buffer.toString('utf8'));
              return;
            }
            try {
              resolve(JSON.parse(buffer.toString('utf8')));
            } catch {
              reject(new Error('设备返回了无法解析的数据'));
            }
          });
        },
      );
      request.on('timeout', () => request.destroy(new Error('连接设备超时')));
      request.on('error', reject);
      request.end(body);
    });
  }

  async connect({ force = false } = {}) {
    if (!force && this.port && this.agent) return this.port;
    if (!force && this.connectPromise) return this.connectPromise;
    this.connectPromise = (async () => {
      this.certificate = this.findCertificate();
      this.agent = this.createAgent(this.certificate);
      const candidates = this.findPortCandidates();
      if (!candidates.length) {
        throw new Error('未找到设备通道，请先打开官方客户端并进入一次相册');
      }
      for (const port of candidates) {
        try {
          const result = await this.rawRequest(port, TOKEN_PATH, {}, { timeout: 1200 });
          if (result?.code === 0 && result?.data?.token) {
            this.port = port;
            return port;
          }
        } catch {
          // Continue with the next recent tunnel candidate.
        }
      }
      throw new Error('设备通道当前不可用，请确认官方客户端已连接到存储设备');
    })();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async requestJson(requestPath, data) {
    const port = await this.connect();
    try {
      const result = await this.rawRequest(port, requestPath, data);
      if (typeof result?.code === 'number' && result.code !== 0) {
        throw new Error(result.result || `设备错误 ${result.code}`);
      }
      return result;
    } catch (error) {
      if (/ECONNREFUSED|socket hang up|连接设备超时/i.test(String(error?.message || error))) {
        this.port = null;
      }
      throw error;
    }
  }

  async getStatus() {
    try {
      const port = await this.connect();
      return { connected: true, port, mode: 'companion' };
    } catch (error) {
      return { connected: false, mode: 'companion', message: error.message };
    }
  }

  async listAlbums() {
    const response = await this.requestJson(`${ALBUM_ROOT}/list_album`, {});
    return response?.data?.albums || [];
  }

  async listPhotos({ albumId = '1', offset, count = 80 } = {}) {
    const payload = { uuid: String(albumId), count: Math.max(1, Math.min(Number(count) || 80, 200)) };
    if (offset) payload.offset = String(offset);
    const response = await this.requestJson(`${ALBUM_ROOT}/list_member`, payload);
    return response?.data?.photos || [];
  }

  async listPhotoIndex({ albumId = '1' } = {}) {
    const port = await this.connect();
    const text = await this.rawRequest(
      port,
      `${ALBUM_ROOT}/list_member`,
      { uuid: String(albumId), count: -1, stream: 1 },
      { responseType: 'text', timeout: 120000 },
    );
    return parseStreamPhotoList(text);
  }

  async getThumbnail({ photoPath, quality = 'small' }) {
    const cacheKey = `${quality}:${photoPath}`;
    if (this.thumbnailCache.has(cacheKey)) return this.thumbnailCache.get(cacheKey);
    const task = (async () => {
      const port = await this.connect();
      const response = await this.rawRequest(
        port,
        THUMBNAIL_PATH,
        { path: photoPath, size: quality },
        { responseType: 'buffer', timeout: quality === 'small' ? 12000 : 30000 },
      );
      if (!String(response.contentType).startsWith('image/')) throw new Error('设备未返回图片');
      const dataUrl = `data:${response.contentType};base64,${response.data.toString('base64')}`;
      if (this.thumbnailCache.size > 300) this.thumbnailCache.delete(this.thumbnailCache.keys().next().value);
      return dataUrl;
    })();
    this.thumbnailCache.set(cacheKey, task);
    try {
      return await task;
    } catch (error) {
      this.thumbnailCache.delete(cacheKey);
      throw error;
    }
  }
}

module.exports = { SmartStorageClient, extractPortCandidatesFromText, parseStreamPhotoList };
