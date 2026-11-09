import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Eraser, FlaskConical, NotebookPen, Pencil, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { api, apiUrl } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useLive } from '../../auth/LiveContext';
import { useApi } from '../../hooks/useApi';
import { ConfirmModal, Drawer, Loading, Notice, Tag } from '../../components/ui';
import { useToast } from '../../components/Toasts';
import { ALERT_STATUS, COMPONENT_STATUS, COMPONENT_TYPE, MACHINE_STATUS, RISK, SEVERITY, bytes, fmtDate, fmtHM, num, pct, riskColor } from '../../utils/format';
import { ComponentFormModal, MachineFormModal } from './MachineForms';
import FaultInjectionModal from '../../components/FaultInjectionModal';
import ReadingModal from '../../components/ReadingModal';
import { usePalette, tooltipStyle as tts } from '../../theme/ThemeContext';

const SERIES = [
  { key: 'temperature', label: 'Temperatura (°C)', color: 'red' },
  { key: 'fanRpm', label: 'Ventiladores (RPM)', color: 'cyan' },
  { key: 'powerKw', label: 'Consumo (kW)', color: 'purple' },
  { key: 'hashrate', label: 'Hashrate (MH/s)', color: 'blue' },
];

function MiniChart({ data, dataKey, label, color }) {
  const pal = usePalette();
  color = pal[color];
  return (
    <div className="chart-box">
      <h3>{label}</h3>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={pal.grid} vertical={false} />
          <XAxis dataKey="t" tick={{ fill: pal.axis, fontSize: 10 }} minTickGap={40} />
          <YAxis tick={{ fill: pal.axis, fontSize: 10 }} domain={['auto', 'auto']} />
          <Tooltip {...tts(pal)} />
          <Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={1.6} isAnimationActive={false} name={label} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TelemetryTab({ machine, threshold, onReading }) {
  const pal = usePalette();
  const { can } = useAuth();
  const data = machine.history.map((h) => ({ ...h, t: fmtHM(h.recordedAt), prob: h.failureProbability != null ? +(h.failureProbability * 100).toFixed(1) : null }));
  if (!data.length) {
    return (
      <div className="empty">
        <h3>Esta máquina aún no tiene lecturas</h3>
        <p>Genera su línea base o registra una lectura para que el modelo pueda analizarla.</p>
        {can('telemetry.write') && <button className="btn primary" style={{ marginTop: 14 }} onClick={onReading}><NotebookPen size={15} />Registrar lectura o línea base</button>}
      </div>
    );
  }
  const factors = machine.latestFactors || [];
  return (
    <>
      <div className="chart-box" style={{ marginBottom: 14 }}>
        <h3>Probabilidad de falla (%)</h3>
        <ResponsiveContainer width="100%" height={170}>
          <LineChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={pal.grid} vertical={false} />
            <XAxis dataKey="t" tick={{ fill: pal.axis, fontSize: 10 }} minTickGap={40} />
            <YAxis domain={[0, 100]} tick={{ fill: pal.axis, fontSize: 10 }} />
            <Tooltip {...tts(pal)} formatter={(v) => [`${v} %`, 'Probabilidad']} />
            <ReferenceLine y={threshold * 100} stroke={pal.red} strokeDasharray="4 4" label={{ value: 'crítico', fill: pal.red, fontSize: 10, position: 'insideTopRight' }} />
            <ReferenceLine y={40} stroke={pal.yellow} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="prob" stroke={pal.green} dot={false} strokeWidth={2.2} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {factors.length > 0 && (
        <div className="section" style={{ padding: '12px 16px' }}>
          <h3 style={{ marginBottom: 6 }}>Variables que más se desvían de lo normal</h3>
          {factors.map((f) => <div className="factor" key={f.feature}><span>{f.label}</span><span className="muted">{f.direction === 'alto' ? 'por encima' : 'por debajo'} · {Math.abs(f.z_score)} σ</span></div>)}
        </div>
      )}
      <div className="charts">{SERIES.map((s) => <MiniChart key={s.key} data={data} dataKey={s.key} label={s.label} color={s.color} />)}</div>
    </>
  );
}

function ComponentsTab({ machine, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const editable = can('components.write');
  const saved = (_, msg) => { setEditing(null); toast({ tone: 'success', title: msg }); onChange(); };
  return (
    <>
      {editable && <div className="btn-row" style={{ marginBottom: 12 }}><button className="btn sm" onClick={() => setEditing('new')}><Plus size={14} />Agregar componente</button></div>}
      {machine.components.length === 0 ? <div className="empty"><h3>Sin componentes registrados</h3><p>Agrega GPUs, fuente de poder y refrigeración para llevar el inventario.</p></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tipo</th><th>Modelo</th><th>Serie</th><th>Estado</th><th>Especificaciones</th>{editable && <th aria-label="Acciones" />}</tr></thead>
            <tbody>
              {machine.components.map((c) => (
                <tr key={c.id}>
                  <td>{COMPONENT_TYPE[c.type]}</td>
                  <td>{c.model}</td>
                  <td className="muted">{c.serialNumber || '—'}</td>
                  <td><Tag tone={COMPONENT_STATUS[c.status].tone}>{COMPONENT_STATUS[c.status].label}</Tag></td>
                  <td className="muted small">{Object.entries(c.specs || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}</td>
                  {editable && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm icon" aria-label={`Editar ${c.model}`} onClick={() => setEditing(c)}><Pencil size={14} /></button>
                      <button className="btn ghost sm icon" aria-label={`Eliminar ${c.model}`} onClick={() => setRemoving(c)}><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ComponentFormModal machineId={machine.id} component={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={saved} />}
      {removing && (
        <ConfirmModal title="Eliminar componente" confirmLabel="Eliminar componente" onClose={() => setRemoving(null)}
          message={`Se eliminará ${COMPONENT_TYPE[removing.type]} ${removing.model} de ${machine.code}. Si lo reemplazaste, considera marcarlo como «Reemplazado» para conservar el historial.`}
          onConfirm={async () => { await api(`/components/${removing.id}`, { method: 'DELETE' }); toast({ tone: 'success', title: 'Componente eliminado' }); onChange(); }} />
      )}
    </>
  );
}

function DocumentsTab({ machine, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    try {
      await api(`/machines/${machine.id}/attachments`, { method: 'POST', form });
      toast({ tone: 'success', title: `${file.name} subido` });
      onChange();
    } catch (err) {
      setError(`${file.name}: ${err.message}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      {can('files.upload') && (
        <div style={{ marginBottom: 14 }}>
          <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn sm" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} />{busy ? 'Subiendo…' : 'Subir documento'}</button>
          <span className="muted small" style={{ marginLeft: 10 }}>Facturas, garantías o manuales en PDF, PNG o JPEG, hasta 5 MB. El contenido se verifica byte a byte.</span>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {machine.attachments.length === 0 ? <div className="empty"><h3>Sin documentos</h3><p>Sube la garantía o la factura de los equipos de esta máquina.</p></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Archivo</th><th>Tipo</th><th>Tamaño</th><th>Subido</th><th aria-label="Acciones" /></tr></thead>
            <tbody>
              {machine.attachments.map((a) => (
                <tr key={a.id}>
                  <td>{a.originalName}</td><td className="muted">{a.mimeType}</td><td className="muted">{bytes(a.sizeBytes)}</td><td className="muted">{fmtDate(a.createdAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <a className="btn ghost sm icon" href={apiUrl(`/attachments/${a.id}`)} aria-label={`Descargar ${a.originalName}`}><Download size={14} /></a>
                    {can('files.upload') && <button className="btn ghost sm icon" aria-label={`Eliminar ${a.originalName}`} onClick={async () => { await api(`/attachments/${a.id}`, { method: 'DELETE' }); onChange(); }}><Trash2 size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function AlertsTab({ machine }) {
  const { data, loading } = useApi('/alerts', { query: { machineId: machine.id, pageSize: 20 } });
  if (loading) return <Loading />;
  if (!data?.alerts.length) return <div className="empty"><h3>Sin alertas</h3><p>Esta máquina no ha generado alertas.</p></div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Severidad</th><th>Probabilidad</th><th>Diagnóstico</th><th>Estado</th></tr></thead>
        <tbody>
          {data.alerts.map((a) => (
            <tr key={a.id}>
              <td><Link to={`/alerts/${a.id}`}>{fmtDate(a.createdAt)}</Link></td>
              <td><Tag tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Tag></td>
              <td>{pct(a.failureProbability)}</td>
              <td className="muted">{a.diagnosis}</td>
              <td><Tag tone={ALERT_STATUS[a.status].tone}>{ALERT_STATUS[a.status].label}</Tag></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MachineDrawer({ machineId, threshold, onClose, onChanged, initialTab = 'telemetry' }) {
  const { can } = useAuth();
  const toast = useToast();
  const { lastEvent } = useLive();
  const [tab, setTab] = useState(initialTab);
  const [action, setAction] = useState(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [factors, setFactors] = useState([]);
  const { data, error, loading, reload } = useApi(`/machines/${machineId}`);

  useEffect(() => {
    if (lastEvent?.alert?.machineId === machineId) reload({ silent: true });
  }, [lastEvent, machineId, reload]);
  useEffect(() => {
    const id = setInterval(() => reload({ silent: true }), 20000);
    return () => clearInterval(id);
  }, [reload]);

  const changed = () => { reload({ silent: true }); onChanged(); };
  const m = data?.machine;

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const res = await api(`/machines/${machineId}/analyze`, { method: 'POST' });
      setFactors(res.prediction.contributingFactors || []);
      toast({ tone: res.risk === 'CRITICAL' ? 'critical' : res.risk === 'WARNING' ? 'warning' : 'success', title: `Análisis de ${m.code}: ${pct(res.prediction.failureProbability)}`, message: res.prediction.diagnosis });
      changed();
    } catch (err) {
      toast({ tone: 'error', title: 'No se pudo analizar', message: err.code === 'NO_TELEMETRY' ? 'La máquina no tiene lecturas. Usa «Registrar lectura» para generar su línea base.' : err.message });
    } finally {
      setAnalyzing(false);
    }
  };

  const header = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <h1 className="mono">{m?.code || 'Máquina'}</h1>
          {m && <p className="muted">{m.name}{m.location ? ` · ${m.location}` : ''}</p>}
        </div>
        <button className="btn ghost icon" aria-label="Cerrar" onClick={onClose}><X size={18} /></button>
      </div>
      {m && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: '14px 0', flexWrap: 'wrap' }}>
          <div>
            <div style={{ font: '600 34px/1 var(--font-cond)', color: riskColor(m.latest?.failureProbability) }}>{pct(m.latest?.failureProbability)}</div>
            <div className="muted small">probabilidad de falla</div>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Tag tone={RISK[m.risk].tone}>{RISK[m.risk].label}</Tag>{' '}
            <span className="muted small"><span className="dot" style={{ background: MACHINE_STATUS[m.status].color, marginRight: 4 }} />{MACHINE_STATUS[m.status].label}</span>
            <p style={{ marginTop: 6 }}>{m.latest?.diagnosis || 'Sin diagnóstico todavía'}</p>
          </div>
          <div className="btn-row">
            {can('telemetry.read') && <button className="btn sm primary" onClick={analyze} disabled={analyzing || !m.latest}><RefreshCw size={14} />{analyzing ? 'Analizando…' : 'Analizar ahora'}</button>}
            {can('telemetry.write') && <button className="btn sm" onClick={() => setAction('reading')}><NotebookPen size={14} />Registrar lectura</button>}
            {can('faults.inject') && <button className="btn sm purple" onClick={() => setAction('fault')}><FlaskConical size={14} />Inyectar falla</button>}
            {can('faults.inject') && m.syntheticLatest && <button className="btn sm" onClick={() => setAction('clear')}><Eraser size={14} />Limpiar pruebas</button>}
            {can('machines.write') && <button className="btn sm" onClick={() => setEditing(true)}><Pencil size={14} />Editar</button>}
            {can('machines.write') && <button className="btn sm danger" onClick={() => setRemoving(true)}><Trash2 size={14} />Eliminar</button>}
          </div>
        </div>
      )}
      <div className="tabs" role="tablist" style={{ marginBottom: 0, borderBottom: 0 }}>
        {[['telemetry', 'Telemetría'], ['components', `Componentes${m ? ` (${m.components.length})` : ''}`], ['documents', 'Documentos'], ...(can('alerts.read') ? [['alerts', 'Alertas']] : [])].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
    </>
  );

  return (
    <Drawer onClose={onClose} header={header}>
      {loading && !m && <Loading />}
      {error && <Notice tone="error">{error.message}</Notice>}
      {m && tab === 'telemetry' && <TelemetryTab machine={{ ...m, latestFactors: factors }} threshold={threshold} onReading={() => setAction('reading')} />}
      {action === 'reading' && m && <ReadingModal machine={m} onClose={() => setAction(null)} onDone={changed} />}
      {action === 'fault' && m && <FaultInjectionModal machine={m} onClose={() => setAction(null)} onDone={changed} />}
      {action === 'clear' && m && (
        <ConfirmModal title={`Limpiar datos de prueba de ${m.code}`} confirmLabel="Eliminar datos de prueba" onClose={() => setAction(null)}
          message="Se eliminarán las lecturas sintéticas y las alertas de prueba de esta máquina. La telemetría real y el historial de inyecciones se conservan."
          onConfirm={async () => { const r = await api(`/machines/${m.id}/test-data`, { method: 'DELETE' }); toast({ tone: 'success', title: 'Datos de prueba eliminados', message: r.message }); changed(); }} />
      )}
      {m && tab === 'components' && <ComponentsTab machine={m} onChange={changed} />}
      {m && tab === 'documents' && <DocumentsTab machine={m} onChange={changed} />}
      {m && tab === 'alerts' && <AlertsTab machine={m} />}
      {m && tab === 'telemetry' && m.latest && (
        <p className="faint small" style={{ marginTop: 12 }}>Última lectura {fmtDate(m.latest.recordedAt)} · {num(m.latest.temperature)} °C · {num(m.latest.fanRpm, 0)} RPM · {num(m.latest.powerKw, 2)} kW · {num(m.latest.hashrate)} MH/s</p>
      )}
      {editing && <MachineFormModal machine={m} onClose={() => setEditing(false)} onSaved={(_, msg) => { setEditing(false); toast({ tone: 'success', title: msg }); changed(); }} />}
      {removing && (
        <ConfirmModal title={`Eliminar ${m.code}`} confirmLabel="Eliminar máquina" onClose={() => setRemoving(false)}
          message={`Se eliminarán ${m.code}, sus ${m.components.length} componentes, su telemetría y sus documentos. Las alertas se conservan en la bitácora para auditoría.`}
          onConfirm={async () => { await api(`/machines/${m.id}`, { method: 'DELETE' }); toast({ tone: 'success', title: `${m.code} eliminada` }); onChanged(); onClose(); }} />
      )}
    </Drawer>
  );
}
