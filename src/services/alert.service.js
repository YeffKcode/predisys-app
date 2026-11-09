'use strict';
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const env = require('../config/env');
const logger = require('../lib/logger');
const blockchain = require('./blockchain.service');
const notifications = require('./notifications/notification.service');
const { audit } = require('./audit.service');
const { alertBus } = require('./events');

const r = (n, d) => (n == null ? null : Number(Number(n).toFixed(d)));

function severityFor(probability) {
  if (probability >= env.ml.alertThreshold) return 'CRITICAL';
  if (probability >= env.ml.warningThreshold) return 'WARNING';
  return null;
}

/** Registro canónico (v1): solo campos inmutables. Cambiar estado/reconocer NO altera el hash. */
function canonicalRecord(a) {
  const v = a.variables || {};
  return {
    v: 1,
    alertId: a.id,
    machineCode: a.machineCode,
    telemetryId: a.telemetryId ?? null,
    severity: a.severity,
    failureProbability: r(a.failureProbability, 4),
    anomalyScore: r(a.anomalyScore, 4),
    diagnosis: a.diagnosis ?? null,
    variables: { temperature: r(v.temperature, 3), powerKw: r(v.powerKw, 3), fanRpm: r(v.fanRpm, 0), hashrate: r(v.hashrate, 3) },
    recordedAt: new Date(a.recordedAt).toISOString(),
    createdAt: new Date(a.createdAt).toISOString(),
    // Solo se agrega si es prueba: así los hashes de alertas reales anteriores siguen siendo válidos
    ...(a.isTest ? { isTest: true } : {}),
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const computeRecordHash = (alert) => crypto.createHash('sha256').update(stableStringify(canonicalRecord(alert))).digest('hex');

function initialChainStatus(severity, isTest = false) {
  // Las alertas de prueba no se anclan: el registro inmutable es solo para eventos reales
  if (severity !== 'CRITICAL' || isTest) return 'NOT_REQUIRED';
  return blockchain.isEnabled() ? 'PENDING' : 'DISABLED';
}

function runInBackground(label, fn) {
  setImmediate(() => fn().catch((err) => logger.error(`${label}: ${err.message}`, { stack: err.stack })));
}

/**
 * Convierte una predicción en alerta. Dentro de la ventana de enfriamiento no duplica la alerta
 * de la misma máquina (solo incrementa ocurrencias), salvo que la severidad suba de WARNING a CRITICAL.
 */
async function processPrediction({ req, machine, telemetry, prediction, isTest = false, notify = true, injectionId = null }) {
  const severity = severityFor(prediction.fields.failureProbability);
  if (!severity) return null;

  const since = new Date(Date.now() - env.alerts.cooldownMinutes * 60000);
  const existing = await prisma.alert.findFirst({
    where: { machineId: machine.id, isTest, status: { in: ['OPEN', 'ACKNOWLEDGED'] }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing && !(existing.severity === 'WARNING' && severity === 'CRITICAL')) {
    const updated = await prisma.alert.update({ where: { id: existing.id }, data: { occurrences: { increment: 1 }, lastSeenAt: new Date() } });
    alertBus.emit('alert', { type: 'updated', alert: updated });
    return { alert: updated, created: false };
  }

  const data = {
    id: crypto.randomUUID(),
    machineId: machine.id,
    machineCode: machine.code,
    telemetryId: telemetry.id,
    severity,
    failureProbability: prediction.fields.failureProbability,
    anomalyScore: prediction.fields.anomalyScore,
    diagnosis: prediction.fields.diagnosis,
    diagnosisConfidence: prediction.fields.diagnosisConfidence,
    variables: { temperature: telemetry.temperature, powerKw: telemetry.powerKw, fanRpm: telemetry.fanRpm, hashrate: telemetry.hashrate },
    contributingFactors: prediction.contributingFactors || [],
    recommendation: prediction.recommendation ? String(prediction.recommendation).slice(0, 255) : null,
    modelVersion: prediction.modelVersion ? String(prediction.modelVersion).slice(0, 20) : null,
    recordedAt: telemetry.recordedAt,
    createdAt: new Date(),
    isTest,
    injectionId,
    chainStatus: initialChainStatus(severity, isTest),
  };
  data.recordHash = computeRecordHash(data);
  const alert = await prisma.alert.create({ data });

  await audit(req, isTest ? 'TEST_ALERT_CREATED' : 'ALERT_CREATED', {
    entity: 'Alert', entityId: alert.id,
    details: { machine: alert.machineCode, severity, failureProbability: alert.failureProbability, diagnosis: alert.diagnosis, recordHash: alert.recordHash, ...(isTest ? { injectionId } : {}) },
  });
  alertBus.emit('alert', { type: 'created', alert });

  if (!isTest || notify) runInBackground(`Notificaciones de alerta ${alert.id}`, () => notifications.dispatchForAlert(alert.id));
  if (alert.chainStatus === 'PENDING') runInBackground(`Anclaje de alerta ${alert.id}`, () => anchorAlert(alert.id));
  return { alert, created: true };
}

async function markConfirmed(alert, { txHash, blockNumber }) {
  const updated = await prisma.alert.update({
    where: { id: alert.id },
    data: { chainStatus: 'CONFIRMED', chainTxHash: txHash ?? alert.chainTxHash, chainBlockNumber: blockNumber ?? null, chainNetwork: env.chain.name, anchoredAt: new Date(), chainUpdatedAt: new Date(), chainError: null, chainNextAttemptAt: null },
  });
  await audit(null, 'ALERT_ANCHORED', { actorId: null, actorUsername: 'system', entity: 'Alert', entityId: alert.id, details: { network: env.chain.name, txHash: updated.chainTxHash, blockNumber } });
  alertBus.emit('alert', { type: 'anchored', alert: updated });
  logger.info(`Alerta ${alert.id} anclada en ${env.chain.name} (tx ${updated.chainTxHash})`);
  return updated;
}

async function markFailed(alert, message) {
  const final = alert.chainAttempts >= env.alerts.maxChainAttempts;
  const updated = await prisma.alert.update({
    where: { id: alert.id },
    data: {
      chainStatus: 'FAILED', chainError: String(message).slice(0, 255), chainUpdatedAt: new Date(),
      chainNextAttemptAt: final ? null : new Date(Date.now() + 2 ** alert.chainAttempts * 60000),
    },
  });
  (final ? logger.error : logger.warn).call(logger, `Anclaje de alerta ${alert.id} falló (intento ${alert.chainAttempts}${final ? ', definitivo' : ''}): ${message}`);
  alertBus.emit('alert', { type: 'chain_failed', alert: updated });
  return updated;
}

/** Ancla la alerta en la Testnet. Idempotente: el claim atómico impide dobles envíos. */
async function anchorAlert(alertId, { force = false } = {}) {
  if (!blockchain.isEnabled()) return null;
  const claim = await prisma.alert.updateMany({
    where: { id: alertId, chainStatus: { in: ['PENDING', 'FAILED'] }, ...(force ? {} : { chainAttempts: { lt: env.alerts.maxChainAttempts } }) },
    data: { chainStatus: 'SUBMITTING', chainUpdatedAt: new Date(), chainAttempts: { increment: 1 } },
  });
  if (!claim.count) return null;
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });

  if (computeRecordHash(alert) !== alert.recordHash) {
    await audit(null, 'ALERT_TAMPER_DETECTED', { actorId: null, actorUsername: 'system', entity: 'Alert', entityId: alert.id, details: { stage: 'pre-anchor' } });
    logger.error(`Alerta ${alert.id}: el registro fue modificado antes de anclarse; no se ancla.`);
    return prisma.alert.update({ where: { id: alert.id }, data: { chainStatus: 'FAILED', chainAttempts: env.alerts.maxChainAttempts, chainError: 'Hash inconsistente: registro modificado antes del anclaje', chainNextAttemptAt: null } });
  }

  try {
    // Idempotencia: si ya existe en la cadena (envío previo cuyo recibo se perdió), no se reenvía
    const existing = await blockchain.getRecord(alert.id);
    if (existing) {
      if (existing.recordHash === alert.recordHash) return markConfirmed(alert, {});
      return markFailed({ ...alert, chainAttempts: env.alerts.maxChainAttempts }, 'Ya existe un registro on-chain con un hash distinto');
    }
    const { txHash } = await blockchain.sendAnchor({
      alertId: alert.id, recordHash: alert.recordHash, machineCode: alert.machineCode,
      failureProbability: alert.failureProbability, alertTimestamp: alert.recordedAt,
    });
    await prisma.alert.update({ where: { id: alert.id }, data: { chainStatus: 'SUBMITTED', chainTxHash: txHash, chainNetwork: env.chain.name, chainUpdatedAt: new Date() } });
    const receipt = await blockchain.waitForReceipt(txHash);
    if (receipt) return markConfirmed(alert, { txHash, blockNumber: receipt.blockNumber });
    return null; // sigue SUBMITTED; el worker concilia
  } catch (err) {
    // Algunos RPC no devuelven los datos del revert: se confirma consultando el estado real de la cadena
    const record = await blockchain.getRecord(alert.id).catch(() => null);
    if (record && record.recordHash === alert.recordHash) return markConfirmed(alert, {});
    return markFailed(alert, blockchain.describeError(err));
  }
}

/** Concilia transacciones enviadas cuyo recibo no llegó (caída del proceso, timeout del RPC). */
async function reconcileSubmitted() {
  if (!blockchain.isEnabled()) return 0;
  const stale = await prisma.alert.findMany({
    where: { chainStatus: { in: ['SUBMITTED', 'SUBMITTING'] }, chainUpdatedAt: { lte: new Date(Date.now() - 2 * 60000) } },
    take: 25,
  });
  for (const alert of stale) {
    try {
      if (alert.chainTxHash) {
        const receipt = await blockchain.getReceiptIfMined(alert.chainTxHash);
        if (receipt?.status === 1) { await markConfirmed(alert, { txHash: alert.chainTxHash, blockNumber: receipt.blockNumber }); continue; }
        if (receipt?.status === 0) { await markFailed(alert, 'La transacción fue revertida'); continue; }
      }
      const record = await blockchain.getRecord(alert.id);
      if (record && record.recordHash === alert.recordHash) await markConfirmed(alert, { txHash: alert.chainTxHash });
      else if (Date.now() - alert.chainUpdatedAt.getTime() > env.chain.txTimeoutMs * 2) await markFailed(alert, 'Transacción no confirmada dentro del tiempo límite');
    } catch (err) {
      logger.warn(`Conciliación de alerta ${alert.id}: ${blockchain.describeError(err)}`);
    }
  }
  return stale.length;
}

async function retryAnchors() {
  if (!blockchain.isEnabled()) return 0;
  const due = await prisma.alert.findMany({
    where: {
      chainStatus: { in: ['PENDING', 'FAILED'] }, chainAttempts: { lt: env.alerts.maxChainAttempts },
      OR: [{ chainNextAttemptAt: null }, { chainNextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: 'asc' }, take: 10, select: { id: true },
  });
  for (const { id } of due) await anchorAlert(id); // secuencial: un solo firmante, nonces ordenados
  return due.length;
}

/** Alertas CRÍTICAS sin reconocer: se reenvían una vez a quienes pueden gestionarlas. */
async function escalateStale() {
  const limit = new Date(Date.now() - env.alerts.escalationMinutes * 60000);
  const stale = await prisma.alert.findMany({ where: { severity: 'CRITICAL', status: 'OPEN', isTest: false, escalatedAt: null, createdAt: { lte: limit } }, take: 20 });
  for (const alert of stale) {
    const claim = await prisma.alert.updateMany({ where: { id: alert.id, escalatedAt: null, status: 'OPEN' }, data: { escalatedAt: new Date() } });
    if (!claim.count) continue;
    await audit(null, 'ALERT_ESCALATED', { actorId: null, actorUsername: 'system', entity: 'Alert', entityId: alert.id, details: { machine: alert.machineCode, minutesOpen: env.alerts.escalationMinutes } });
    await notifications.dispatchForAlert(alert.id, { escalation: true });
    alertBus.emit('alert', { type: 'escalated', alert: { ...alert, escalatedAt: new Date() } });
  }
  return stale.length;
}

/** Verificación de integridad: hash recalculado (BD) vs. hash guardado vs. hash anclado en la cadena. */
async function verifyAlert(alert) {
  const recomputed = computeRecordHash(alert);
  const result = {
    alertId: alert.id,
    database: { storedHash: alert.recordHash, recomputedHash: recomputed, consistent: recomputed === alert.recordHash },
    chain: { status: alert.chainStatus, network: alert.chainNetwork, txHash: alert.chainTxHash, explorerUrl: blockchain.explorerUrl(alert.chainTxHash), onChain: null, matches: null },
    checkedAt: new Date(),
  };
  if (['NOT_REQUIRED', 'DISABLED'].includes(alert.chainStatus) && !alert.chainTxHash) {
    result.verdict = result.database.consistent ? 'NOT_ANCHORED' : 'TAMPERED';
    return result;
  }
  if (!blockchain.isEnabled()) {
    result.verdict = result.database.consistent ? 'CHAIN_UNAVAILABLE' : 'TAMPERED';
    return result;
  }
  const record = await blockchain.getRecord(alert.id);
  result.chain.onChain = record;
  if (!record) {
    result.verdict = result.database.consistent ? 'NOT_ANCHORED' : 'TAMPERED';
    return result;
  }
  result.chain.matches = record.recordHash === recomputed;
  result.verdict = result.database.consistent && result.chain.matches ? 'VERIFIED' : 'TAMPERED';
  return result;
}

module.exports = {
  severityFor, canonicalRecord, stableStringify, computeRecordHash,
  processPrediction, anchorAlert, reconcileSubmitted, retryAnchors, escalateStale, verifyAlert,
};
