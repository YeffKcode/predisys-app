'use strict';
const prisma = require('../lib/prisma');
const env = require('../config/env');
const { verifySmtp } = require('../lib/mailer');
const { smsStatus } = require('../services/notifications/sms.channel');
const notifications = require('../services/notifications/notification.service');
const { decrypt, maskEmail } = require('../lib/crypto');

/** Estado de los canales y quién recibiría una alerta CRÍTICA ahora mismo (y por qué no). */
async function status(req, res) {
  const [email, recipients, recent] = await Promise.all([
    verifySmtp(),
    notifications.resolveRecipients({ severity: 'CRITICAL' }),
    prisma.alertNotification.groupBy({ by: ['channel', 'status'], where: { createdAt: { gte: new Date(Date.now() - 86400000) } }, _count: true }),
  ]);
  const users = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { permissions: { some: { permission: { key: 'alerts.read' } } } } } } },
    include: { notificationPreference: true },
    orderBy: { username: 'asc' },
  });
  const sms = smsStatus();
  const people = users.map((u) => {
    const pref = u.notificationPreference || notifications.DEFAULT_PREF;
    let address = null;
    try { address = decrypt(u.emailEnc); } catch { /* clave cambiada */ }
    const issues = [];
    if (!pref.emailEnabled) issues.push('Correo desactivado en su perfil.');
    else if (!address) issues.push('No se puede descifrar su correo (cambió DATA_ENCRYPTION_KEY).');
    else if (notifications.undeliverableReason('EMAIL', address)) issues.push('Su correo usa un dominio que no existe.');
    if (pref.smsEnabled && !pref.phoneVerifiedAt) issues.push('SMS activado sin número verificado.');
    if (!pref.smsEnabled) issues.push('SMS desactivado o sin celular verificado.');
    return {
      username: u.username,
      email: address ? maskEmail(address) : null,
      emailEnabled: pref.emailEnabled,
      smsEnabled: Boolean(pref.smsEnabled && pref.phoneVerifiedAt),
      phone: pref.phoneLast4 ? `***${pref.phoneLast4}` : null,
      minSeverity: pref.minSeverity,
      issues,
    };
  });
  res.json({
    email: { ...email, host: env.smtp.host || null, port: env.smtp.port, from: env.smtp.from },
    sms,
    oncall: { emails: env.alerts.oncallEmails.length, phones: env.alerts.oncallPhones.length },
    deliverable: recipients.filter((r) => !r.skipReason).length,
    people,
    last24h: recent.map((r) => ({ channel: r.channel, status: r.status, count: r._count })),
  });
}

module.exports = { status };
