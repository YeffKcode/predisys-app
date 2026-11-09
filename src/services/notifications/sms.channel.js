'use strict';
const env = require('../../config/env');
const logger = require('../../lib/logger');

const E164 = /^\+[1-9]\d{7,14}$/;

async function sendTwilio(to, body) {
  const { twilioAccountSid: sid, twilioAuthToken: token, twilioFrom, twilioMessagingServiceSid } = env.sms;
  const form = new URLSearchParams({ To: to, Body: body });
  if (twilioMessagingServiceSid) form.set('MessagingServiceSid', twilioMessagingServiceSid);
  else form.set('From', twilioFrom);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${data.message || 'error desconocido'}`);
  return data.sid;
}

let snsClient;
async function sendSns(to, body) {
  // Carga diferida: el SDK solo se usa si SMS_PROVIDER=sns (credenciales desde IAM role / variables AWS_*)
  const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
  snsClient = snsClient || new SNSClient({ region: env.sms.awsRegion });
  const attributes = { 'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' } };
  if (env.sms.snsSenderId) attributes['AWS.SNS.SMS.SenderID'] = { DataType: 'String', StringValue: env.sms.snsSenderId };
  const out = await snsClient.send(new PublishCommand({ PhoneNumber: to, Message: body, MessageAttributes: attributes }));
  return out.MessageId;
}

async function send(to, body) {
  if (!E164.test(to)) throw new Error('Número no está en formato internacional E.164 (ej. +573001234567)');
  let id;
  if (env.sms.provider === 'twilio') id = await sendTwilio(to, body);
  else if (env.sms.provider === 'sns') id = await sendSns(to, body);
  else {
    console.log(`\n[DEV-SMS · NO ENVIADO] Para: ${to}\n${body}\n`);
    return { providerMessageId: null, simulated: true };
  }
  logger.info(`SMS enviado vía ${env.sms.provider} a ***${to.slice(-4)}`);
  return { providerMessageId: id, simulated: false };
}

/** Qué falta para que el proveedor de SMS funcione. */
function smsStatus() {
  const { provider } = env.sms;
  if (provider === 'console') return { ok: false, provider, error: 'SMS_PROVIDER=console: los SMS solo se imprimen en la consola de la API.' };
  if (provider === 'twilio') {
    const missing = ['twilioAccountSid', 'twilioAuthToken'].filter((k) => !env.sms[k]);
    if (!env.sms.twilioFrom && !env.sms.twilioMessagingServiceSid) missing.push('twilioFrom');
    return missing.length ? { ok: false, provider, error: `Faltan variables de Twilio: ${missing.join(', ')}.` } : { ok: true, provider };
  }
  return { ok: true, provider, note: 'Amazon SNS usa las credenciales IAM del entorno; en modo sandbox solo envía a números verificados en la consola de AWS.' };
}

module.exports = { name: 'SMS', send, E164, smsStatus };
