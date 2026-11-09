'use strict';
const prisma = require('../lib/prisma');
const env = require('../config/env');
const ml = require('./ml.service');
const alerts = require('./alert.service');

/**
 * Ingesta única para lecturas reales y sintéticas: ventana → predicción ML → TelemetryLog → alerta.
 * strictMl: si el servicio ML falla, lanza el error en vez de guardar la lectura sin predicción.
 */
async function ingestReading({ req, machine, reading, recordedAt, synthetic = false, injectionId = null, notify = true, strictMl = false }) {
  const recent = await prisma.telemetryLog.findMany({
    where: { machineId: machine.id },
    orderBy: { recordedAt: 'desc' },
    take: env.ml.windowSize - 1,
  });
  const window = [...recent.reverse(), reading];

  let prediction = null;
  let mlError = null;
  try {
    prediction = await ml.predict(machine.code, window);
  } catch (err) {
    if (strictMl) throw err;
    mlError = err.message;
  }

  const telemetry = await prisma.telemetryLog.create({
    data: {
      machineId: machine.id,
      recordedAt: recordedAt ?? new Date(),
      ...reading,
      ...(prediction ? prediction.fields : {}),
      isSynthetic: synthetic,
      injectionId,
    },
  });
  const alertResult = prediction
    ? await alerts.processPrediction({ req, machine, telemetry, prediction, isTest: synthetic, notify, injectionId })
    : null;
  return { telemetry, prediction, mlError, alertResult };
}

module.exports = { ingestReading };
