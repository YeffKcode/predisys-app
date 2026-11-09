'use strict';
const prisma = require('../lib/prisma');
const { auditBus } = require('../services/audit.service');

async function listAuditLogs(req, res) {
  const { page, pageSize, action, actorId, from, to } = req.v.query;
  const where = {
    ...(action ? { action } : {}),
    ...(actorId ? { actorId } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [total, logs, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
  ]);
  res.json({ logs, total, page, pageSize, totalPages: Math.ceil(total / pageSize), actions: actions.map((a) => a.action) });
}

/** Server-Sent Events: empuja cada nuevo AuditLog al panel en tiempo real. */
function streamAuditLogs(req, res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date() })}\n\n`);

  const onLog = (log) => res.write(`event: audit\ndata: ${JSON.stringify(log)}\n\n`);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  auditBus.on('log', onLog);
  req.on('close', () => {
    clearInterval(heartbeat);
    auditBus.off('log', onLog);
  });
}

module.exports = { listAuditLogs, streamAuditLogs };
