'use strict';
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { encrypt, decrypt, randomNumericCode } = require('../lib/crypto');
const notifications = require('../services/notifications/notification.service');
const { toGsm } = require('../services/notifications/templates');
const { audit } = require('../services/audit.service');

const CODE_TTL_MIN = 10;
const MAX_TRIES = 5;

async function getPref(userId) {
  return prisma.notificationPreference.upsert({ where: { userId }, update: {}, create: { userId } });
}

const toDTO = (p) => ({
  emailEnabled: p.emailEnabled,
  smsEnabled: p.smsEnabled,
  minSeverity: p.minSeverity,
  quietHoursStart: p.quietHoursStart,
  quietHoursEnd: p.quietHoursEnd,
  phone: p.phoneLast4 ? `***${p.phoneLast4}` : null,
  phoneVerified: Boolean(p.phoneVerifiedAt),
  phoneVerificationPending: Boolean(p.pendingPhoneEnc && p.phoneCodeExpiry && p.phoneCodeExpiry > new Date()),
});

async function get(req, res) {
  res.json({ preferences: toDTO(await getPref(req.user.id)) });
}

async function update(req, res) {
  const pref = await getPref(req.user.id);
  if (req.body.smsEnabled === true && !pref.phoneVerifiedAt) {
    throw new AppError(400, 'Verifica un número de celular antes de activar los SMS.', 'PHONE_NOT_VERIFIED');
  }
  const updated = await prisma.notificationPreference.update({ where: { userId: req.user.id }, data: req.body });
  await audit(req, 'NOTIFICATION_PREFS_UPDATED', { entity: 'User', entityId: req.user.id, details: req.body });
  res.json({ preferences: toDTO(updated) });
}

/** Paso 1: registra el número pendiente y envía un código por SMS (evita alertas a números ajenos). */
async function requestPhoneCode(req, res) {
  const { phone } = req.body;
  const code = randomNumericCode(6);
  let simulated = false;
  await getPref(req.user.id);
  await prisma.notificationPreference.update({
    where: { userId: req.user.id },
    data: { pendingPhoneEnc: encrypt(phone), phoneCodeHash: await bcrypt.hash(code, 10), phoneCodeExpiry: new Date(Date.now() + CODE_TTL_MIN * 60000), phoneCodeTries: 0 },
  });
  try {
    const sent = await notifications.sendDirect('SMS', phone, toGsm(`PrediSys: tu codigo de verificacion es ${code}. Vence en ${CODE_TTL_MIN} min.`));
    simulated = sent.simulated;
  } catch (err) {
    if (err.name === 'AppError') throw err;
    throw new AppError(502, `No se pudo enviar el SMS: ${err.message}`, 'SMS_FAILED');
  }
  await audit(req, 'PHONE_VERIFICATION_REQUESTED', { entity: 'User', entityId: req.user.id, details: { phone: `***${phone.slice(-4)}` } });
  if (simulated) {
    return res.json({ simulated: true, message: 'Modo desarrollo: NO se envió ningún SMS (SMS_PROVIDER=console). El código está en la consola de la API. Para SMS reales configura Twilio o Amazon SNS.' });
  }
  res.json({ message: `Enviamos un código al número terminado en ${phone.slice(-4)}.` });
}

/** Paso 2: valida el código y activa el número. */
async function verifyPhone(req, res) {
  const pref = await getPref(req.user.id);
  const invalid = new AppError(400, 'Código inválido o vencido.', 'INVALID_CODE');
  if (!pref.pendingPhoneEnc || !pref.phoneCodeHash || !pref.phoneCodeExpiry || pref.phoneCodeExpiry < new Date()) throw invalid;
  if (pref.phoneCodeTries >= MAX_TRIES) {
    await prisma.notificationPreference.update({ where: { userId: req.user.id }, data: { pendingPhoneEnc: null, phoneCodeHash: null, phoneCodeExpiry: null } });
    throw invalid;
  }
  if (!(await bcrypt.compare(req.body.code, pref.phoneCodeHash))) {
    await prisma.notificationPreference.update({ where: { userId: req.user.id }, data: { phoneCodeTries: { increment: 1 } } });
    throw invalid;
  }
  const phone = decrypt(pref.pendingPhoneEnc);
  const updated = await prisma.notificationPreference.update({
    where: { userId: req.user.id },
    data: { phoneEnc: encrypt(phone), phoneLast4: phone.slice(-4), phoneVerifiedAt: new Date(), smsEnabled: true, pendingPhoneEnc: null, phoneCodeHash: null, phoneCodeExpiry: null, phoneCodeTries: 0 },
  });
  await audit(req, 'PHONE_VERIFIED', { entity: 'User', entityId: req.user.id, details: { phone: `***${phone.slice(-4)}` } });
  res.json({ message: 'Número verificado. Los SMS de alerta quedaron activos.', preferences: toDTO(updated) });
}

async function removePhone(req, res) {
  await getPref(req.user.id);
  const updated = await prisma.notificationPreference.update({
    where: { userId: req.user.id },
    data: { phoneEnc: null, phoneLast4: null, phoneVerifiedAt: null, smsEnabled: false, pendingPhoneEnc: null, phoneCodeHash: null, phoneCodeExpiry: null },
  });
  await audit(req, 'PHONE_REMOVED', { entity: 'User', entityId: req.user.id });
  res.json({ preferences: toDTO(updated) });
}

/** Envía un mensaje de prueba al canal propio para confirmar que la entrega funciona. */
async function test(req, res) {
  const { channel } = req.body;
  const pref = await getPref(req.user.id);
  let target;
  let out;
  try {
    if (channel === 'EMAIL') {
      target = decrypt(req.user.raw.emailEnc);
      const reason = notifications.undeliverableReason('EMAIL', target);
      if (reason) throw new AppError(400, reason, 'UNDELIVERABLE_EMAIL');
      out = await notifications.sendDirect('EMAIL', target, {
        subject: 'PrediSys · Prueba de notificaciones',
        text: 'Este es un mensaje de prueba. Si lo recibes, las alertas por correo funcionan.',
        html: '<p style="font-family:Arial">Este es un mensaje de prueba de <b>PrediSys</b>. Si lo recibes, las alertas por correo funcionan.</p>',
      });
    } else {
      if (!pref.phoneVerifiedAt) throw new AppError(400, 'No tienes un número verificado.', 'PHONE_NOT_VERIFIED');
      target = decrypt(pref.phoneEnc);
      out = await notifications.sendDirect('SMS', target, 'PrediSys: mensaje de prueba. Las alertas por SMS funcionan.');
    }
  } catch (err) {
    if (err.name === 'AppError') throw err;
    throw new AppError(502, `El proveedor rechazó el envío: ${err.message}`, 'DELIVERY_FAILED');
  }
  if (out?.simulated) {
    throw new AppError(409, channel === 'EMAIL'
      ? 'No se envió: el servidor no tiene SMTP configurado (SMTP_HOST vacío). El mensaje solo apareció en la consola de la API.'
      : 'No se envió: SMS_PROVIDER=console. El mensaje solo apareció en la consola de la API.', 'CHANNEL_NOT_CONFIGURED');
  }
  await audit(req, 'NOTIFICATION_TEST_SENT', { entity: 'User', entityId: req.user.id, details: { channel } });
  res.json({ message: `Mensaje de prueba enviado por ${channel === 'EMAIL' ? 'correo' : 'SMS'}. Revisa tu ${channel === 'EMAIL' ? 'bandeja (y la carpeta de spam)' : 'celular'}.` });
}

module.exports = { get, update, requestPhoneCode, verifyPhone, removePhone, test };
