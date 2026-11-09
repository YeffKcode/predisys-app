import { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFleet } from '../../auth/FleetContext';
import { usePalette, tooltipStyle } from '../../theme/ThemeContext';
import { Field, Notice } from '../../components/ui';

const cop = (v) => (Number.isFinite(v) ? v.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }) : '—');
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toLocaleString('es-CO', { maximumFractionDigits: d }) : '—');

const CONFIG = {
  gpu: {
    unit: 'MH/s', unitPerDevice: 'Hashrate por GPU (MH/s)', devices: 'Número de GPUs', powerLabel: 'Consumo por GPU (W)', rewardUnit: 'MH/s', overheadDefault: 120,
    presets: { 'NVIDIA RTX 3080': [100, 230], 'NVIDIA RTX 3070': [62, 120], 'NVIDIA RTX 3090': [120, 290], 'AMD RX 6800 XT': [64, 150] },
    defaults: { devices: 6, perDevice: 100, power: 230, reward: 9, psu: 1600, temp: 70, maxTemp: 83 },
    note: 'Valores de referencia aproximados (algoritmo Etchash). Verifícalos con mediciones de tus equipos.',
  },
  cpu: {
    unit: 'kH/s', unitPerDevice: 'Hashrate por CPU (kH/s)', devices: 'Número de CPUs', powerLabel: 'Consumo por CPU (W)', rewardUnit: 'kH/s', overheadDefault: 80,
    presets: { 'AMD Ryzen 9 7950X': [23, 170], 'AMD Ryzen 9 5950X': [19, 140], 'Intel Core i9-13900K': [17, 200], 'AMD Ryzen 7 5800X': [10, 105] },
    defaults: { devices: 1, perDevice: 19, power: 140, reward: 55, psu: 650, temp: 72, maxTemp: 90 },
    note: 'Valores de referencia aproximados (algoritmo RandomX). Verifícalos con mediciones de tus equipos.',
  },
};

