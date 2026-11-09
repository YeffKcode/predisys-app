'use strict';
const AppError = require('../utils/AppError');

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Caracteres de control (excepto tab, salto de línea y retorno) y bytes nulos
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function clean(value, depth = 0) {
  if (depth > 10) throw new AppError(400, 'Estructura de datos demasiado profunda.', 'PAYLOAD_TOO_DEEP');
  if (typeof value === 'string') return value.replace(CONTROL_CHARS, '').normalize('NFC');
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k) || k.startsWith('$')) {
        throw new AppError(400, `Clave no permitida en la solicitud: ${k}`, 'FORBIDDEN_KEY');
      }
      out[k] = clean(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Defensa global: elimina caracteres de control y bloquea claves de contaminación de prototipo / operadores. */
module.exports = (req, res, next) => {
  try {
    if (req.body && typeof req.body === 'object') req.body = clean(req.body);
    for (const [k, v] of Object.entries(req.query || {})) {
      if (FORBIDDEN_KEYS.has(k) || k.startsWith('$')) throw new AppError(400, `Parámetro no permitido: ${k}`, 'FORBIDDEN_KEY');
      if (typeof v !== 'string') throw new AppError(400, `El parámetro ${k} debe ser un valor simple.`, 'INVALID_QUERY');
      req.query[k] = clean(v);
    }
    next();
  } catch (err) {
    next(err);
  }
};
