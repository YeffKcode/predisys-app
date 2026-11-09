'use strict';
/**
 * Prueba los canales de aviso directamente desde la terminal del servidor, sin pasar por la app.
 *   npm run notify:check                                  # solo revisa la configuración
 *   npm run notify:check -- --to=tu@correo.com            # además envía un correo de prueba
 *   npm run notify:check -- --sms=+573001234567           # además envía un SMS de prueba
 */
require('dotenv').config();
const env = require('../src/config/env');
const { verifySmtp, sendMail, explainSmtpError } = require('../src/lib/mailer');
const sms = require('../src/services/notifications/sms.channel');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => console.log(`  ✘ ${m}`);
const info = (m) => console.log(`  · ${m}`);

(async () => {
  console.log('\nCorreo');
  const e = await verifySmtp();
  if (e.ok) ok(`Conectado a ${env.smtp.host}:${env.smtp.port} como ${env.smtp.user || '(sin usuario)'}. Remitente: ${env.smtp.from}`);
  else bad(e.error);
  if (/@[^>]*\.(local|localhost|test|invalid)>?\s*$/i.test(env.smtp.from)) bad(`MAIL_FROM (${env.smtp.from}) usa un dominio inexistente: los correos caerán en spam o serán rechazados. Usa la misma cuenta de SMTP_USER.`);
  if (args.to && e.ok) {
    try {
      const r = await sendMail({ to: args.to, subject: 'PrediSys · prueba de correo', text: 'Si lees esto, las alertas por correo de PrediSys funcionan.', html: '<p>Si lees esto, las alertas por correo de <b>PrediSys</b> funcionan.</p>' });
      ok(`Correo de prueba aceptado por el servidor (id ${r.messageId}). Revisa también la carpeta de spam.`);
    } catch (err) { bad(`El envío falló: ${explainSmtpError(err)}`); }
  } else if (!args.to) info('Agrega --to=tu@correo.com para enviar un correo de prueba.');

  console.log('\nSMS');
  const s = sms.smsStatus();
  s.ok ? ok(`Proveedor: ${s.provider}.${s.note ? ` ${s.note}` : ''}`) : bad(s.error);
  if (args.sms && s.ok) {
    try {
      const r = await sms.send(String(args.sms), 'PrediSys: SMS de prueba. Las alertas por SMS funcionan.');
      ok(`SMS aceptado por ${s.provider} (id ${r.providerMessageId}).`);
    } catch (err) { bad(`El envío falló: ${err.message}`); }
  } else if (!args.sms) info('Agrega --sms=+57XXXXXXXXXX para enviar un SMS de prueba.');

  console.log('\nLista de guardia');
  info(`${env.alerts.oncallEmails.length} correo(s) y ${env.alerts.oncallPhones.length} teléfono(s) reciben toda alerta crítica.`);
  console.log('');
  process.exit(0);
})().catch((err) => { console.error(`✘ ${err.message}`); process.exit(1); });
