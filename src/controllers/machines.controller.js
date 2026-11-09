'use strict';
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const env = require('../config/env');
const logger = require('../lib/logger');
const AppError = require('../utils/AppError');
const ml = require('../services/ml.service');
const { audit } = require('../services/audit.service');
const alerts = require('../services/alert.service');

const riskLevel = (p) => (p == null ? 'UNKNOWN' : p >= env.ml.alertThreshold ? 'CRITICAL' : p >= env.ml.warningThreshold ? 'WARNING' : 'HEALTHY');

function toMachineDTO(m) {
  const last = m.telemetry?.[0] || null;
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    location: m.location,
    status: m.status,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    components: m.components,
    componentCount: m.components?.length ?? m._count?.components ?? 0,
    trend: (m.telemetry || []).slice(0, 16).reverse().map((t) => ({ p: t.failureProbability, t: t.recordedAt, temp: t.temperature, hash: t.hashrate })),
    syntheticLatest: Boolean(m.telemetry?.[0]?.isSynthetic),
    latest: last && {
      recordedAt: last.recordedAt,
      temperature: last.temperature,
      powerKw: last.powerKw,
      fanRpm: last.fanRpm,
      hashrate: last.hashrate,
      anomalyScore: last.anomalyScore,
      failureProbability: last.failureProbability,
      isAnomaly: last.isAnomaly,
      diagnosis: last.diagnosis,
      diagnosisConfidence: last.diagnosisConfidence,
    },
    risk: riskLevel(last?.failureProbability),
  };
}

async function findMachineOr404(id, include = {}) {
  const machine = await prisma.machine.findUnique({ where: { id }, include });
  if (!machine) throw new AppError(404, 'Máquina no encontrada.', 'NOT_FOUND');
  return machine;
}

async function listMachines(req, res) {
  const machines = await prisma.machine.findMany({
    include: { components: { orderBy: [{ type: 'asc' }, { installedAt: 'asc' }] }, telemetry: { orderBy: { recordedAt: 'desc' }, take: 16 } },
    orderBy: { code: 'asc' },
  });
  res.json({ machines: machines.map(toMachineDTO), alertThreshold: env.ml.alertThreshold });
}

async function fleetKpis(req, res) {
  const machines = await prisma.machine.findMany({ include: { telemetry: { orderBy: { recordedAt: 'desc' }, take: 1 }, _count: { select: { components: true } } } });
  const withData = machines.map(toMachineDTO);
  const latest = withData.map((m) => m.latest).filter(Boolean);
  const sum = (k) => latest.reduce((acc, l) => acc + (l[k] || 0), 0);
  const probs = latest.map((l) => l.failureProbability).filter((p) => p != null);
  const openAlerts = await prisma.alert.groupBy({ by: ['severity'], where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, _count: true });
  const openBySeverity = Object.fromEntries(openAlerts.map((a) => [a.severity, a._count]));
  res.json({
    kpis: {
      openAlertsCritical: openBySeverity.CRITICAL || 0,
      openAlertsWarning: openBySeverity.WARNING || 0,
      totalMachines: machines.length,
      online: machines.filter((m) => m.status === 'ONLINE').length,
      offline: machines.filter((m) => m.status === 'OFFLINE').length,
      maintenance: machines.filter((m) => m.status === 'MAINTENANCE').length,
      totalComponents: machines.reduce((a, m) => a + m._count.components, 0),
      totalHashrate: Number(sum('hashrate').toFixed(2)),
      totalPowerKw: Number(sum('powerKw').toFixed(2)),
      avgTemperature: latest.length ? Number((sum('temperature') / latest.length).toFixed(1)) : null,
      avgFailureProbability: probs.length ? Number((probs.reduce((a, b) => a + b, 0) / probs.length).toFixed(3)) : null,
      critical: withData.filter((m) => m.risk === 'CRITICAL').length,
      warning: withData.filter((m) => m.risk === 'WARNING').length,
      healthy: withData.filter((m) => m.risk === 'HEALTHY').length,
      healthPct: withData.filter((m) => m.risk !== 'UNKNOWN').length
        ? Math.round((100 * withData.filter((m) => m.risk === 'HEALTHY').length) / withData.filter((m) => m.risk !== 'UNKNOWN').length) : null,
      efficiencyMhPerKw: sum('powerKw') > 0 ? Number((sum('hashrate') / sum('powerKw')).toFixed(1)) : null,
    },
    generatedAt: new Date(),
  });
}