/** Calculadora de eficiencia, costo energético, rentabilidad y márgenes de PSU y temperatura. */
export default function Calculator({ kind }) {
  const cfg = CONFIG[kind];
  const pal = usePalette();
  const fleet = useFleet();
  const [f, setF] = useState({ ...cfg.defaults, overhead: cfg.overheadDefault, efficiency: 90, price: 850 });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value === '' ? '' : Number(e.target.value) }));

  const loadPreset = (name) => { const p = cfg.presets[name]; if (p) setF((s) => ({ ...s, perDevice: p[0], power: p[1] })); };
  const loadRig = (id) => {
    const m = fleet?.machines?.find((x) => x.id === id);
    if (!m?.latest) return;
    const gpus = m.components.filter((c) => c.type === 'GPU').length || 1;
    const psu = m.components.find((c) => c.type === 'PSU')?.specs?.watts;
    setF((s) => ({ ...s, devices: gpus, perDevice: +(m.latest.hashrate / gpus).toFixed(1), power: Math.round((m.latest.powerKw * 1000 * (s.efficiency / 100) - s.overhead) / gpus), temp: m.latest.temperature, ...(psu ? { psu } : {}) }));
  };

  const r = useMemo(() => {
    const hash = f.devices * f.perDevice;
    const dc = f.devices * f.power + f.overhead;
    const wall = dc / Math.max(0.5, f.efficiency / 100);
    const kwhDay = (wall * 24) / 1000;
    const costDay = kwhDay * f.price;
    const revenueDay = hash * f.reward;
    return {
      hash, wall, kwhDay, costDay, costMonth: costDay * 30, revenueDay, profitDay: revenueDay - costDay, profitMonth: (revenueDay - costDay) * 30,
      perWatt: hash / Math.max(1, wall), psuLoad: (dc / Math.max(1, f.psu)) * 100, thermal: f.maxTemp - f.temp,
      breakEvenPrice: kwhDay > 0 ? revenueDay / kwhDay : NaN,
    };
  }, [f]);

  const chart = [{ name: 'Costo energía', v: r.costMonth, c: pal.purple }, { name: 'Ingreso', v: r.revenueDay * 30, c: pal.blue }, { name: 'Utilidad', v: r.profitMonth, c: r.profitMonth >= 0 ? pal.green : pal.red }];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="row-2">
        <section className="card">
          <header><div><h2>Parámetros</h2><p>Los resultados se recalculan mientras escribes.</p></div></header>
          <div className="grid2">
            <Field label="Modelo de referencia" htmlFor="c-pre"><select id="c-pre" className="input" defaultValue="" onChange={(e) => loadPreset(e.target.value)}><option value="" disabled>Elegir modelo…</option>{Object.keys(cfg.presets).map((p) => <option key={p}>{p}</option>)}</select></Field>
            {kind === 'gpu' && <Field label="Cargar desde un rig" htmlFor="c-rig" hint="Usa su última lectura real"><select id="c-rig" className="input" defaultValue="" onChange={(e) => loadRig(e.target.value)}><option value="" disabled>Elegir rig…</option>{fleet?.machines?.filter((m) => m.latest).map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}</select></Field>}
          </div>
          <div className="grid3">
            <Field label={cfg.devices} htmlFor="c-dev"><input id="c-dev" type="number" min={1} max={64} className="input" value={f.devices} onChange={set('devices')} /></Field>
            <Field label={cfg.unitPerDevice} htmlFor="c-per"><input id="c-per" type="number" min={0} step="0.1" className="input" value={f.perDevice} onChange={set('perDevice')} /></Field>
            <Field label={cfg.powerLabel} htmlFor="c-pw"><input id="c-pw" type="number" min={0} className="input" value={f.power} onChange={set('power')} /></Field>
            <Field label="Resto del sistema (W)" htmlFor="c-ov" hint="Placa, ventiladores, RAM"><input id="c-ov" type="number" min={0} className="input" value={f.overhead} onChange={set('overhead')} /></Field>
            <Field label="Eficiencia de la PSU (%)" htmlFor="c-eff"><input id="c-eff" type="number" min={50} max={99} className="input" value={f.efficiency} onChange={set('efficiency')} /></Field>
            <Field label="Capacidad de la PSU (W)" htmlFor="c-psu"><input id="c-psu" type="number" min={100} className="input" value={f.psu} onChange={set('psu')} /></Field>
            <Field label="Precio energía (COP/kWh)" htmlFor="c-price"><input id="c-price" type="number" min={0} className="input" value={f.price} onChange={set('price')} /></Field>
            <Field label={`Ingreso diario por ${cfg.rewardUnit} (COP)`} htmlFor="c-rw" hint="Según tu pool y la cotización actual"><input id="c-rw" type="number" min={0} step="0.1" className="input" value={f.reward} onChange={set('reward')} /></Field>
            <Field label="Temperatura actual / máx. (°C)" htmlFor="c-t"><div className="btn-row" style={{ flexWrap: 'nowrap' }}><input id="c-t" type="number" className="input" value={f.temp} onChange={set('temp')} aria-label="Temperatura actual" /><input type="number" className="input" value={f.maxTemp} onChange={set('maxTemp')} aria-label="Temperatura máxima" /></div></Field>
          </div>
          <p className="faint small">{cfg.note}</p>
        </section>
        <section className="card">
          <header><h2>Proyección mensual</h2></header>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={chart} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: pal.axis, fontSize: 11 }} />
              <YAxis hide />
              <Tooltip {...tooltipStyle(pal)} cursor={{ fill: pal.track, opacity: 0.4 }} formatter={(v) => [cop(v), 'COP / mes']} />
              <Bar dataKey="v" radius={[6, 6, 0, 0]}>{chart.map((c) => <Cell key={c.name} fill={c.c} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="muted small" style={{ marginTop: 8 }}>Punto de equilibrio: la operación es rentable mientras la energía cueste menos de <strong>{cop(r.breakEvenPrice)}</strong> por kWh.</p>
        </section>
      </div>
      {r.psuLoad > 80 && <Notice tone={r.psuLoad > 95 ? 'error' : 'warn'}>La fuente trabaja al {fmt(r.psuLoad, 0)} % de su capacidad. Por encima del 80 % se acelera su desgaste: es una de las fallas que PrediSys detecta.</Notice>}
      {r.thermal < 10 && <Notice tone={r.thermal < 0 ? 'error' : 'warn'}>Solo quedan {fmt(r.thermal)} °C de margen térmico. Revisa la pasta térmica y el flujo de aire.</Notice>}
      <div className="calc-out">
        <div style={{ '--c': 'var(--blue)' }}><span>Hashrate total</span><strong>{fmt(r.hash)} {cfg.unit}</strong></div>
        <div style={{ '--c': 'var(--purple)' }}><span>Consumo en el enchufe</span><strong>{fmt(r.wall, 0)} W</strong></div>
        <div style={{ '--c': 'var(--cyan)' }}><span>Eficiencia</span><strong>{fmt(r.perWatt, 3)} {cfg.unit}/W</strong></div>
        <div style={{ '--c': 'var(--yellow)' }}><span>Energía diaria</span><strong>{fmt(r.kwhDay, 2)} kWh</strong></div>
        <div style={{ '--c': 'var(--red)' }}><span>Costo energético / mes</span><strong>{cop(r.costMonth)}</strong></div>
        <div style={{ '--c': r.profitMonth >= 0 ? 'var(--green)' : 'var(--red)' }}><span>Utilidad / mes</span><strong>{cop(r.profitMonth)}</strong></div>
        <div style={{ '--c': r.psuLoad > 80 ? 'var(--red)' : 'var(--green)' }}><span>Carga de la PSU</span><strong>{fmt(r.psuLoad, 0)} %</strong></div>
        <div style={{ '--c': r.thermal < 10 ? 'var(--red)' : 'var(--green)' }}><span>Margen térmico</span><strong>{fmt(r.thermal)} °C</strong></div>
      </div>
    </div>
  );
}
