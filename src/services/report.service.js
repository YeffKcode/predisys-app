'use strict';
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const prisma = require('../lib/prisma');
const env = require('../config/env');

const C = { ink: '#0f172a', muted: '#64748b', line: '#e2e8f0', zebra: '#f8fafc', head: '#0f766e', ok: '#059669', warn: '#d97706', hot: '#dc2626', none: '#94a3b8' };
const RISK_ES = { CRITICAL: 'Crítico', WARNING: 'Advertencia', HEALTHY: 'Sano', UNKNOWN: 'Sin datos' };
const STATUS_ES = { ONLINE: 'En línea', OFFLINE: 'Fuera de línea', MAINTENANCE: 'Mantenimiento' };
const FAULT_ES = { THERMAL_PASTE: 'Pasta térmica', FAN_WEAR: 'Ventilador', PSU_INSTABILITY: 'PSU', GPU_DEGRADATION: 'GPU/VRAM', DUST_OBSTRUCTION: 'Polvo' };

const riskOf = (p) => (p == null ? 'UNKNOWN' : p >= env.ml.alertThreshold ? 'CRITICAL' : p >= env.ml.warningThreshold ? 'WARNING' : 'HEALTHY');
const riskColor = (r) => ({ CRITICAL: C.hot, WARNING: C.warn, HEALTHY: C.ok }[r] || C.none);
const pct = (p) => (p == null ? '—' : `${Math.round(p * 100)} %`);
const n = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: d }));
const fmtDate = (d) => new Intl.DateTimeFormat('es-CO', { timeZone: env.alerts.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));