async function getMachine(req, res) {
  const machine = await findMachineOr404(req.v.params.id, {
    components: { orderBy: [{ type: 'asc' }, { installedAt: 'asc' }] },
    telemetry: { orderBy: { recordedAt: 'desc' }, take: 100 },
    attachments: { orderBy: { createdAt: 'desc' }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } },
  });
  res.json({ machine: { ...toMachineDTO(machine), history: machine.telemetry.slice().reverse(), attachments: machine.attachments } });
}

async function createMachine(req, res) {
  if (await prisma.machine.findUnique({ where: { code: req.body.code } })) throw new AppError(409, `Ya existe la máquina ${req.body.code}.`, 'MACHINE_EXISTS');
  const machine = await prisma.machine.create({ data: req.body, include: { components: true } });
  await audit(req, 'MACHINE_CREATED', { entity: 'Machine', entityId: machine.id, details: req.body });
  res.status(201).json({ machine: toMachineDTO({ ...machine, telemetry: [] }) });
}

async function updateMachine(req, res) {
  const { id } = req.v.params;
  const before = await findMachineOr404(id);
  if (req.body.code && req.body.code !== before.code && (await prisma.machine.findUnique({ where: { code: req.body.code } }))) {
    throw new AppError(409, `Ya existe la máquina ${req.body.code}.`, 'MACHINE_EXISTS');
  }
  const machine = await prisma.machine.update({
    where: { id }, data: req.body,
    include: { components: true, telemetry: { orderBy: { recordedAt: 'desc' }, take: 1 } },
  });
  await audit(req, 'MACHINE_UPDATED', { entity: 'Machine', entityId: id, details: { before: { code: before.code, name: before.name, location: before.location, status: before.status }, after: req.body } });
  res.json({ machine: toMachineDTO(machine) });
}

async function deleteMachine(req, res) {
  const { id } = req.v.params;
  const machine = await findMachineOr404(id, { attachments: { select: { storedName: true } }, _count: { select: { components: true, telemetry: true } } });
  await prisma.machine.delete({ where: { id } });
  for (const a of machine.attachments) {
    fs.promises.unlink(path.join(env.uploadDir, a.storedName)).catch((err) => logger.warn(`No se pudo eliminar adjunto ${a.storedName}: ${err.message}`));
  }
  await audit(req, 'MACHINE_DELETED', { entity: 'Machine', entityId: id, details: { code: machine.code, components: machine._count.components, telemetryRows: machine._count.telemetry } });
  res.json({ message: `Máquina ${machine.code} eliminada junto con sus componentes y telemetría.` });
}

/** Recalcula la predicción con la ventana de telemetría más reciente. */
async function analyzeMachine(req, res) {
  const { id } = req.v.params;
  const machine = await findMachineOr404(id);
  const recent = await prisma.telemetryLog.findMany({ where: { machineId: id }, orderBy: { recordedAt: 'desc' }, take: env.ml.windowSize });
  if (!recent.length) throw new AppError(400, 'La máquina no tiene telemetría para analizar.', 'NO_TELEMETRY');
  const prediction = await ml.predict(machine.code, recent.slice().reverse());
  const updated = await prisma.telemetryLog.update({ where: { id: recent[0].id }, data: prediction.fields });
  const alertResult = await alerts.processPrediction({ req, machine, telemetry: updated, prediction });
  await audit(req, 'MACHINE_ANALYZED', { entity: 'Machine', entityId: id, details: { code: machine.code, failureProbability: prediction.fields.failureProbability } });
  res.json({
    prediction: { ...prediction.fields, riskLevel: prediction.riskLevel, recommendation: prediction.recommendation, contributingFactors: prediction.contributingFactors, modelVersion: prediction.modelVersion },
    telemetry: updated,
    risk: riskLevel(prediction.fields.failureProbability),
    alert: alertResult ? { id: alertResult.alert.id, severity: alertResult.alert.severity, created: alertResult.created } : null,
  });
}

module.exports = { listMachines, fleetKpis, getMachine, createMachine, updateMachine, deleteMachine, analyzeMachine, toMachineDTO, riskLevel };
