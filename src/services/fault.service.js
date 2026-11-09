'use strict';
const prisma = require('../lib/prisma');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { ingestReading } = require('./telemetry.service');
const { audit } = require('./audit.service');

const FAULTS = {
  THERMAL_PASTE: 'Degradación de pasta térmica',
  FAN_WEAR: 'Desgaste de ventilador',
  PSU_INSTABILITY: 'Inestabilidad de la fuente de poder (PSU)',
  GPU_DEGRADATION: 'Degradación de chip/VRAM de la GPU',
  DUST_OBSTRUCTION: 'Obstrucción del flujo de aire (polvo)',
};
const INTENSITY = { LOW: 0.45, MEDIUM: 0.75, HIGH: 1 };
const DEFAULT_BASE = { temperature: 68, powerKw: 1.38, fanRpm: 2050, hashrate: 585 };
const running = new Set(); // una inyección a la vez por máquina

function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Mismos patrones físicos con los que se entrenó el modelo (training/generate_dataset.py). */
function faultReading(base, type, p) {
  let t = base.temperature + gauss() * 1.0;
  let w = base.powerKw + gauss() * 0.015;
  let rpm = base.fanRpm + gauss() * 40;
  let h = base.hashrate + gauss() * 6;
  if (type === 'THERMAL_PASTE') { t += 14 * p; rpm += 900 * p; w += 0.05 * p; h -= 45 * p * p; }
  if (type === 'FAN_WEAR') { rpm += -800 * p + gauss() * (40 + 320 * p); t += 16 * p; h -= 35 * p * p; }
  if (type === 'PSU_INSTABILITY') { w += gauss() * (0.02 + 0.25 * p); h -= Math.random() < 0.05 + 0.25 * p ? base.hashrate * (0.2 + Math.random() * 0.3) : 60 * p * p; }
  if (type === 'GPU_DEGRADATION') { h -= 150 * p + gauss() * 25 * p; t += 3 * p; }
  if (type === 'DUST_OBSTRUCTION') { rpm += 1200 * p; t += 10 * p; w += 0.08 * p; }
  return {
    temperature: Number(Math.min(149, Math.max(-19, t)).toFixed(1)),
    powerKw: Number(Math.min(49, Math.max(0.05, w)).toFixed(3)),
    fanRpm: Math.round(Math.min(19999, Math.max(0, rpm))),
    hashrate: Number(Math.max(0, h).toFixed(1)),
  };
}

