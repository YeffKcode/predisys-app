'use strict';
const crypto = require('crypto');
const reports = require('../services/report.service');
const { audit } = require('../services/audit.service');

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

function sendFile(res, { buffer, mime, filename, documentId }) {
  res.set({
    'Content-Type': mime,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Document-Id': documentId,
  });
  res.send(buffer);
}

async function fleetPdf(req, res) {
  const documentId = crypto.randomUUID();
  const data = await reports.collectFleetData();
  const hash = reports.dataHash(data);
  const buffer = await reports.buildFleetPdf({ data, user: req.user, documentId, hash });
  await audit(req, 'REPORT_EXPORTED', {
    entity: 'Report', entityId: documentId,
    details: { format: 'PDF', kind: 'fleet', dataSha256: hash, fileSha256: crypto.createHash('sha256').update(buffer).digest('hex'), machines: data.machines.length, alerts: data.alerts.length },
  });
  sendFile(res, { buffer, mime: 'application/pdf', filename: `predisys-informe-flota-${stamp()}.pdf`, documentId });
}

async function telemetryCsv(req, res) {
  const { hours, machineId, includeSynthetic } = req.v.query;
  const documentId = crypto.randomUUID();
  const { csv, rows } = await reports.telemetryCsv({ hours, machineId, includeSynthetic: includeSynthetic === 'true' });
  const buffer = Buffer.from(csv, 'utf8');
  await audit(req, 'REPORT_EXPORTED', {
    entity: 'Report', entityId: documentId,
    details: { format: 'CSV', kind: 'telemetry', hours, machineId: machineId || null, rows, fileSha256: crypto.createHash('sha256').update(buffer).digest('hex') },
  });
  sendFile(res, { buffer, mime: 'text/csv; charset=utf-8', filename: `predisys-telemetria-${hours}h-${stamp()}.csv`, documentId });
}

module.exports = { fleetPdf, telemetryCsv };
