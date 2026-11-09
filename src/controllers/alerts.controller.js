'use strict';
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const blockchain = require('../services/blockchain.service');
const alerts = require('../services/alert.service');
const notifications = require('../services/notifications/notification.service');
const { audit } = require('../services/audit.service');
const { alertBus } = require('../services/events');
const logger = require('../lib/logger');

const detailInclude = {
  acknowledgedBy: { select: { id: true, username: true } },
  resolvedBy: { select: { id: true, username: true } },
  notifications: { orderBy: { createdAt: 'asc' } },
};

function toAlertDTO(a) {
  return {
    id: a.id,
    machineId: a.machineId,
    machineCode: a.machineCode,
    severity: a.severity,
    status: a.status,
    failureProbability: a.failureProbability,
    anomalyScore: a.anomalyScore,
    diagnosis: a.diagnosis,
    diagnosisConfidence: a.diagnosisConfidence,
    recommendation: a.recommendation,
    variables: a.variables,
    contributingFactors: a.contributingFactors,
    modelVersion: a.modelVersion,
    recordedAt: a.recordedAt,
    createdAt: a.createdAt,
    occurrences: a.occurrences,
    lastSeenAt: a.lastSeenAt,
    acknowledgedAt: a.acknowledgedAt,
    acknowledgedBy: a.acknowledgedBy?.username ?? null,
    resolvedAt: a.resolvedAt,
    resolvedBy: a.resolvedBy?.username ?? null,
    resolutionNote: a.resolutionNote,
    escalatedAt: a.escalatedAt,
    isTest: a.isTest,
    injectionId: a.injectionId,
    recordHash: a.recordHash,
    chain: {
      status: a.chainStatus,
      network: a.chainNetwork,
      txHash: a.chainTxHash,
      blockNumber: a.chainBlockNumber,
      attempts: a.chainAttempts,
      error: a.chainError,
      anchoredAt: a.anchoredAt,
      explorerUrl: blockchain.explorerUrl(a.chainTxHash),
    },
    ...(a.notifications ? { notifications: a.notifications.map(notifications.publicNotification) } : {}),
  };
}

async function findAlertOr404(id, include = detailInclude) {
  const alert = await prisma.alert.findUnique({ where: { id }, include });
  if (!alert) throw new AppError(404, 'Alerta no encontrada.', 'NOT_FOUND');
  return alert;
}

async function list(req, res) {
  const { page, pageSize, status, severity, machineId, from, to, kind } = req.v.query;
  const where = {
    ...(kind === 'REAL' ? { isTest: false } : kind === 'TEST' ? { isTest: true } : {}),
    ...(status ? { status } : {}),
    ...(severity ? { severity } : {}),
    ...(machineId ? { machineId } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.alert.count({ where }),
    prisma.alert.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      include: { acknowledgedBy: { select: { username: true } }, resolvedBy: { select: { username: true } } },
    }),
  ]);
  res.json({ alerts: rows.map(toAlertDTO), total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

async function summary(req, res) {
  const [open, chain, last24h] = await Promise.all([
    prisma.alert.groupBy({ by: ['severity', 'status'], where: { isTest: false, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, _count: true }),
    prisma.alert.groupBy({ by: ['chainStatus'], _count: true }),
    prisma.alert.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000) } } }),
  ]);
  const count = (sev, st) => open.filter((o) => o.severity === sev && (!st || o.status === st)).reduce((a, o) => a + o._count, 0);
  const tests = await prisma.alert.count({ where: { isTest: true, status: { in: ['OPEN', 'ACKNOWLEDGED'] } } });
  res.json({
    openTests: tests,
    open: { critical: count('CRITICAL', 'OPEN'), warning: count('WARNING', 'OPEN') },
    acknowledged: { critical: count('CRITICAL', 'ACKNOWLEDGED'), warning: count('WARNING', 'ACKNOWLEDGED') },
    last24h,
    chain: Object.fromEntries(chain.map((c) => [c.chainStatus, c._count])),
  });
}

async function get(req, res) {
  res.json({ alert: toAlertDTO(await findAlertOr404(req.v.params.id)) });
}

