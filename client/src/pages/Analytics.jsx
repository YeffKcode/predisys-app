import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FlaskConical } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFleet } from '../auth/FleetContext';
import { useApi } from '../hooks/useApi';
import { usePalette, tooltipStyle } from '../theme/ThemeContext';
import FaultInjectionModal, { InjectionResult } from '../components/FaultInjectionModal';
import { Loading, Modal, Notice, Tag } from '../components/ui';
import { FAULT_TYPES, INTENSITY, fmtDate, pct } from '../utils/format';

const CLASS_ES = { NORMAL: 'Normal', THERMAL_PASTE: 'Pasta térmica', FAN_WEAR: 'Ventilador', PSU_INSTABILITY: 'PSU', GPU_DEGRADATION: 'GPU/VRAM', DUST_OBSTRUCTION: 'Polvo' };
const FEATURE_ES = { temperature: 'Temperatura', power_kw: 'Consumo', fan_rpm: 'RPM', hashrate: 'Hashrate', efficiency: 'Eficiencia', rpm_per_deg: 'RPM por °C', temp_slope: 'Tend. temp.', rpm_slope: 'Tend. RPM', power_slope: 'Tend. consumo', hash_slope: 'Tend. hashrate', temp_std: 'Inest. térmica', rpm_std: 'Inest. ventiladores', power_std: 'Fluct. consumo', hash_std: 'Volat. hashrate', hash_drop_pct: 'Caída hashrate' };

function Metric({ label, value, color, hint }) {
  return <div className="kpi" style={{ '--kpi-color': color, '--kpi-tint': 'transparent', cursor: 'default' }} title={hint}><span className="label-caps">{label}</span><div className="v" style={{ fontSize: 26 }}>{value}</div><div className="sub"><span>{hint}</span></div></div>;
}

