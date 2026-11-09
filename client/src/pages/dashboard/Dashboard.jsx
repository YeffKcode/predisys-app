import { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Activity, FlaskConical, Gauge, HeartPulse, Plus, Siren, X, Zap } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useFleet } from '../../auth/FleetContext';
import { usePalette, tooltipStyle } from '../../theme/ThemeContext';
import { Loading, Notice } from '../../components/ui';
import { useToast } from '../../components/Toasts';
import FaultInjectionModal from '../../components/FaultInjectionModal';
import { MACHINE_STATUS, hashUnit, num, riskVar } from '../../utils/format';
import { MachineFormModal } from './MachineForms';

const BUCKETS = [[0, 0.2, '0–20'], [0.2, 0.4, '20–40'], [0.4, 0.6, '40–60'], [0.6, 0.8, '60–80'], [0.8, 1.01, '80–100']];
const RISK_LABEL = { HEALTHY: 'Normal', WARNING: 'Advertencia', CRITICAL: 'Riesgo', UNKNOWN: 'Sin datos' };

function matches(m, filter) {
  if (!filter) return true;
  const p = m.latest?.failureProbability;
  if (filter.kind === 'risk') return m.risk === filter.value;
  if (filter.kind === 'bucket') return p != null && p >= filter.value[0] && p < filter.value[1];
  return true;
}

function Kpi({ label, value, unit, sub, extra, color, tint, Icon, onClick, active }) {
  return (
    <button className="kpi" style={{ '--kpi-color': color, '--kpi-tint': tint, borderColor: active ? color : undefined }} onClick={onClick}>
      <span className="label-caps">{label}</span>
      <Icon className="ico" size={20} />
      <div className="v">{value}{unit && <small>{unit}</small>}</div>
      <div className="sub"><span>{sub}</span>{extra}</div>
    </button>
  );
}

function MachineTile({ m, dim, onOpen }) {
  const p = m.latest?.failureProbability;
  const c = riskVar(m.risk);
  const h = hashUnit(m.latest?.hashrate);
  return (
    <button className={`mtile ${m.risk}${dim ? ' dim' : ''}`} onClick={() => onOpen(m.id)} aria-label={`${m.code}: ${p == null ? 'sin datos' : `${Math.round(p * 100)} % de riesgo`}`}>
      {m.syntheticLatest && <span className="flag" title="La última lectura viene de una falla inyectada">PRUEBA</span>}
      <div className="top">
        <strong>{m.code}</strong>
        <span className="dot" style={{ background: MACHINE_STATUS[m.status].color }} title={MACHINE_STATUS[m.status].label} />
      </div>
      <div className="kvrow"><span>Score</span><b style={{ color: c }}>{p == null ? '—' : `${Math.round(p * 100)}%`}</b></div>
      <div className="kvrow"><span>Temp</span><b>{m.latest ? `${num(m.latest.temperature)}°C` : '—'}</b></div>
      <div className="kvrow"><span>Hash</span><b>{m.latest ? `${h.value} ${h.unit}` : '—'}</b></div>
      <div className="bar"><i style={{ width: `${Math.max(3, (p ?? 0) * 100)}%`, background: c }} /></div>
    </button>
  );
}

