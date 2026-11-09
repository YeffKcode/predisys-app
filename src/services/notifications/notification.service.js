'use strict';
const prisma = require('../../lib/prisma');
const env = require('../../config/env');
const logger = require('../../lib/logger');
const { encrypt, decrypt, maskEmail } = require('../../lib/crypto');
const { alertBus } = require('../events');
const email = require('./email.channel');
const sms = require('./sms.channel');
const { emailForAlert, smsForAlert } = require('./templates');

const SEV_RANK = { WARNING: 1, CRITICAL: 2 };
const DEFAULT_PREF = { emailEnabled: true, smsEnabled: false, minSeverity: 'CRITICAL', quietHoursStart: null, quietHoursEnd: null };
const CHANNELS = { EMAIL: email, SMS: sms };

// Dominios reservados que nunca reciben correo (RFC 2606 / 6761)
const UNDELIVERABLE = /@([^@]+\.)?(local|localhost|test|example|invalid|example\.(com|org|net))$/i;
const undeliverableReason = (channel, address) => (channel === 'EMAIL' && UNDELIVERABLE.test(address)
  ? `El dominio de ${maskEmail(address)} no existe: cambia el correo del usuario en su perfil.` : null);

const maskAddress = (channel, address) => (channel === 'EMAIL' ? maskEmail(address) : `***${String(address).slice(-4)}`);

function currentHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: env.alerts.timezone, hour: 'numeric', hourCycle: 'h23' }).format(date));
}

function inQuietHours(pref, date = new Date()) {
  const { quietHoursStart: s, quietHoursEnd: e } = pref;
  if (s == null || e == null || s === e) return false;
  const h = currentHour(date);
  return s < e ? h >= s && h < e : h >= s || h < e; // soporta rangos que cruzan medianoche (22 → 6)
}

/** Destinatarios según permisos, preferencias, horario silencioso y lista de guardia. */
async function resolveRecipients(alert, { escalation = false } = {}) {
  const permission = escalation ? 'alerts.manage' : 'alerts.read';
  const users = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { permissions: { some: { permission: { key: permission } } } } } } },
    include: { notificationPreference: true },
  });

  const out = [];
  for (const u of users) {
    const pref = u.notificationPreference || DEFAULT_PREF;
    if (!escalation && SEV_RANK[alert.severity] < SEV_RANK[pref.minSeverity]) continue;
    if (pref.emailEnabled) {
      const address = decrypt(u.emailEnc);
      out.push({ userId: u.id, channel: 'EMAIL', address, skipReason: undeliverableReason('EMAIL', address) });
    }
    if (pref.smsEnabled && pref.phoneEnc && pref.phoneVerifiedAt) {
      const quiet = alert.severity === 'WARNING' && inQuietHours(pref);
      out.push({ userId: u.id, channel: 'SMS', address: decrypt(pref.phoneEnc), skipReason: quiet ? 'Horario silencioso del usuario' : null });
    }
  }
  if (alert.severity === 'CRITICAL') {
    for (const address of env.alerts.oncallEmails) out.push({ userId: null, channel: 'EMAIL', address, skipReason: undeliverableReason('EMAIL', address) });
    for (const address of env.alerts.oncallPhones) out.push({ userId: null, channel: 'SMS', address });
  }
  const seen = new Set();
  return out.filter((r) => {
    const key = `${r.channel}:${String(r.address).toLowerCase()}`;
    if (!r.address || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function render(channel, alert, opts) {
  return channel === 'EMAIL' ? emailForAlert(alert, opts) : smsForAlert(alert, opts);
}

async function deliver(notification, alert) {
  const address = decrypt(notification.recipientEnc);
  try {
    const { providerMessageId, simulated } = await CHANNELS[notification.channel].send(address, render(notification.channel, alert, { escalation: notification.isEscalation }));
    if (simulated) {
      // Modo consola: se informa como omitido para que nadie crea que el aviso salió
      const skipped = await prisma.alertNotification.update({
        where: { id: notification.id },
        data: { status: 'SKIPPED', attempts: { increment: 1 }, nextAttemptAt: null, error: notification.channel === 'EMAIL' ? 'No enviado: SMTP_HOST vacío (modo consola)' : 'No enviado: SMS_PROVIDER=console' },
      });
      alertBus.emit('alert', { type: 'notification', alertId: alert.id, notification: publicNotification(skipped) });
      return skipped;
    }
    const updated = await prisma.alertNotification.update({
      where: { id: notification.id },
      data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date(), providerMessageId: providerMessageId ? String(providerMessageId).slice(0, 120) : null, error: null, nextAttemptAt: null },
    });
    alertBus.emit('alert', { type: 'notification', alertId: alert.id, notification: publicNotification(updated) });
    return updated;
  } catch (err) {
    const attempts = notification.attempts + 1;
    const final = attempts >= env.alerts.maxNotificationAttempts;
    logger.warn(`Notificación ${notification.channel} #${notification.id} falló (intento ${attempts}): ${err.message}`);
    if (final) logger.error(`Notificación ${notification.channel} #${notification.id} agotó reintentos para alerta ${alert.id}`, { error: err.message });
    return prisma.alertNotification.update({
      where: { id: notification.id },
      data: { status: 'FAILED', attempts, error: String(err.message).slice(0, 255), nextAttemptAt: final ? null : new Date(Date.now() + 2 ** attempts * 60000) },
    });
  }
}

/** Crea los registros de notificación y los envía en paralelo. Devuelve el resultado por destinatario. */
async function dispatchForAlert(alertId, { escalation = false } = {}) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return [];
  const recipients = await resolveRecipients(alert, { escalation });
  if (!recipients.length) {
    logger.warn(`Alerta ${alert.id} (${alert.machineCode}) sin destinatarios de notificación configurados`);
    return [];
  }
  const created = [];
  for (const r of recipients) {
    created.push(await prisma.alertNotification.create({
      data: {
        alertId, userId: r.userId, channel: r.channel,
        recipientEnc: encrypt(r.address), recipientMasked: maskAddress(r.channel, r.address),
        isEscalation: escalation, status: r.skipReason ? 'SKIPPED' : 'PENDING', error: r.skipReason || null,
      },
    }));
  }
  await Promise.allSettled(created.filter((n) => n.status === 'PENDING').map((n) => deliver(n, alert)));
  return prisma.alertNotification.findMany({ where: { id: { in: created.map((n) => n.id) } } });
}

/** Reintento con backoff exponencial (2, 4 min…). El claim atómico evita envíos dobles entre instancias. */
async function retryFailed() {
  const due = await prisma.alertNotification.findMany({
    where: { status: 'FAILED', attempts: { lt: env.alerts.maxNotificationAttempts }, nextAttemptAt: { lte: new Date() } },
    include: { alert: true },
    take: 50,
  });
  for (const n of due) {
    const claim = await prisma.alertNotification.updateMany({ where: { id: n.id, status: 'FAILED', attempts: n.attempts }, data: { status: 'PENDING' } });
    if (claim.count) await deliver(n, n.alert);
  }
  return due.length;
}

/** Envío directo (pruebas de canal, verificación de teléfono). */
async function sendDirect(channel, address, payload) {
  return CHANNELS[channel].send(address, payload);
}

const publicNotification = (n) => ({
  id: n.id, channel: n.channel, recipient: n.recipientMasked, status: n.status, attempts: n.attempts,
  isEscalation: n.isEscalation, error: n.error, sentAt: n.sentAt, createdAt: n.createdAt,
});

module.exports = { undeliverableReason, dispatchForAlert, retryFailed, sendDirect, resolveRecipients, inQuietHours, publicNotification, DEFAULT_PREF };
