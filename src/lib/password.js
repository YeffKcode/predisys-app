'use strict';
const bcrypt = require('bcryptjs');
const env = require('../config/env');

// Hash ficticio para igualar tiempos cuando el usuario no existe (evita enumeración por timing)
const DUMMY_HASH = bcrypt.hashSync('predisys-dummy-password', 10);

const hashPassword = (plain) => bcrypt.hash(plain, env.bcryptRounds);
const verifyPassword = (plain, hash) => bcrypt.compare(String(plain), hash || DUMMY_HASH);

/** Detecta 4+ dígitos consecutivos ascendentes o descendentes (1234, 9876, 123456789101112…). */
function hasSequentialDigits(value) {
  for (let i = 0; i + 3 < value.length; i++) {
    const chunk = value.slice(i, i + 4);
    if (!/^\d{4}$/.test(chunk)) continue;
    const d = chunk.split('').map(Number);
    const asc = d.every((n, k) => k === 0 || n === d[k - 1] + 1);
    const desc = d.every((n, k) => k === 0 || n === d[k - 1] - 1);
    if (asc || desc) return true;
  }
  return false;
}

/**
 * Política de contraseñas. Se aplica a registro, restablecimiento, perfil
 * y también a la anulación administrativa (un admin no puede poner "a").
 */
function validatePasswordPolicy(password, { username, email } = {}) {
  const errors = [];
  if (typeof password !== 'string' || password.length === 0) return ['La contraseña es obligatoria.'];
  if (password.length < 10) errors.push('Debe tener al menos 10 caracteres.');
  if (Buffer.byteLength(password, 'utf8') > 72) errors.push('No puede superar 72 bytes (límite de bcrypt).');
  if (!/[a-z]/.test(password)) errors.push('Debe incluir al menos una letra minúscula.');
  if (!/[A-Z]/.test(password)) errors.push('Debe incluir al menos una letra mayúscula.');
  if (!/\d/.test(password)) errors.push('Debe incluir al menos un número.');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Debe incluir al menos un carácter especial.');
  if (/^\d+$/.test(password)) errors.push('No puede estar compuesta solo por números.');
  if (hasSequentialDigits(password)) errors.push('No puede contener secuencias numéricas consecutivas (ej. 1234 o 123456789101112131415).');
  if (/(.)\1{3,}/.test(password)) errors.push('No puede repetir el mismo carácter 4 o más veces seguidas.');
  if (/\s/.test(password)) errors.push('No puede contener espacios.');
  const lower = password.toLowerCase();
  if (username && username.length >= 3 && lower.includes(username.toLowerCase())) errors.push('No puede contener el nombre de usuario.');
  if (email) {
    const local = String(email).split('@')[0].toLowerCase();
    if (local.length >= 3 && lower.includes(local)) errors.push('No puede contener la parte local del correo.');
  }
  return errors;
}

module.exports = { hashPassword, verifyPassword, validatePasswordPolicy, hasSequentialDigits };