async function acknowledge(req, res) {
  const { id } = req.v.params;
  const claim = await prisma.alert.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedById: req.user.id } });
  if (!claim.count) {
    const current = await findAlertOr404(id);
    throw new AppError(409, `La alerta ya está en estado ${current.status}.`, 'INVALID_STATE');
  }
  const alert = await findAlertOr404(id);
  await audit(req, 'ALERT_ACKNOWLEDGED', { entity: 'Alert', entityId: id, details: { machine: alert.machineCode, severity: alert.severity } });
  alertBus.emit('alert', { type: 'acknowledged', alert });
  res.json({ alert: toAlertDTO(alert) });
}

async function resolve(req, res) {
  const { id } = req.v.params;
  const claim = await prisma.alert.updateMany({
    where: { id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: req.user.id, resolutionNote: req.body.note || null },
  });
  if (!claim.count) throw new AppError(409, 'La alerta ya está resuelta o no existe.', 'INVALID_STATE');
  const alert = await findAlertOr404(id);
  if (!alert.acknowledgedAt) await prisma.alert.update({ where: { id }, data: { acknowledgedAt: alert.resolvedAt, acknowledgedById: req.user.id } });
  await audit(req, 'ALERT_RESOLVED', { entity: 'Alert', entityId: id, details: { machine: alert.machineCode, note: req.body.note || null } });
  alertBus.emit('alert', { type: 'resolved', alert });
  res.json({ alert: toAlertDTO(await findAlertOr404(id)) });
}

async function verify(req, res) {
  const alert = await findAlertOr404(req.v.params.id, {});
  const result = await alerts.verifyAlert(alert);
  if (result.verdict === 'TAMPERED') {
    logger.error(`Integridad comprometida en alerta ${alert.id}`, { result });
    await audit(req, 'ALERT_TAMPER_DETECTED', { entity: 'Alert', entityId: alert.id, details: { stage: 'verification', database: result.database, chainMatches: result.chain.matches } });
  } else {
    await audit(req, 'ALERT_VERIFIED', { entity: 'Alert', entityId: alert.id, details: { verdict: result.verdict } });
  }
  res.json({ verification: result, canonicalRecord: alerts.canonicalRecord(alert) });
}

async function retryAnchor(req, res) {
  const alert = await findAlertOr404(req.v.params.id, {});
  if (!blockchain.isEnabled()) throw new AppError(503, 'Blockchain deshabilitado.', 'CHAIN_DISABLED');
  if (alert.severity !== 'CRITICAL') throw new AppError(400, 'Solo las alertas CRÍTICAS se anclan en la cadena.', 'NOT_CRITICAL');
  if (alert.chainStatus === 'CONFIRMED') throw new AppError(409, 'La alerta ya está anclada.', 'ALREADY_ANCHORED');
  if (alert.chainStatus === 'DISABLED') await prisma.alert.update({ where: { id: alert.id }, data: { chainStatus: 'PENDING' } });
  if (['SUBMITTING', 'SUBMITTED'].includes(alert.chainStatus)) throw new AppError(409, 'Hay una transacción en curso; espera la conciliación.', 'IN_PROGRESS');
  await audit(req, 'ALERT_ANCHOR_RETRY', { entity: 'Alert', entityId: alert.id });
  await alerts.anchorAlert(alert.id, { force: true });
  res.json({ alert: toAlertDTO(await findAlertOr404(alert.id)) });
}

async function resend(req, res) {
  const alert = await findAlertOr404(req.v.params.id, {});
  const sent = await notifications.dispatchForAlert(alert.id);
  await audit(req, 'ALERT_NOTIFICATIONS_RESENT', { entity: 'Alert', entityId: alert.id, details: { count: sent.length } });
  res.json({ notifications: sent.map(notifications.publicNotification) });
}

/** SSE: alertas nuevas, cambios de estado, notificaciones enviadas y confirmaciones en la cadena. */
function stream(req, res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date() })}\n\n`);
  const onEvent = (evt) => {
    const payload = evt.alert ? { type: evt.type, alert: toAlertDTO(evt.alert) } : evt;
    res.write(`event: alert\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  alertBus.on('alert', onEvent);
  req.on('close', () => { clearInterval(heartbeat); alertBus.off('alert', onEvent); });
}

async function chainStatus(req, res) {
  try {
    res.json({ blockchain: await blockchain.status() });
  } catch (err) {
    throw new AppError(502, `No se pudo consultar la Testnet: ${blockchain.describeError(err)}`, 'CHAIN_UNREACHABLE');
  }
}

module.exports = { list, summary, get, acknowledge, resolve, verify, retryAnchor, resend, stream, chainStatus, toAlertDTO };
