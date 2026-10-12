const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = function validateRuntime() {
  const root = path.join(__dirname, '..', 'vendor', 'xiaomi-runtime');
  if (!fs.existsSync(path.join(root, 'manifest.json'))) throw new Error('打包前需要运行 npm run prepare:runtime，安装包必须携带登录组件');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  for (const name of ['小米智能存储.exe', 'SSO_Cef_Sub.exe', 'libcef.dll', 'icudtl.dat', 'SSO_SDK.ini', 'ca_chain.pem']) {
    if (!manifest.files[name]) throw new Error(`登录组件不完整：${name}`);
  }
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..')) throw new Error('登录组件路径无效');
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
    if (actual !== digest) throw new Error(`登录组件校验失败：${name}`);
  }
};