/** Instantánea de datos del informe. Su SHA-256 se imprime en el PDF y queda en auditoría. */
async function collectFleetData() {
  const [machines, openAlerts, injections] = await Promise.all([
    prisma.machine.findMany({ include: { telemetry: { orderBy: { recordedAt: 'desc' }, take: 1 }, _count: { select: { components: true } } }, orderBy: { code: 'asc' } }),
    prisma.alert.findMany({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }], take: 25 }),
    prisma.faultInjection.findMany({ where: { status: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  const rows = machines.map((m) => {
    const l = m.telemetry[0];
    return {
      code: m.code, name: m.name, location: m.location, status: m.status, components: m._count.components,
      probability: l?.failureProbability ?? null, risk: riskOf(l?.failureProbability), diagnosis: l?.diagnosis ?? null,
      temperature: l?.temperature ?? null, fanRpm: l?.fanRpm ?? null, powerKw: l?.powerKw ?? null, hashrate: l?.hashrate ?? null,
      synthetic: l?.isSynthetic ?? false, recordedAt: l?.recordedAt ?? null,
    };
  });
  const withData = rows.filter((r) => r.probability != null);
  const sum = (k) => withData.reduce((a, r) => a + (r[k] || 0), 0);
  const counts = { HEALTHY: 0, WARNING: 0, CRITICAL: 0, UNKNOWN: 0 };
  rows.forEach((r) => { counts[r.risk] += 1; });
  return {
    kpis: {
      machines: rows.length,
      online: rows.filter((r) => r.status === 'ONLINE').length,
      healthPct: withData.length ? Math.round((100 * counts.HEALTHY) / withData.length) : null,
      hashrate: sum('hashrate'),
      powerKw: sum('powerKw'),
      avgTemp: withData.length ? sum('temperature') / withData.length : null,
      avgProbability: withData.length ? sum('probability') / withData.length : null,
      counts,
    },
    machines: rows,
    alerts: openAlerts.map((a) => ({ machineCode: a.machineCode, severity: a.severity, status: a.status, probability: a.failureProbability, diagnosis: a.diagnosis, createdAt: a.createdAt, isTest: a.isTest, chainStatus: a.chainStatus })),
    injections: injections.map((i) => ({ machineCode: i.machineCode, faultType: i.faultType, intensity: i.intensity, maxProbability: i.maxProbability, firstCriticalStep: i.firstCriticalStep, steps: i.steps, diagnosisMatched: i.diagnosisMatched, createdAt: i.createdAt })),
    thresholds: { warning: env.ml.warningThreshold, critical: env.ml.alertThreshold },
  };
}

const dataHash = (data) => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');

function table(doc, { columns, rows, startY }) {
  const x0 = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalW = columns.reduce((a, c) => a + c.w, 0);
  const widths = columns.map((c) => (c.w / totalW) * width);
  let y = startY;
  const header = () => {
    doc.rect(x0, y, width, 18).fill(C.head);
    let x = x0;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    columns.forEach((c, i) => { doc.text(c.label, x + 4, y + 5, { width: widths[i] - 8, align: c.align || 'left', lineBreak: false }); x += widths[i]; });
    y += 18;
  };
  header();
  rows.forEach((row, r) => {
    if (y > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); y = doc.page.margins.top; header(); }
    if (r % 2 === 1) doc.rect(x0, y, width, 16).fill(C.zebra);
    let x = x0;
    columns.forEach((c, i) => {
      const cell = c.render(row);
      doc.font(cell.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(cell.color || C.ink)
        .text(String(cell.text ?? '—'), x + 4, y + 4, { width: widths[i] - 8, align: c.align || 'left', lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    y += 16;
  });
  doc.moveTo(x0, y).lineTo(x0 + width, y).strokeColor(C.line).lineWidth(0.5).stroke();
  return y + 14;
}

function sectionTitle(doc, text, y) {
  if (y > doc.page.height - 120) { doc.addPage(); y = doc.page.margins.top; }
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.ink).text(text, doc.page.margins.left, y);
  return y + 20;
}

/** Genera el PDF en memoria. Sin contraseña de apertura, pero con modificación deshabilitada. */
function buildFleetPdf({ data, user, documentId, hash }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape', margins: { top: 40, bottom: 46, left: 40, right: 40 }, bufferPages: true,
      pdfVersion: '1.7', ownerPassword: crypto.randomBytes(24).toString('hex'),
      permissions: { printing: 'highResolution', modifying: false, copying: true, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false },
      info: { Title: 'PrediSys · Informe de estado de flota', Author: `PrediSys (${user.username})`, Subject: `Documento ${documentId}`, Keywords: 'PrediSys, mantenimiento predictivo, flota', Creator: 'PrediSys API' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    // Encabezado
    doc.rect(0, 0, doc.page.width, 78).fill('#0b1220');
    doc.rect(L, 22, 6, 34).fill('#34d399');
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff').text('Informe de estado de flota', L + 16, 22);
    doc.font('Helvetica').fontSize(9).fillColor('#94a3b8').text(`PrediSys · generado el ${fmtDate(new Date())} por ${user.username} · documento ${documentId}`, L + 16, 46);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#fbbf24').text('CONFIDENCIAL · USO INTERNO', L, 30, { width: W, align: 'right' });

    // KPIs
    const k = data.kpis;
    const kpis = [
      ['Salud de flota', k.healthPct == null ? '—' : `${k.healthPct} %`, C.ok],
      ['Máquinas en línea', `${k.online} / ${k.machines}`, C.ink],
      ['Hashrate total', `${n(k.hashrate, 0)} MH/s`, '#2563eb'],
      ['Consumo total', `${n(k.powerKw, 2)} kW`, '#7c3aed'],
      ['Temperatura media', k.avgTemp == null ? '—' : `${n(k.avgTemp)} °C`, C.warn],
      ['Riesgo crítico', String(k.counts.CRITICAL), k.counts.CRITICAL ? C.hot : C.ok],
    ];
    const kw = W / kpis.length;
    kpis.forEach(([label, value, color], i) => {
      const x = L + i * kw;
      doc.roundedRect(x + 3, 96, kw - 6, 54, 4).lineWidth(0.6).strokeColor(C.line).stroke();
      doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(label, x + 12, 104, { width: kw - 24 });
      doc.font('Helvetica-Bold').fontSize(17).fillColor(color).text(value, x + 12, 120, { width: kw - 24 });
    });

    // Distribución por riesgo (barra apilada)
    let y = 168;
    const total = Math.max(1, k.machines);
    let bx = L;
    [['HEALTHY', C.ok], ['WARNING', C.warn], ['CRITICAL', C.hot], ['UNKNOWN', C.none]].forEach(([key, color]) => {
      const w = (k.counts[key] / total) * W;
      if (w > 0) { doc.rect(bx, y, w, 10).fill(color); bx += w; }
    });
    doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(
      `Sanas ${k.counts.HEALTHY} · Advertencia ${k.counts.WARNING} · Críticas ${k.counts.CRITICAL} · Sin datos ${k.counts.UNKNOWN}  (umbrales: advertencia ${pct(data.thresholds.warning)}, crítico ${pct(data.thresholds.critical)})`,
      L, y + 15,
    );
    y += 40;

    y = sectionTitle(doc, 'Estado de máquinas', y);
    y = table(doc, {
      startY: y,
      rows: data.machines,
      columns: [
        { label: 'Máquina', w: 9, render: (r) => ({ text: r.code, bold: true }) },
        { label: 'Ubicación', w: 14, render: (r) => ({ text: r.location || '—' }) },
        { label: 'Estado', w: 10, render: (r) => ({ text: STATUS_ES[r.status] }) },
        { label: 'Riesgo', w: 9, align: 'right', render: (r) => ({ text: pct(r.probability), bold: true, color: riskColor(r.risk) }) },
        { label: 'Nivel', w: 9, render: (r) => ({ text: RISK_ES[r.risk], color: riskColor(r.risk) }) },
        { label: 'Diagnóstico', w: 24, render: (r) => ({ text: `${r.diagnosis || '—'}${r.synthetic ? ' (prueba)' : ''}` }) },
        { label: '°C', w: 6, align: 'right', render: (r) => ({ text: n(r.temperature) }) },
        { label: 'RPM', w: 7, align: 'right', render: (r) => ({ text: n(r.fanRpm, 0) }) },
        { label: 'kW', w: 6, align: 'right', render: (r) => ({ text: n(r.powerKw, 2) }) },
        { label: 'MH/s', w: 8, align: 'right', render: (r) => ({ text: n(r.hashrate, 0) }) },
      ],
    });

    y = sectionTitle(doc, `Alertas abiertas (${data.alerts.length})`, y);
    if (!data.alerts.length) {
      doc.font('Helvetica').fontSize(9).fillColor(C.muted).text('No hay alertas abiertas.', L, y);
      y += 24;
    } else {
      y = table(doc, {
        startY: y,
        rows: data.alerts,
        columns: [
          { label: 'Fecha', w: 14, render: (r) => ({ text: fmtDate(r.createdAt) }) },
          { label: 'Máquina', w: 9, render: (r) => ({ text: r.machineCode, bold: true }) },
          { label: 'Severidad', w: 10, render: (r) => ({ text: r.severity === 'CRITICAL' ? 'Crítica' : 'Advertencia', color: r.severity === 'CRITICAL' ? C.hot : C.warn }) },
          { label: 'Prob.', w: 7, align: 'right', render: (r) => ({ text: pct(r.probability), bold: true }) },
          { label: 'Diagnóstico', w: 26, render: (r) => ({ text: r.diagnosis }) },
          { label: 'Estado', w: 10, render: (r) => ({ text: r.status === 'OPEN' ? 'Abierta' : 'Reconocida' }) },
          { label: 'Origen', w: 8, render: (r) => ({ text: r.isTest ? 'Prueba' : 'Real', color: r.isTest ? C.muted : C.ink }) },
          { label: 'Blockchain', w: 12, render: (r) => ({ text: { CONFIRMED: 'Registrada', NOT_REQUIRED: 'No aplica', DISABLED: 'Deshabilitado', FAILED: 'Fallida' }[r.chainStatus] || 'Pendiente' }) },
        ],
      });
    }

    if (data.injections.length) {
      y = sectionTitle(doc, 'Pruebas del modelo (fallas inyectadas)', y);
      y = table(doc, {
        startY: y,
        rows: data.injections,
        columns: [
          { label: 'Fecha', w: 14, render: (r) => ({ text: fmtDate(r.createdAt) }) },
          { label: 'Máquina', w: 9, render: (r) => ({ text: r.machineCode, bold: true }) },
          { label: 'Falla', w: 14, render: (r) => ({ text: FAULT_ES[r.faultType] }) },
          { label: 'Intensidad', w: 9, render: (r) => ({ text: { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' }[r.intensity] }) },
          { label: 'Prob. máx.', w: 9, align: 'right', render: (r) => ({ text: pct(r.maxProbability), bold: true }) },
          { label: 'Detección crítica', w: 14, render: (r) => ({ text: r.firstCriticalStep ? `paso ${r.firstCriticalStep} de ${r.steps}` : 'No alcanzó umbral', color: r.firstCriticalStep ? C.ok : C.warn }) },
          { label: 'Diagnóstico', w: 12, render: (r) => ({ text: r.diagnosisMatched ? 'Correcto' : 'Distinto', color: r.diagnosisMatched ? C.ok : C.warn }) },
        ],
      });
    }

    // Pie de página en todas las páginas
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - 30;
      doc.moveTo(L, fy - 6).lineTo(L + W, fy - 6).strokeColor(C.line).lineWidth(0.5).stroke();
      doc.font('Helvetica').fontSize(7).fillColor(C.muted)
        .text(`Huella SHA-256 de los datos: ${hash}`, L, fy, { width: W * 0.8, lineBreak: false })
        .text(`Página ${i + 1} de ${range.count}`, L, fy, { width: W, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

/** CSV con neutralización de inyección de fórmulas (=, +, -, @, tab, CR al inicio). */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function telemetryCsv({ hours, machineId, includeSynthetic }) {
  const rows = await prisma.telemetryLog.findMany({
    where: {
      recordedAt: { gte: new Date(Date.now() - hours * 3600000) },
      ...(machineId ? { machineId } : {}),
      ...(includeSynthetic ? {} : { isSynthetic: false }),
    },
    include: { machine: { select: { code: true } } },
    orderBy: [{ recordedAt: 'asc' }],
    take: 50000,
  });
  const header = ['recorded_at', 'machine', 'temperature_c', 'power_kw', 'fan_rpm', 'hashrate_mhs', 'failure_probability', 'anomaly_score', 'diagnosis', 'synthetic'];
  const lines = rows.map((r) => [r.recordedAt, r.machine.code, r.temperature, r.powerKw, r.fanRpm, r.hashrate, r.failureProbability, r.anomalyScore, r.diagnosis, r.isSynthetic].map(csvCell).join(','));
  return { csv: `\uFEFF${header.join(',')}\n${lines.join('\n')}\n`, rows: rows.length };
}

module.exports = { collectFleetData, dataHash, buildFleetPdf, telemetryCsv, csvCell };
