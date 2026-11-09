'use strict';
const { sendMail } = require('../../lib/mailer');

async function send(to, { subject, text, html }) {
  const out = await sendMail({ to, subject, text, html });
  return { providerMessageId: out.messageId, simulated: out.simulated };
}

module.exports = { name: 'EMAIL', send };
