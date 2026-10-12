// Import immutable runtime files only. Never copy the installed client's profile.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { X509Certificate } = crypto;
const asar = require('@electron/asar');
const args = process.argv.slice(2);
const index = args.indexOf('--source');
const source = index >= 0 ? path.resolve(args[index + 1])
  : path.join(process.env.LOCALAPPDATA || '', 'Programs', 'SmartStorage', 'resources', 'extraResources', 'windows');
const target = path.join(__dirname, '..', 'vendor', 'xiaomi-runtime');
const executable = '小米智能存储.exe';
if (!fs.existsSync(path.join(source, executable))) throw new Error('未找到登录/P2P运行组件，请用 --source 指向官方安装包解压后的 extraResources/windows 目录');
if (fs.existsSync(target)) throw new Error('vendor/xiaomi-runtime 已存在；请先检查或移走旧组件，避免混用版本');
const asarPath = path.resolve(source, '..', '..', 'app.asar');
const metadata = JSON.parse(asar.extractFile(asarPath, 'package.json').toString());
const files = fs.readdirSync(source).filter(name => /\.(dll|pak|bin)$/i.test(name)
  || [executable, 'SSO_CallCurl.exe', 'SSO_Cef_Sub.exe', 'sso_login.exe', 'icudtl.dat', 'cacert.pem', 'SSO_SDK.ini'].includes(name));
for (const dir of ['locales', 'swiftshader', 'disconnect_page']) {
  const directory = path.join(source, dir);
  if (!fs.existsSync(directory)) continue;
  for (const entry of fs.readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(pak|dll|html|css|js|png|svg|jpg)$/i.test(entry.name)) continue;
    files.push(path.relative(source, path.join(entry.parentPath || entry.path, entry.name)));
  }
}
fs.mkdirSync(target, { recursive: true });
const manifest = { version: `${metadata.version}.${metadata.extVersion || '0'}`, executable, files: {} };
for (const name of files) {
  const data = fs.readFileSync(path.join(source, name));
  fs.mkdirSync(path.dirname(path.join(target, name)), { recursive: true });
  fs.writeFileSync(path.join(target, name), data);
  manifest.files[name] = crypto.createHash('sha256').update(data).digest('hex');
}
// The public CA chain is part of the official distribution, not a user certificate.
const ca = asar.extractFile(asarPath, 'ca_chain.pem');
for (const pem of ca.toString().match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []) new X509Certificate(pem);
if (!ca.includes(Buffer.from('BEGIN CERTIFICATE'))) throw new Error('官方运行组件缺少 CA 链');
fs.writeFileSync(path.join(target, 'ca_chain.pem'), ca);
manifest.files['ca_chain.pem'] = crypto.createHash('sha256').update(ca).digest('hex');
const license = asar.extractFile(asarPath, 'LICENSE');
fs.writeFileSync(path.join(target, 'LICENSE.xiaomi.txt'), license);
manifest.files['LICENSE.xiaomi.txt'] = crypto.createHash('sha256').update(license).digest('hex');
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`已准备 ${Object.keys(manifest.files).length} 个运行文件；未复制 Cookie、账号缓存、日志或用户证书。`);
