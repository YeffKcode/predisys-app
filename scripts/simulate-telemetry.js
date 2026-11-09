'use strict';
/**
 * Simulador de telemetría para demostrar el flujo completo: lectura → ML → alerta → correo/SMS → Testnet.
 *
 *   npm run simulate                                   # flota sana
 *   npm run simulate -- --fault=Rig-07:FAN_WEAR        # inyecta desgaste de ventilador en Rig-07
 *   npm run simulate -- --fault=Rig-03:THERMAL_PASTE --interval=5 --ramp=20 --ticks=40
 *
 * Fallas: THERMAL_PASTE, FAN_WEAR, PSU_INSTABILITY, GPU_DEGRADATION, DUST_OBSTRUCTION
 */
require('dotenv').config();

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const API = (process.env.SIM_API_URL || 'http://localhost:4000/api').replace(/\/$/, '');
const INTERVAL = Number(args.interval || 10) * 1000;
const RAMP = Number(args.ramp || 15);
const TICKS = args.ticks ? Number(args.ticks) : Infinity;
const [faultMachine, faultKind] = (args.fault || '').split(':');
let cookie = '';

const noise = (sd) => (Math.random() * 2 - 1) * sd * 1.7;

function reading(base, kind, p) {
  let t = base.temp + noise(1);
  let w = base.power + noise(0.015);
  let rpm = base.rpm + noise(40);
  let h = base.hash + noise(6);
  if (kind === 'THERMAL_PASTE') { t += 14 * p; rpm += 900 * p; w += 0.05 * p; h -= 45 * p * p; }
  if (kind === 'FAN_WEAR') { rpm += -800 * p + noise(40 + 320 * p); t += 16 * p; h -= 35 * p * p; }
  if (kind === 'PSU_INSTABILITY') { w += noise(0.02 + 0.25 * p); h -= Math.random() < 0.05 + 0.25 * p ? base.hash * 0.35 : 60 * p * p; }
  if (kind === 'GPU_DEGRADATION') { h -= 150 * p + noise(25 * p); t += 3 * p; }
  if (kind === 'DUST_OBSTRUCTION') { rpm += 1200 * p; t += 10 * p; w += 0.08 * p; }
  return { temperature: +t.toFixed(1), powerKw: +Math.max(0.05, w).toFixed(3), fanRpm: Math.max(0, Math.round(rpm)), hashrate: +Math.max(0, h).toFixed(1) };
}

async function call(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(opts.headers || {}) } });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]; // JWT deslizante: siempre guardar el más reciente
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${body.error?.message || res.statusText}`);
  return body;
}

async function main() {
  await call('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: process.env.SIM_USERNAME, password: process.env.SIM_PASSWORD }) });
  const { machines } = await call('/machines');
  const active = machines.filter((m) => m.status === 'ONLINE');
  const bases = Object.fromEntries(active.map((m) => [m.id, {
    temp: m.latest?.temperature ?? 68, power: m.latest?.powerKw ?? 1.38, rpm: m.latest?.fanRpm ?? 2050, hash: m.latest?.hashrate ?? 585,
  }]));
  // Si la máquina con falla ya venía degradada en el seed, se parte de una base sana
  for (const m of active) if (m.code === faultMachine) bases[m.id] = { temp: 68, power: 1.38, rpm: 2050, hash: 585 };
  console.log(`Simulando ${active.length} máquinas cada ${INTERVAL / 1000}s${faultKind ? ` · falla ${faultKind} en ${faultMachine} (rampa ${RAMP} ciclos)` : ''}`);

  for (let tick = 1; tick <= TICKS; tick++) {
    const p = Math.min(1, tick / RAMP);
    const line = [];
    for (const m of active) {
      const kind = m.code === faultMachine ? faultKind : null;
      const r = await call('/telemetry', { method: 'POST', body: JSON.stringify({ machineId: m.id, ...reading(bases[m.id], kind, p) }) });
      const prob = r.telemetry.failureProbability;
      if (kind || (prob ?? 0) >= 0.4) line.push(`${m.code}=${prob == null ? 'ML?' : `${Math.round(prob * 100)}%`}${r.alert ? (r.alert.created ? ` 🚨${r.alert.severity}` : ' (alerta activa)') : ''}`);
      if (!r.mlAvailable && tick === 1) console.warn(`  ML no disponible: ${r.mlError}`);
    }
    console.log(`[${new Date().toLocaleTimeString()}] ciclo ${tick}${faultKind ? ` · progreso ${Math.round(p * 100)}%` : ''}  ${line.join('  ') || 'flota sana'}`);
    await new Promise((res) => setTimeout(res, INTERVAL));
  }
}

main().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