function ModelCard() {
  const pal = usePalette();
  const { data, error, loading } = useApi('/ml/model');
  if (loading) return <section className="card"><Loading /></section>;
  if (error) return <Notice tone="error">{error.message}</Notice>;
  const m = data.model;
  const IF = m.metrics.isolation_forest;
  const cmp = m.metrics.comparison;
  const tt = tooltipStyle(pal);
  const compare = [
    { name: 'ROC-AUC', IF: +(IF.roc_auc * 100).toFixed(1), Umbral: +(cmp.static_threshold.roc_auc * 100).toFixed(1), LOF: +(cmp.local_outlier_factor_roc_auc * 100).toFixed(1) },
    { name: 'Fallas anticipadas', IF: IF.failures_anticipated_pct, Umbral: cmp.static_threshold.failures_anticipated_pct, LOF: null },
    { name: 'Recall (crítico)', IF: +(IF.at_critical.recall * 100).toFixed(1), Umbral: +(cmp.static_threshold.recall * 100).toFixed(1), LOF: null },
  ];
  const classes = Object.entries(m.metrics.random_forest.per_class_f1).map(([k, v]) => ({ name: CLASS_ES[k] || k, f1: +(v * 100).toFixed(1) }));
  const importances = Object.entries(m.feature_importances).slice(0, 8).map(([k, v]) => ({ name: FEATURE_ES[k] || k, v: +(v * 100).toFixed(1) }));
  const colors = [pal.green, pal.blue, pal.purple, pal.cyan, pal.pink, pal.yellow, pal.red, pal.green];
  return (
    <>
      <div className="kpis">
        <Metric label="ROC-AUC" value={IF.roc_auc.toFixed(3)} color="var(--green)" hint="Validación por nodo no visto" />
        <Metric label="Fallas anticipadas" value={`${IF.failures_anticipated_pct} %`} color="var(--blue)" hint={`vs ${cmp.static_threshold.failures_anticipated_pct} % del umbral fijo`} />
        <Metric label="Anticipación mediana" value={`${IF.median_lead_time_hours} h`} color="var(--purple)" hint="Antes de que el hashrate llegue a 0" />
        <Metric label="Falsos positivos" value={`${(IF.at_critical.false_positive_rate * 100).toFixed(2)} %`} color="var(--yellow)" hint="Al umbral crítico (70 %)" />
      </div>
      {m.dataset.source === 'synthetic' && <Notice tone="warn">El modelo en servicio se entrenó con el dataset sintético de desarrollo. Reentrénalo con dataset_predisys para obtener los resultados del proyecto.</Notice>}
      <div className="row-eq">
        <section className="card">
          <header><div><h2>Isolation Forest frente a otros enfoques</h2><p>Porcentaje sobre el mismo conjunto de validación.</p></div><Tag tone="blue">v{m.version}</Tag></header>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={compare} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={pal.grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: pal.axis, fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: pal.axis, fontSize: 11 }} />
              <Tooltip {...tt} cursor={{ fill: pal.track, opacity: 0.4 }} formatter={(v, n) => [`${v} %`, n === 'IF' ? 'Isolation Forest' : n === 'Umbral' ? 'Umbral fijo 80 °C' : 'LOF']} />
              <Bar dataKey="IF" fill={pal.green} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Umbral" fill={pal.yellow} radius={[4, 4, 0, 0]} />
              <Bar dataKey="LOF" fill={pal.purple} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="btn-row small muted"><span><span className="dot" style={{ background: pal.green }} /> Isolation Forest</span><span><span className="dot" style={{ background: pal.yellow }} /> Umbral fijo</span><span><span className="dot" style={{ background: pal.purple }} /> LOF</span></div>
        </section>
        <section className="card">
          <header><div><h2>Diagnóstico por tipo de falla</h2><p>F1 del Random Forest por clase · macro {m.metrics.random_forest.macro_f1}</p></div></header>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={classes} layout="vertical" margin={{ top: 0, right: 24, left: 20, bottom: 0 }}>
              <XAxis type="number" domain={[0, 100]} tick={{ fill: pal.axis, fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: pal.axis, fontSize: 12 }} width={90} />
              <Tooltip {...tt} cursor={{ fill: pal.track, opacity: 0.4 }} formatter={(v) => [`${v} %`, 'F1']} />
              <Bar dataKey="f1" radius={[0, 4, 4, 0]}>{classes.map((c, i) => <Cell key={c.name} fill={c.f1 >= 85 ? pal.green : c.f1 >= 70 ? pal.yellow : pal.red} opacity={0.6 + (i % 2) * 0.4} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>
      <section className="card">
        <header><div><h2>Variables más influyentes</h2><p>Importancia en el Random Forest (%). Así razona el modelo al diagnosticar.</p></div></header>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={importances} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fill: pal.axis, fontSize: 11 }} interval={0} />
            <YAxis tick={{ fill: pal.axis, fontSize: 11 }} />
            <Tooltip {...tt} cursor={{ fill: pal.track, opacity: 0.4 }} formatter={(v) => [`${v} %`, 'Importancia']} />
            <Bar dataKey="v" radius={[6, 6, 0, 0]}>{importances.map((d, i) => <Cell key={d.name} fill={colors[i]} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>
    </>
  );
}

function Lab() {
  const { can } = useAuth();
  const fleet = useFleet();
  const { data, loading, reload } = useApi('/fault-injections', { query: { limit: 30 } });
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const open = async (id) => setDetail((await api(`/fault-injections/${id}`)).injection);
  const st = data?.stats;
  return (
    <section className="card">
      <header>
        <div><h2>Laboratorio de fallas</h2><p>Inyecta degradaciones controladas en un rig y comprueba si el modelo las detecta a tiempo y con el diagnóstico correcto.</p></div>
        {can('faults.inject') && <button className="btn purple" onClick={() => setModal(true)} disabled={!fleet?.machines?.length}><FlaskConical size={15} />Nueva prueba</button>}
      </header>
      {st && st.total > 0 && (
        <div className="result-grid" style={{ marginTop: 0 }}>
          <div><span>Pruebas completadas</span><strong>{st.total}</strong></div>
          <div><span>Llegaron a crítico</span><strong style={{ color: 'var(--green)' }}>{st.detectedPct} %</strong></div>
          <div><span>Diagnóstico correcto</span><strong style={{ color: 'var(--blue)' }}>{st.diagnosisPct} %</strong></div>
          <div><span>Tipos de falla</span><strong style={{ color: 'var(--purple)' }}>5</strong></div>
        </div>
      )}
      {loading && !data && <Loading />}
      {data && data.injections.length === 0 && <div className="empty"><h3>Aún no hay pruebas</h3><p>Lanza la primera para ver cómo responde el modelo a una falla real simulada.</p></div>}
      {data && data.injections.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Rig</th><th>Falla</th><th>Intensidad</th><th>Prob. máx.</th><th>Crítica en</th><th>Diagnóstico</th><th>Por</th></tr></thead>
            <tbody>
              {data.injections.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => r.status === 'COMPLETED' && open(r.id)}>
                  <td className="muted">{fmtDate(r.createdAt)}</td>
                  <td><strong>{r.machineCode}</strong></td>
                  <td><span className="dot" style={{ background: FAULT_TYPES[r.faultType].color, marginRight: 6 }} />{FAULT_TYPES[r.faultType].label}</td>
                  <td>{INTENSITY[r.intensity]}</td>
                  <td className="mono">{r.status === 'COMPLETED' ? pct(r.maxProbability) : <Tag tone="hot">falló</Tag>}</td>
                  <td>{r.firstCriticalStep ? `paso ${r.firstCriticalStep}/${r.steps}` : <span className="faint">no llegó</span>}</td>
                  <td>{r.status !== 'COMPLETED' ? <span className="small faint">{r.error}</span> : r.diagnosisMatched ? <Tag tone="ok">correcto</Tag> : <Tag tone="warm">distinto</Tag>}</td>
                  <td className="muted">{r.createdByUsername}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <FaultInjectionModal machines={fleet.machines} onClose={() => { setModal(false); reload({ silent: true }); }} onDone={() => { reload({ silent: true }); fleet.reload(); }} />}
      {detail && <Modal wide title={`Prueba en ${detail.machineCode} · ${fmtDate(detail.createdAt)}`} onClose={() => setDetail(null)}><InjectionResult injection={detail} /></Modal>}
    </section>
  );
}

export default function Analytics() {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <ModelCard />
      <Lab />
    </div>
  );
}
