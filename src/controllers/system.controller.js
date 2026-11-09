'use strict';
const fs = require('fs');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const ml = require('../services/ml.service');
const { audit } = require('../services/audit.service');

async function health(req, res) {
  let database = 'up';
  try { await prisma.$queryRaw`SELECT 1`; } catch { database = 'down'; }
  res.json({ status: database === 'up' ? 'ok' : 'degraded', database, ml: await ml.health(), time: new Date() });
}

/** Provoca un fallo controlado para verificar que el manejador global lo capture en error.log. */
async function forceError(req, res) {
  const { type } = req.v.query;
  await audit(req, 'FORCED_ERROR_TRIGGERED', { details: { type, requestId: req.id } });
  if (type === 'sync') throw new Error(`[FALLO FORZADO] Error síncrono de prueba (requestId=${req.id})`);
  if (type === 'async') {
    await new Promise((_, reject) => setTimeout(() => reject(new Error(`[FALLO FORZADO] Rechazo asíncrono de prueba (requestId=${req.id})`)), 10));
  }
  // database: consulta sobre tabla inexistente
  await prisma.$queryRawUnsafe('SELECT * FROM tabla_inexistente_predisys');
  res.json({ unreachable: true });
}

/** Devuelve las últimas N entradas de error.log (JSON por línea). */
async function readErrorLog(req, res) {
  const { lines } = req.v.query;
  if (!fs.existsSync(logger.errorLogPath)) return res.json({ entries: [] });
  const content = await fs.promises.readFile(logger.errorLogPath, 'utf8');
  const entries = content.trim().split('\n').filter(Boolean).slice(-lines).reverse().map((line) => {
    try { return JSON.parse(line); } catch { return { message: line }; }
  });
  res.json({ entries, file: 'logs/error.log' });
}

module.exports = { health, forceError, readErrorLog };
