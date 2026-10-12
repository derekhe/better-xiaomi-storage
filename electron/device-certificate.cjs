const crypto = require('node:crypto');

function der(tag, data) {
  const size = data.length;
  const bytes = [];
  for (let remaining = size; remaining > 0; remaining >>>= 8) bytes.unshift(remaining & 255);
  const length = size < 128 ? Buffer.from([size]) : Buffer.from([128 | bytes.length, ...bytes]);
  return Buffer.concat([Buffer.from([tag]), length, data]);
}
const sequence = (...values) => der(0x30, Buffer.concat(values));
const attribute = (oid, value) => der(0x31, sequence(der(6, Buffer.from(oid)), der(19, Buffer.from(value, 'ascii'))));

function createDeviceCsr(uid, did) {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(String(uid)) || !/^[a-zA-Z0-9-]{1,128}$/.test(String(did))) throw new Error('设备身份无效');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const cn = `nas.${uid}.${crypto.createHash('sha1').update(String(did)).digest('hex')}.2`;
  const subject = sequence(attribute([85, 4, 10], 'Mijia Device'), attribute([85, 4, 6], 'CN'), attribute([85, 4, 3], cn));
  const algorithm = sequence(der(6, Buffer.from([43, 101, 112])));
  const info = sequence(der(2, Buffer.from([0])), subject, publicKey.export({ type: 'spki', format: 'der' }), der(0xa0, Buffer.alloc(0)));
  const request = sequence(info, algorithm, der(3, Buffer.concat([Buffer.from([0]), crypto.sign(null, info, privateKey)])));
  const base64 = request.toString('base64').match(/.{1,64}/g).join('\n');
  return { csrPem: `-----BEGIN CERTIFICATE REQUEST-----\n${base64}\n-----END CERTIFICATE REQUEST-----\n`,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

function validateDeviceCertificate(certPem, privateKeyPem, uid, did, caPem) {
  const certificate = new crypto.X509Certificate(certPem);
  const cn = `nas.${uid}.${crypto.createHash('sha1').update(String(did)).digest('hex')}.2`;
  if (!certificate.subject.split('\n').includes(`CN=${cn}`)
    || !certificate.checkPrivateKey(crypto.createPrivateKey(privateKeyPem))
    || Date.parse(certificate.validFrom) > Date.now()
    || Date.parse(certificate.validTo) <= Date.now() + 2 * 86400000) throw new Error('设备证书身份、密钥或有效期校验失败');
  const chain = (String(caPem).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [])
    .map(pem => new crypto.X509Certificate(pem));
  if (!chain.some(ca => ca.ca && certificate.checkIssued(ca) && certificate.verify(ca.publicKey))) throw new Error('设备证书签发者校验失败');
}

module.exports = { createDeviceCsr, validateDeviceCertificate };