function healthyReading(base) {
  return faultReading(base, null, 0);
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Línea base sana de la máquina: mediana de sus últimas lecturas reales (o valores típicos si no tiene). */
async function machineBaseline(machineId) {
  const rows = await prisma.telemetryLog.findMany({
    where: { machineId, isSynthetic: false, OR: [{ failureProbability: null }, { failureProbability: { lt: env.ml.warningThreshold } }] },
    orderBy: { recordedAt: 'desc' },
    take: 30,
  });
  if (rows.length < 3) return { ...DEFAULT_BASE, source: 'default' };
  return {
    temperature: median(rows.map((r) => r.temperature)),
    powerKw: median(rows.map((r) => r.powerKw)),
    fanRpm: median(rows.map((r) => r.fanRpm)),
    hashrate: median(rows.map((r) => r.hashrate)),
    source: 'history',
  };
}

async function nextTimestamps(machineId, count, spacingMs) {
  const last = await prisma.telemetryLog.findFirst({ where: { machineId }, orderBy: { recordedAt: 'desc' }, select: { recordedAt: true } });
  let start = Date.now() - count * spacingMs;
  if (last && last.recordedAt.getTime() >= start) start = last.recordedAt.getTime() + 1;
  return Array.from({ length: count }, (_, i) => new Date(start + i * spacingMs));
}

/**
 * Inyecta una falla progresiva: genera `steps` lecturas sintéticas cada vez más degradadas, las pasa por el
 * mismo flujo de producción (ventana → Isolation Forest → Random Forest → alerta) y mide la respuesta del modelo.
 */
async function runInjection({ req, machineId, faultType, intensity, steps, notify }) {
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true, code: true } });
  if (!machine) throw new AppError(404, 'Máquina no encontrada.', 'NOT_FOUND');
  if (running.has(machineId)) throw new AppError(409, `Ya hay una inyección en curso en ${machine.code}.`, 'INJECTION_RUNNING');
  running.add(machineId);

  const injection = await prisma.faultInjection.create({
    data: { machineId, machineCode: machine.code, createdById: req.user.id, createdByUsername: req.user.username, faultType, intensity, steps, notify, status: 'RUNNING' },
  });
  try {
    const base = await machineBaseline(machineId);
    const times = await nextTimestamps(machineId, steps, 1000);
    const max = INTENSITY[intensity];
    const results = [];
    let alertsCreated = 0;

    for (let i = 0; i < steps; i++) {
      const progress = max * ((i + 1) / steps);
      const reading = faultReading(base, faultType, progress);
      const out = await ingestReading({ req, machine, reading, recordedAt: times[i], synthetic: true, injectionId: injection.id, notify, strictMl: true });
      if (out.alertResult?.created) alertsCreated += 1;
      results.push({
        step: i + 1,
        progress: Number(progress.toFixed(3)),
        reading,
        failureProbability: out.prediction.fields.failureProbability,
        riskLevel: out.prediction.riskLevel,
        diagnosis: out.prediction.fields.diagnosis,
        diagnosisCode: out.prediction.diagnosisCode,
        alertId: out.alertResult?.created ? out.alertResult.alert.id : null,
      });
    }

    const firstAt = (thr) => results.find((r) => r.failureProbability >= thr)?.step ?? null;
    const last = results[results.length - 1];
    const summary = {
      status: 'COMPLETED',
      results,
      maxProbability: Math.max(...results.map((r) => r.failureProbability)),
      firstWarningStep: firstAt(env.ml.warningThreshold),
      firstCriticalStep: firstAt(env.ml.alertThreshold),
      finalDiagnosisCode: last.diagnosisCode || null,
      diagnosisMatched: last.diagnosisCode === faultType,
      alertsCreated,
    };
    const done = await prisma.faultInjection.update({ where: { id: injection.id }, data: summary });
    await audit(req, 'FAULT_INJECTED', {
      entity: 'Machine', entityId: machineId,
      details: { injectionId: injection.id, machine: machine.code, faultType, intensity, steps, notify, baseline: base.source, maxProbability: summary.maxProbability, firstCriticalStep: summary.firstCriticalStep, diagnosisMatched: summary.diagnosisMatched },
    });
    return { ...done, baseline: base, expectedDiagnosis: FAULTS[faultType] };
  } catch (err) {
    await prisma.faultInjection.update({ where: { id: injection.id }, data: { status: 'FAILED', error: String(err.message).slice(0, 255) } });
    await audit(req, 'FAULT_INJECTION_FAILED', { entity: 'Machine', entityId: machineId, details: { injectionId: injection.id, error: err.message } });
    throw err;
  } finally {
    running.delete(machineId);
  }
}

/** Genera lecturas sanas para que una máquina recién agregada tenga historial y pueda analizarse. */
async function seedBaseline({ req, machineId, readings }) {
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true, code: true } });
  if (!machine) throw new AppError(404, 'Máquina no encontrada.', 'NOT_FOUND');
  const base = await machineBaseline(machineId);
  const times = await nextTimestamps(machineId, readings, 60000);
  let last = null;
  for (let i = 0; i < readings; i++) {
    last = await ingestReading({ req, machine, reading: healthyReading(base), recordedAt: times[i], strictMl: false });
  }
  await audit(req, 'BASELINE_GENERATED', { entity: 'Machine', entityId: machineId, details: { machine: machine.code, readings } });
  return { readings, lastProbability: last?.telemetry.failureProbability ?? null, mlAvailable: Boolean(last?.prediction) };
}

/** Elimina lecturas sintéticas y alertas de prueba de una máquina (el historial de inyecciones se conserva). */
async function clearTestData({ req, machineId }) {
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true, code: true } });
  if (!machine) throw new AppError(404, 'Máquina no encontrada.', 'NOT_FOUND');
  const [alertsDel, telemetryDel] = await prisma.$transaction([
    prisma.alert.deleteMany({ where: { machineId, isTest: true } }),
    prisma.telemetryLog.deleteMany({ where: { machineId, isSynthetic: true } }),
  ]);
  await audit(req, 'TEST_DATA_CLEARED', { entity: 'Machine', entityId: machineId, details: { machine: machine.code, telemetry: telemetryDel.count, alerts: alertsDel.count } });
  return { telemetry: telemetryDel.count, alerts: alertsDel.count };
}

module.exports = { FAULTS, INTENSITY, faultReading, machineBaseline, runInjection, seedBaseline, clearTestData };
