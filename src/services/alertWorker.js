'use strict';
const env = require('../config/env');
const logger = require('../lib/logger');
const alerts = require('./alert.service');
const notifications = require('./notifications/notification.service');

let timer = null;
let running = false;

/** Tareas periódicas: reintentos de anclaje y notificaciones, conciliación de transacciones y escalamiento. */
async function tick() {
  if (running) return;
  running = true;
  try {
    const [reconciled, anchored, retried, escalated] = [
      await alerts.reconcileSubmitted(),
      await alerts.retryAnchors(),
      await notifications.retryFailed(),
      await alerts.escalateStale(),
    ];
    if (reconciled + anchored + retried + escalated > 0) {
      logger.info(`Worker de alertas: conciliadas=${reconciled} reintentos_cadena=${anchored} reintentos_notif=${retried} escaladas=${escalated}`);
    }
  } catch (err) {
    logger.error(`Worker de alertas: ${err.message}`, { stack: err.stack });
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, env.alerts.workerIntervalSeconds * 1000);
  timer.unref();
  setTimeout(tick, 5000).unref();
  logger.info(`Worker de alertas iniciado (cada ${env.alerts.workerIntervalSeconds} s)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
