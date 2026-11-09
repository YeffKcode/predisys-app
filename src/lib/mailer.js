'use strict';
const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('./logger');

const transporter = env.smtp.host
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : nodemailer.createTransport({ jsonTransport: true });

async function sendResetCode(to, code, minutes) {
  const text = `Tu código de recuperación de PrediSys es: ${code}\nVence en ${minutes} minutos. Si no lo solicitaste, ignora este mensaje.`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#0b1120;color:#e2e8f0;padding:32px">
      <h2 style="color:#22d3ee;margin:0 0 16px">PrediSys · Recuperación de contraseña</h2>
      <p>Usa este código para restablecer tu contraseña:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#f8fafc">${code}</p>
      <p style="color:#94a3b8">Vence en ${minutes} minutos. Si no lo solicitaste, ignora este mensaje.</p>
    </div>`;
  await transporter.sendMail({ from: env.smtp.from, to, subject: 'PrediSys · Código de recuperación', text, html });
  if (!env.smtp.host) {
    // Solo en desarrollo (en producción SMTP es obligatorio, ver config/env.js)
    console.log(`\n[DEV-MAIL] Código de recuperación para ${to}: ${code}\n`);
  }
  logger.info(`Código de recuperación enviado a ${to.replace(/^(.).*@/, '$1***@')}`);
}

/** Envío genérico (alertas, pruebas). Devuelve el messageId del proveedor. */
async function sendMail({ to, subject, text, html }) {
  const info = await transporter.sendMail({ from: env.smtp.from, to, subject, text, html });
  if (!env.smtp.host) {
    console.log(`\n[DEV-MAIL · NO ENVIADO] Para: ${to}\nAsunto: ${subject}\n${text}\n`);
    return { messageId: null, simulated: true };
  }
  return { messageId: info.messageId || null, simulated: false };
}

/** Comprueba conexión y credenciales SMTP sin enviar nada. */
async function verifySmtp() {
  if (!env.smtp.host) return { ok: false, mode: 'console', error: 'SMTP_HOST está vacío: los correos solo se imprimen en la consola de la API.' };
  try {
    await transporter.verify();
    return { ok: true, mode: 'smtp' };
  } catch (err) {
    return { ok: false, mode: 'smtp', error: explainSmtpError(err) };
  }
}

function explainSmtpError(err) {
  const m = String(err.message || err);
  if (err.code === 'EAUTH' || /535|534|Invalid login|Username and Password/i.test(m)) {
    return `Credenciales rechazadas (${err.responseCode || err.code}). Con Gmail usa una «contraseña de aplicación», no tu contraseña normal.`;
  }
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'ECONNECTION'].includes(err.code)) {
    return `No se pudo conectar a ${env.smtp.host}:${env.smtp.port} (${err.code}). Revisa host, puerto y SMTP_SECURE (true solo con el puerto 465).`;
  }
  if (err.code === 'EDNS' || err.code === 'ENOTFOUND') return `El host ${env.smtp.host} no existe.`;
  return m.slice(0, 200);
}

module.exports = { sendResetCode, sendMail, verifySmtp, explainSmtpError };
