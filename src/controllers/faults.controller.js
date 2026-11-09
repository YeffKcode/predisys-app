'use strict';
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const faults = require('../services/fault.service');

async function inject(req, res) {
  const result = await faults.runInjection({ req, machineId: req.v.params.id, ...req.body });
  res.status(201).json({ injection: result });
}

async function list(req, res) {
  const { machineId, limit } = req.v.query;
  const rows = await prisma.faultInjection.findMany({
    where: machineId ? { machineId } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, machineId: true, machineCode: true, createdByUsername: true, faultType: true, intensity: true, steps: true, notify: true,
      status: true, maxProbability: true, firstWarningStep: true, firstCriticalStep: true, finalDiagnosisCode: true, diagnosisMatched: true,
      alertsCreated: true, error: true, createdAt: true,
    },
  });
  const done = rows.filter((r) => r.status === 'COMPLETED');
  const stats = {
    total: done.length,
    detectedPct: done.length ? Math.round((100 * done.filter((r) => r.firstCriticalStep != null).length) / done.length) : null,
    diagnosisPct: done.length ? Math.round((100 * done.filter((r) => r.diagnosisMatched).length) / done.length) : null,
  };
  res.json({ injections: rows, stats, faultTypes: faults.FAULTS });
}

async function get(req, res) {
  const row = await prisma.faultInjection.findUnique({ where: { id: req.v.params.id } });
  if (!row) throw new AppError(404, 'Inyección no encontrada.', 'NOT_FOUND');
  res.json({ injection: { ...row, expectedDiagnosis: faults.FAULTS[row.faultType] } });
}

async function clear(req, res) {
  const out = await faults.clearTestData({ req, machineId: req.v.params.id });
  res.json({ message: `Se eliminaron ${out.telemetry} lecturas sintéticas y ${out.alerts} alertas de prueba.`, ...out });
}

async function baseline(req, res) {
  const out = await faults.seedBaseline({ req, machineId: req.v.params.id, readings: req.body.readings });
  res.status(201).json({ message: `Se registraron ${out.readings} lecturas de línea base.`, ...out });
}

module.exports = { inject, list, get, clear, baseline };
