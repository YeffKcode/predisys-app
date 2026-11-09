'use strict';
const env = require('../../config/env');

const SEVERITY_ES = { CRITICAL: 'CRÍTICA', WARNING: 'ADVERTENCIA' };
const COLORS = { CRITICAL: '#ef4444', WARNING: '#f59e0b' };

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (p) => `${Math.round(Number(p) * 100)}%`;
// GSM-7: los SMS con tildes pasan a UCS-2 y se parten a 70 caracteres
const toGsm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E\n]/g, '');

function formatDate(d) {
  return new Intl.DateTimeFormat('es-CO', { timeZone: env.alerts.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(d));
}

const alertUrl = (alert) => `${env.appUrl}/alerts/${alert.id}`;

function emailForAlert(alert, { escalation = false } = {}) {
  const sev = SEVERITY_ES[alert.severity];
  const v = alert.variables || {};
  const factors = Array.isArray(alert.contributingFactors) ? alert.contributingFactors : [];
  const subject = `${alert.isTest ? '[PRUEBA] ' : ''}${escalation ? '[ESCALADA] ' : ''}[PrediSys][${sev}] ${alert.machineCode} · ${pct(alert.failureProbability)} de probabilidad de falla`;
  const chainNote = alert.chainStatus === 'NOT_REQUIRED' || alert.chainStatus === 'DISABLED'
    ? ''
    : `Esta alerta se registrará en la Testnet ${env.chain.name}. Hash del registro: ${alert.recordHash}`;

  const text = [
    alert.isTest ? 'PRUEBA: esta alerta proviene de una falla inyectada en el laboratorio de PrediSys. No requiere intervención física.\n' : '',
    escalation ? `ESCALAMIENTO: la alerta lleva más de ${env.alerts.escalationMinutes} minutos sin ser reconocida.\n` : '',
    `Alerta ${sev} en ${alert.machineCode}`,
    `Probabilidad de falla: ${pct(alert.failureProbability)}`,
    `Diagnóstico: ${alert.diagnosis || 'No disponible'}${alert.diagnosisConfidence != null ? ` (confianza ${pct(alert.diagnosisConfidence)})` : ''}`,
    alert.recommendation ? `Acción sugerida: ${alert.recommendation}` : '',
    `Lectura: ${formatDate(alert.recordedAt)}`,
    `Temperatura ${v.temperature} °C · Consumo ${v.powerKw} kW · Ventiladores ${v.fanRpm} RPM · Hashrate ${v.hashrate} MH/s`,
    factors.length ? `Variables que originaron la alerta: ${factors.map((f) => `${f.label} (${f.direction})`).join(', ')}` : '',
    chainNote,
    `Ver y reconocer: ${alertUrl(alert)}`,
  ].filter(Boolean).join('\n');

  const row = (k, val) => `<tr><td style="padding:6px 12px;color:#94a3b8">${k}</td><td style="padding:6px 12px;color:#f1f5f9;font-weight:600">${val}</td></tr>`;
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;background:#0b1120;padding:24px">
    <div style="max-width:560px;margin:auto;background:#111827;border:1px solid #1f2937;border-radius:10px;overflow:hidden">
      <div style="background:${COLORS[alert.severity]};padding:14px 20px;color:#0b1120;font-weight:700">
        ${alert.isTest ? 'PRUEBA · ' : ''}${escalation ? 'ESCALADA · ' : ''}ALERTA ${sev} · ${escapeHtml(alert.machineCode)}
      </div>
      <div style="padding:20px">
        <p style="font-size:42px;margin:0;color:${COLORS[alert.severity]};font-weight:800">${pct(alert.failureProbability)}</p>
        <p style="margin:0 0 16px;color:#94a3b8">probabilidad de falla estimada</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          ${row('Diagnóstico', escapeHtml(alert.diagnosis || 'No disponible'))}
          ${alert.recommendation ? row('Acción sugerida', escapeHtml(alert.recommendation)) : ''}
          ${row('Lectura', escapeHtml(formatDate(alert.recordedAt)))}
          ${row('Temperatura', `${escapeHtml(v.temperature)} °C`)}
          ${row('Consumo', `${escapeHtml(v.powerKw)} kW`)}
          ${row('Ventiladores', `${escapeHtml(v.fanRpm)} RPM`)}
          ${row('Hashrate', `${escapeHtml(v.hashrate)} MH/s`)}
          ${factors.length ? row('Variables que la originaron', factors.map((f) => escapeHtml(`${f.label} (${f.direction})`)).join('<br>')) : ''}
        </table>
        <p style="margin:20px 0"><a href="${escapeHtml(alertUrl(alert))}" style="background:#22d3ee;color:#0b1120;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:700">Ver y reconocer alerta</a></p>
        ${chainNote ? `<p style="font-size:11px;color:#64748b;word-break:break-all">${escapeHtml(chainNote)}</p>` : ''}
      </div>
    </div>
  </div>`;
  return { subject, text, html };
}

function smsForAlert(alert, { escalation = false } = {}) {
  const sev = alert.severity === 'CRITICAL' ? 'CRITICA' : 'ADVERTENCIA';
  const base = `${alert.isTest ? '[PRUEBA] ' : ''}${escalation ? '[ESCALADA] ' : ''}PrediSys ${sev} ${alert.machineCode}: falla ${pct(alert.failureProbability)}. ${alert.diagnosis || ''}. ${formatDate(alert.recordedAt)}`;
  const withLink = `${base} ${alertUrl(alert)}`;
  return toGsm(withLink.length <= 160 ? withLink : base).slice(0, 160);
}

module.exports = { emailForAlert, smsForAlert, toGsm, SEVERITY_ES };
