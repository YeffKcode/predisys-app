'use strict';
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { ingestReading } = require('../services/telemetry.service');

async function ingest(req, res) {
  const { machineId, recordedAt, ...reading } = req.body;
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true, code: true } });
  if (!machine) throw new AppError(404, 'Máquina no encontrada.', 'NOT_FOUND');
  const { telemetry, prediction, mlError, alertResult } = await ingestReading({ req, machine, reading, recordedAt });
  res.status(201).json({
    telemetry,
    mlAvailable: Boolean(prediction),
    ...(mlError ? { mlError } : {}),
    ...(prediction ? { riskLevel: prediction.riskLevel, contributingFactors: prediction.contributingFactors, recommendation: prediction.recommendation } : {}),
    alert: alertResult ? { id: alertResult.alert.id, severity: alertResult.alert.severity, created: alertResult.created } : null,
  });
}

async function history(req, res) {
  const { machineId } = req.v.params;
  const { limit } = req.v.query;
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true, code: true } });
  if (!machine) throw new AppError(404, 'Máquina no encontrada.', 'NOT_FOUND');
  const rows = await prisma.telemetryLog.findMany({ where: { machineId }, orderBy: { recordedAt: 'desc' }, take: limit });
  res.json({ machine, telemetry: rows.reverse() });
}

module.exports = { ingest, history };