export default function Dashboard() {
  const { can } = useAuth();
  const toast = useToast();
  const pal = usePalette();
  const fleet = useFleet();
  const [filter, setFilter] = useState(null);
  const [modal, setModal] = useState(null);

  const machines = fleet?.machines;
  const k = fleet?.kpis;
  const stats = useMemo(() => {
    const list = machines || [];
    const counts = { HEALTHY: 0, WARNING: 0, CRITICAL: 0, UNKNOWN: 0 };
    list.forEach((m) => { counts[m.risk] += 1; });
    const buckets = BUCKETS.map(([lo, hi, label]) => ({ label, lo, hi, count: list.filter((m) => m.latest?.failureProbability != null && m.latest.failureProbability >= lo && m.latest.failureProbability < hi).length }));
    const ranking = list.filter((m) => m.latest?.failureProbability != null).sort((a, b) => b.latest.failureProbability - a.latest.failureProbability);
    const withData = list.filter((m) => m.latest);
    const hash = withData.reduce((a, m) => a + (m.latest.hashrate || 0), 0);
    const kw = withData.reduce((a, m) => a + (m.latest.powerKw || 0), 0);
    return { counts, buckets, ranking, hash, kw };
  }, [machines]);

  if (!machines && !fleet?.error) return <Loading />;
  if (fleet?.error && !machines) return <Notice tone="error">{fleet.error.message}</Notice>;

  const toggle = (f) => setFilter((cur) => (cur && cur.kind === f.kind && String(cur.value) === String(f.value) ? null : f));
  const isActive = (kind, value) => filter?.kind === kind && String(filter.value) === String(value);
  const h = hashUnit(stats.hash);
  const bucketColor = (b) => (b.lo >= 0.6 ? pal.red : b.lo >= 0.4 ? pal.yellow : pal.green);
  const donut = [['HEALTHY', pal.green], ['WARNING', pal.yellow], ['CRITICAL', pal.red], ['UNKNOWN', pal.faint]]
    .map(([key, color]) => ({ key, name: RISK_LABEL[key], value: stats.counts[key], color })).filter((d) => d.value > 0 || d.key !== 'UNKNOWN');
  const active = machines.filter((m) => m.status === 'ONLINE').length;
  const tt = tooltipStyle(pal);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="kpis">
        <Kpi label="Salud de flota" value={k?.healthPct ?? '—'} unit={k?.healthPct != null ? '%' : ''} color="var(--green)" tint="var(--tint-green)" Icon={HeartPulse}
          sub={`${stats.counts.HEALTHY} rigs en operación normal`} active={isActive('risk', 'HEALTHY')} onClick={() => toggle({ kind: 'risk', value: 'HEALTHY' })} />
        <Kpi label="Poder de cómputo" value={h.value} unit={h.unit} color="var(--blue)" tint="var(--tint-blue)" Icon={Gauge}
          sub="Hashrate total agregado" extra={k?.efficiencyMhPerKw ? <span className="delta" style={{ color: 'var(--blue)' }}>{num(k.efficiencyMhPerKw, 0)} MH/s·kW</span> : null} onClick={() => setFilter(null)} />
        <Kpi label="Consumo energético" value={num(stats.kw, 1)} unit="kW" color="var(--purple)" tint="var(--tint-purple)" Icon={Zap}
          sub="Demanda eléctrica total" extra={k?.avgTemperature ? <span className="delta" style={{ color: 'var(--yellow)' }}>{num(k.avgTemperature)} °C prom.</span> : null} onClick={() => setFilter(null)} />
        <Kpi label="Riesgos críticos" value={stats.counts.CRITICAL} color={stats.counts.CRITICAL ? 'var(--red)' : 'var(--green)'} tint={stats.counts.CRITICAL ? 'var(--tint-red)' : 'var(--tint-green)'} Icon={Siren}
          sub={`Score ≥ ${Math.round((fleet.threshold || 0.7) * 100)} %`} extra={<span className="delta" style={{ color: 'var(--yellow)' }}>{stats.counts.WARNING} en advertencia</span>}
          active={isActive('risk', 'CRITICAL')} onClick={() => toggle({ kind: 'risk', value: 'CRITICAL' })} />
      </div>

      <div className="row-2">
        <section className="card">
          <header>
            <div><h2>Estado de máquinas</h2><p>Haz clic en un rig para ver su telemetría, analizarlo o inyectarle una falla de prueba.</p></div>
            <div className="btn-row">
              {filter && <button className="chip active" onClick={() => setFilter(null)}>{filter.kind === 'risk' ? RISK_LABEL[filter.value] : `Score ${BUCKETS.find((b) => b[0] === filter.value[0])[2]} %`}<X size={12} /></button>}
              <span className="chip">{machines.length ? `${machines[0].code} a ${machines[machines.length - 1].code}` : 'Sin rigs'}</span>
              {can('faults.inject') && machines.length > 0 && <button className="btn sm purple" onClick={() => setModal('fault')}><FlaskConical size={14} />Inyectar falla</button>}
              {can('machines.write') && <button className="btn sm primary" onClick={() => setModal('add')}><Plus size={14} />Agregar máquina</button>}
            </div>
          </header>
          <div className="machine-grid">
            {machines.map((m) => <MachineTile key={m.id} m={m} dim={!matches(m, filter)} onOpen={fleet.openMachine} />)}
            {can('machines.write') && (
              <button className="mtile add" onClick={() => setModal('add')}><Plus size={22} /><span>Agregar máquina</span><small className="faint">para analizarla</small></button>
            )}
          </div>
        </section>

        <section className="card">
          <header><h2>Salud global de flota</h2><span className="chip"><Activity size={12} />en vivo</span></header>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donut} dataKey="value" nameKey="name" innerRadius={68} outerRadius={92} paddingAngle={2} stroke="none" startAngle={90} endAngle={-270}
                  onClick={(d) => d?.key && d.key !== 'UNKNOWN' && toggle({ kind: 'risk', value: d.key })} cursor="pointer" isAnimationActive>
                  {donut.map((d) => <Cell key={d.key} fill={d.color} opacity={!filter || isActive('risk', d.key) ? 1 : 0.35} />)}
                </Pie>
                <Tooltip {...tt} formatter={(v, n) => [`${v} rigs`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center"><div><strong>{active}</strong><span className="label-caps">rigs activos</span></div></div>
          </div>
          <div className="legend-list">
            {donut.map((d) => (
              <button key={d.key} className={isActive('risk', d.key) ? 'active' : ''} onClick={() => toggle({ kind: 'risk', value: d.key })}>
                <span className="sw" style={{ background: d.color }} />{d.name}<b>{d.value}</b>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="row-eq">
        <section className="card">
          <header><div><h2>Distribución de score de anomalía</h2><p>Haz clic en una barra para resaltar esos rigs.</p></div><span className="chip">Histograma en vivo</span></header>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.buckets} margin={{ top: 24, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fill: pal.axis, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} />
              <Tooltip {...tt} cursor={{ fill: pal.track, opacity: 0.4 }} formatter={(v) => [`${v} rigs`, 'Cantidad']} labelFormatter={(l) => `Score ${l} %`} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} minPointSize={3} cursor="pointer" onClick={(b) => toggle({ kind: 'bucket', value: [b.lo, b.hi] })}>
                {stats.buckets.map((b) => <Cell key={b.label} fill={bucketColor(b)} opacity={!filter || isActive('bucket', [b.lo, b.hi]) ? 1 : 0.35} />)}
                <LabelList dataKey="count" position="top" style={{ fill: pal.text, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="card">
          <header><div><h2>Ranking de riesgo</h2><p>De mayor a menor score. Haz clic para abrir el rig.</p></div><span className="chip">Mayor a menor score</span></header>
          {stats.ranking.length === 0 ? <div className="empty"><h3>Sin lecturas todavía</h3><p>Genera la línea base de un rig para que aparezca aquí.</p></div> : (
            <div className="rank">
              {stats.ranking.slice(0, 7).map((m) => {
                const p = m.latest.failureProbability;
                return (
                  <button key={m.id} onClick={() => fleet.openMachine(m.id)}>
                    <div className="line"><span>{m.code} <span className="faint small" style={{ fontWeight: 400 }}>{m.latest.diagnosis}</span></span><span style={{ color: riskVar(m.risk) }}>{Math.round(p * 100)}%</span></div>
                    <div className="track"><i style={{ width: `${Math.max(2, p * 100)}%`, background: riskVar(m.risk) }} /></div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {modal === 'add' && (
        <MachineFormModal onClose={() => setModal(null)} onSaved={(m, msg) => {
          setModal(null);
          toast({ tone: 'success', title: msg, message: 'Genera su línea base o registra una lectura para analizarla.' });
          fleet.reload();
          fleet.openMachine(m.id);
        }} />
      )}
      {modal === 'fault' && <FaultInjectionModal machines={machines} onClose={() => setModal(null)} onDone={fleet.reload} />}
    </div>
  );
}
