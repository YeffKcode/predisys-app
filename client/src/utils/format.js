const dtf = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
const tf = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hm = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

export const fmtDate = (d) => (d ? dtf.format(new Date(d)) : '—');
export const fmtTime = (d) => (d ? tf.format(new Date(d)) : '—');
export const fmtHM = (d) => (d ? hm.format(new Date(d)) : '—');
export const pct = (p, digits = 0) => (p == null ? '—' : `${(Number(p) * 100).toFixed(digits)} %`);
export const num = (n, digits = 1) => (n == null ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
export const bytes = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

export function fmtRelative(d) {
  if (!d) return '—';
  const s = Math.round((new Date(d).getTime() - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

export function fmtCountdown(ms) {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m}:${s}`;
}

// Escala térmica: frío (sano) → ámbar (advertencia) → rojo (crítico)
const STOPS = [[0, [52, 211, 153]], [0.4, [251, 191, 36]], [0.7, [248, 113, 113]], [1, [244, 63, 94]]];
export function riskColor(p) {
  if (p == null) return 'var(--faint)';
  const v = Math.max(0, Math.min(1, Number(p)));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    const [p0, c0] = STOPS[i - 1];
    if (v <= p1) {
      const t = (v - p0) / (p1 - p0);
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t)).join(',')})`;
    }
  }
  return 'rgb(240,120,110)';
}

export const RISK = {
  CRITICAL: { label: 'Crítico', tone: 'hot' },
  WARNING: { label: 'Advertencia', tone: 'warm' },
  HEALTHY: { label: 'Sano', tone: 'cool' },
  UNKNOWN: { label: 'Sin datos', tone: 'muted' },
};
export const SEVERITY = { CRITICAL: { label: 'Crítica', tone: 'hot' }, WARNING: { label: 'Advertencia', tone: 'warm' } };
export const ALERT_STATUS = { OPEN: { label: 'Abierta', tone: 'hot' }, ACKNOWLEDGED: { label: 'Reconocida', tone: 'warm' }, RESOLVED: { label: 'Resuelta', tone: 'ok' } };
export const MACHINE_STATUS = { ONLINE: { label: 'En línea', color: 'var(--ok)' }, OFFLINE: { label: 'Fuera de línea', color: 'var(--faint)' }, MAINTENANCE: { label: 'Mantenimiento', color: 'var(--warm)' } };
export const COMPONENT_TYPE = { GPU: 'GPU', PSU: 'Fuente de poder', COOLING: 'Refrigeración', MOTHERBOARD: 'Placa base', OTHER: 'Otro' };
export const COMPONENT_STATUS = { ACTIVE: { label: 'Activo', tone: 'ok' }, DEGRADED: { label: 'Degradado', tone: 'warm' }, FAILED: { label: 'Con falla', tone: 'hot' }, REPLACED: { label: 'Reemplazado', tone: 'muted' } };
export const CHAIN_STATUS = {
  NOT_REQUIRED: { label: 'No aplica (advertencia)', tone: 'muted' },
  DISABLED: { label: 'Blockchain deshabilitado', tone: 'muted' },
  PENDING: { label: 'Pendiente de registro', tone: 'warm' },
  SUBMITTING: { label: 'Enviando', tone: 'warm' },
  SUBMITTED: { label: 'Esperando confirmación', tone: 'warm' },
  CONFIRMED: { label: 'Registrada en Testnet', tone: 'ok' },
  FAILED: { label: 'Registro fallido', tone: 'hot' },
};

export const riskVar = (r) => ({ CRITICAL: 'var(--red)', WARNING: 'var(--yellow)', HEALTHY: 'var(--green)' }[r] || 'var(--faint)');
export const riskOf = (p, crit = 0.7, warn = 0.4) => (p == null ? 'UNKNOWN' : p >= crit ? 'CRITICAL' : p >= warn ? 'WARNING' : 'HEALTHY');

/** Formatea hashrate con la unidad adecuada partiendo de MH/s. */
export function hashUnit(mhs) {
  if (mhs == null) return { value: '—', unit: '' };
  const units = [['PH/s', 1e9], ['TH/s', 1e6], ['GH/s', 1e3], ['MH/s', 1]];
  const [unit, f] = units.find(([, k]) => mhs >= k) || ['MH/s', 1];
  return { value: (mhs / f).toLocaleString('es-CO', { maximumFractionDigits: 2 }), unit };
}

export const FAULT_TYPES = {
  THERMAL_PASTE: { label: 'Pasta térmica seca', desc: 'Sube la temperatura y los ventiladores compensan girando más rápido.', color: 'var(--red)' },
  FAN_WEAR: { label: 'Desgaste de ventilador', desc: 'RPM erráticas y a la baja; la temperatura sube.', color: 'var(--cyan)' },
  PSU_INSTABILITY: { label: 'Fuente inestable (PSU)', desc: 'El consumo fluctúa y el hashrate sufre caídas bruscas.', color: 'var(--yellow)' },
  GPU_DEGRADATION: { label: 'Degradación GPU/VRAM', desc: 'Cae el hashrate con temperatura casi normal.', color: 'var(--purple)' },
  DUST_OBSTRUCTION: { label: 'Obstrucción por polvo', desc: 'Ventiladores al máximo, más calor y más consumo.', color: 'var(--pink)' },
};
export const INTENSITY = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' };
