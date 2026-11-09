'use strict';
const { getSettings, updateSettings } = require('../services/settings.service');
const { audit } = require('../services/audit.service');

async function get(req, res) {
  res.json({ settings: await getSettings() });
}

/** Ajuste en caliente de expiración del token y de la sesión por inactividad. */
async function update(req, res) {
  const before = await getSettings();
  const settings = await updateSettings(req.body, req.user.id);
  await audit(req, 'SETTINGS_UPDATED', { entity: 'SystemSetting', details: { before, after: settings } });
  res.json({ message: 'Configuración actualizada. Aplica desde la próxima petición de cada sesión.', settings });
}

module.exports = { get, update };
