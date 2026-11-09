'use strict';
const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../lib/logger');
const AppError = require('../utils/AppError');

const authHeaders = () => (env.ml.token ? { 'X-Internal-Token': env.ml.token } : {});
const tokenFingerprint = () => (env.ml.token ? crypto.createHash('sha256').update(env.ml.token).digest('hex').slice(0, 8) : null);

/** Traduce la respuesta del servicio ML a un motivo accionable. */
async function failureReason(res) {
  if (res.status === 401) {
    return `el token interno no coincide (huella API ${tokenFingerprint() || 'vacía'}). Usa el mismo ML_SERVICE_TOKEN en el .env de la raíz y reinicia la API y el servicio ML`;
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 503) return `el servicio ML no tiene modelos cargados (${body.detail || 'ejecuta python -m training.train'})`;
  if (res.status === 422) return 'el servicio ML rechazó el formato de las lecturas';
  return `el servicio ML respondió ${res.status}`;
}

/**
 * Cliente del microservicio de inferencia (FastAPI + modelos .pkl):
 *   Isolation Forest -> anomaly_score, failure_probability, is_anomaly
 *   Random Forest    -> diagnosis, diagnosis_confidence
 */
async function predict(machineCode, readings) {
  let res;
  try {
    res = await fetch(`${env.ml.url}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        machine_id: machineCode,
        readings: readings.map((r) => ({ temperature: r.temperature, power_kw: r.powerKw, fan_rpm: r.fanRpm, hashrate: r.hashrate })),
      }),
      signal: AbortSignal.timeout(env.ml.timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' || err.name === 'AbortError'
      ? 'tiempo de espera agotado'
      : `no se pudo conectar con ${env.ml.url}; verifica que uvicorn esté en ejecución`;
    logger.warn(`Servicio ML no disponible: ${reason}`);
    throw new AppError(503, `El servicio de inferencia no está disponible: ${reason}.`, 'ML_UNAVAILABLE');
  }
  if (!res.ok) {
    const reason = await failureReason(res);
    logger.warn(`Servicio ML: ${reason}`);
    throw new AppError(503, `El servicio de inferencia no está disponible: ${reason}.`, res.status === 401 ? 'ML_AUTH_FAILED' : 'ML_UNAVAILABLE');
  }
  const data = await res.json();
  return {
    fields: {
      anomalyScore: Number(data.anomaly_score),
      failureProbability: Math.min(1, Math.max(0, Number(data.failure_probability))),
      isAnomaly: Boolean(data.is_anomaly),
      diagnosis: data.diagnosis ? String(data.diagnosis).slice(0, 120) : null,
      diagnosisConfidence: data.diagnosis_confidence != null ? Number(data.diagnosis_confidence) : null,
    },
    riskLevel: data.risk_level,
    diagnosisCode: data.diagnosis_code,
    recommendation: data.recommendation || null,
    contributingFactors: Array.isArray(data.contributing_factors) ? data.contributing_factors.slice(0, 5) : [],
    modelVersion: data.model_version || null,
  };
}

async function health() {
  try {
    const res = await fetch(`${env.ml.url}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { status: 'down' };
    const data = await res.json();
    // Verifica también que el token sea aceptado
    const auth = await fetch(`${env.ml.url}/model/info`, { headers: authHeaders(), signal: AbortSignal.timeout(2000) }).catch(() => null);
    return { ...data, auth: auth?.status === 401 ? 'token_mismatch' : auth?.ok ? 'ok' : 'unknown' };
  } catch {
    return { status: 'down' };
  }
}

async function modelInfo() {
  let res;
  try {
    res = await fetch(`${env.ml.url}/model/info`, { headers: authHeaders(), signal: AbortSignal.timeout(4000) });
  } catch {
    throw new AppError(503, `No se pudo conectar con el servicio ML en ${env.ml.url}.`, 'ML_UNAVAILABLE');
  }
  if (!res.ok) throw new AppError(503, `El servicio de inferencia no está disponible: ${await failureReason(res)}.`, 'ML_UNAVAILABLE');
  return res.json();
}

/** Diagnóstico al arrancar la API: deja en el log si el token coincide. */
async function verifyAtStartup() {
  const h = await health();
  if (h.status === 'down') logger.warn(`Servicio ML no alcanzable en ${env.ml.url}. Las predicciones fallarán hasta que se inicie.`);
  else if (h.auth === 'token_mismatch') logger.error(`ML_SERVICE_TOKEN no coincide con el del servicio ML (huella API ${tokenFingerprint()}). Revisa el .env de la raíz y reinicia ambos servicios.`);
  else logger.info(`Servicio ML conectado (modelo ${h.model_version}, token huella ${tokenFingerprint() || 'vacía'})`);
}

module.exports = { predict, health, modelInfo, verifyAtStartup, tokenFingerprint };
