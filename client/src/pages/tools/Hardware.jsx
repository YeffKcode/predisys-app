import { useMemo, useState } from 'react';
import { Cpu, Fan, HardDrive, Package, Zap } from 'lucide-react';
import { useFleet } from '../../auth/FleetContext';
import { Loading, Tag } from '../../components/ui';
import { COMPONENT_STATUS, COMPONENT_TYPE, fmtDate } from '../../utils/format';

const ICONS = { GPU: [Cpu, 'var(--green)'], PSU: [Zap, 'var(--yellow)'], COOLING: [Fan, 'var(--cyan)'], MOTHERBOARD: [HardDrive, 'var(--purple)'], OTHER: [Package, 'var(--pink)'] };

export default function Hardware() {
  const fleet = useFleet();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const all = useMemo(() => (fleet?.machines || []).flatMap((m) => m.components.map((c) => ({ ...c, machineId: m.id, machineCode: m.code }))), [fleet?.machines]);
  const rows = all.filter((c) => (!type || c.type === type) && (!status || c.status === status) && `${c.model} ${c.serialNumber || ''} ${c.machineCode}`.toLowerCase().includes(q.trim().toLowerCase()));
  if (!fleet?.machines) return <Loading />;
  const byType = Object.keys(COMPONENT_TYPE).map((t) => ({ t, n: all.filter((c) => c.type === t).length, bad: all.filter((c) => c.type === t && ['DEGRADED', 'FAILED'].includes(c.status)).length }));

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {byType.map(({ t, n, bad }) => {
          const [Icon, color] = ICONS[t];
          return (
            <button key={t} className="kpi" style={{ '--kpi-color': color, '--kpi-tint': 'transparent', borderColor: type === t ? color : undefined }} onClick={() => setType(type === t ? '' : t)}>
              <span className="label-caps">{COMPONENT_TYPE[t]}</span><Icon className="ico" size={20} />
              <div className="v" style={{ fontSize: 28 }}>{n}</div>
              <div className="sub"><span>{bad ? <span style={{ color: 'var(--red)' }}>{bad} con problemas</span> : 'Todo en orden'}</span></div>
            </button>
          );
        })}
      </div>
      <section className="card">
        <header>
          <div><h2>Inventario de componentes</h2><p>{rows.length} de {all.length} componentes. Haz clic en una fila para editarla en su rig.</p></div>
          <div className="btn-row">
            <input className="input" style={{ width: 220 }} placeholder="Modelo, serie o rig" aria-label="Buscar componente" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} />
            <select className="input" style={{ width: 160 }} aria-label="Tipo" value={type} onChange={(e) => setType(e.target.value)}><option value="">Todos los tipos</option>{Object.entries(COMPONENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select className="input" style={{ width: 160 }} aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.entries(COMPONENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </div>
        </header>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Rig</th><th>Tipo</th><th>Modelo</th><th>Serie</th><th>Estado</th><th>Especificaciones</th><th>Instalado</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="muted">Ningún componente coincide con los filtros.</td></tr>}
              {rows.map((c) => {
                const [Icon, color] = ICONS[c.type];
                return (
                  <tr key={c.id} className="clickable" onClick={() => fleet.openMachine(c.machineId, 'components')}>
                    <td><strong>{c.machineCode}</strong></td>
                    <td><Icon size={14} color={color} style={{ verticalAlign: -2, marginRight: 6 }} />{COMPONENT_TYPE[c.type]}</td>
                    <td>{c.model}</td>
                    <td className="mono small">{c.serialNumber || '—'}</td>
                    <td><Tag tone={COMPONENT_STATUS[c.status].tone}>{COMPONENT_STATUS[c.status].label}</Tag></td>
                    <td className="muted small">{Object.entries(c.specs || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}</td>
                    <td className="muted">{fmtDate(c.installedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
