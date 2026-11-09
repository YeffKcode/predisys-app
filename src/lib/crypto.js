'use strict';
const crypto = require('crypto');
const env = require('../config/env');

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

/** Cifra texto en reposo con AES-256-GCM (IV aleatorio + etiqueta de autenticación). */
function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, env.encryptionKey, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

function decrypt(payload) {
  if (!payload) return null;
  const [version, iv, tag, data] = String(payload).split(':');
  if (version !== VERSION || !iv || !tag || !data) throw new Error('Formato de dato cifrado no reconocido');
  const decipher = crypto.createDecipheriv(ALGO, env.encryptionKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

const normalizeEmail = (email) => String(email).trim().toLowerCase();

/** HMAC determinista: permite buscar y exigir unicidad sin guardar el correo en claro. */
function hashEmail(email) {
  return crypto.createHmac('sha256', env.emailHashKey).update(normalizeEmail(email)).digest('hex');
}

function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = String(email).split('@');
  return `${local.slice(0, 1)}***@${domain || ''}`;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const randomNumericCode = (len = 6) => String(crypto.randomInt(0, 10 ** len)).padStart(len, '0');

module.exports = { encrypt, decrypt, normalizeEmail, hashEmail, maskEmail, sha256, randomNumericCode };
