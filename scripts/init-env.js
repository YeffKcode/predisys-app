'use strict';
/**
 * Crea o completa el .env de la raíz con secretos aleatorios.
 *   npm run init-env
 * - Si .env no existe: lo crea desde .env.example.
 * - Si existe: solo reemplaza valores que sigan con el marcador "CAMBIAR" (nunca toca secretos reales,
 *   para no invalidar datos ya cifrados).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');
const hex = (n) => crypto.randomBytes(n).toString('hex');
const GENERATORS = {
  JWT_SECRET: () => hex(32),
  DATA_ENCRYPTION_KEY: () => hex(32),
  EMAIL_HASH_KEY: () => hex(32),
  ML_SERVICE_TOKEN: () => hex(24),
};

const created = !fs.existsSync(envPath);
let content = fs.readFileSync(created ? examplePath : envPath, 'utf8');
const changed = [];
for (const [key, gen] of Object.entries(GENERATORS)) {
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const match = content.match(re);
  if (!match) { content += `\n${key}=${gen()}\n`; changed.push(key); continue; }
  if (!match[1].trim() || /CAMBIAR/i.test(match[1])) { content = content.replace(re, `${key}=${gen()}`); changed.push(key); }
}
fs.writeFileSync(envPath, content, { mode: 0o600 });
console.log(created ? '✔ .env creado desde .env.example' : '✔ .env revisado');
console.log(changed.length ? `  Secretos generados: ${changed.join(', ')}` : '  No había secretos pendientes.');
console.log('  El servicio ML lee este mismo archivo: reinicia la API y el servicio ML para aplicar los cambios.');
