'use strict';
const { EventEmitter } = require('events');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { getIp, getUserAgent } = require('../utils/request');

// Bus en memoria para difundir auditoría en tiempo real vía SSE
const auditBus = new EventEmitter();
auditBus.setMaxListeners(200);

/**
 * Registra una acción auditable. Nunca lanza: un fallo de auditoría se envía a error.log
 * pero no interrumpe la operación de negocio.
 */
async function audit(req, action, { entity, entityId, details, actorId, actorUsername } = {}) {
  try {
    const log = await prisma.auditLog.create({
      data: {
        actorId: actorId !== undefined ? actorId : req?.user?.id ?? null,
        actorUsername: actorUsername !== undefined ? actorUsername : req?.user?.username ?? null,
        action,
        entity: entity ?? null,
        entityId: entityId !== undefined && entityId !== null ? String(entityId) : null,
        ip: getIp(req),
        userAgent: getUserAgent(req),
        details: details ?? undefined,
      },
    });
    auditBus.emit('log', log);
    return log;
  } catch (err) {
    logger.error(`No se pudo registrar auditoría ${action}`, { error: err.message, stack: err.stack });
    return null;
  }
}

module.exports = { audit, auditBus };
