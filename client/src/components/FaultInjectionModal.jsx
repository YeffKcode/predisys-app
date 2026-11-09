import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Eraser, FlaskConical } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFleet } from '../auth/FleetContext';
import { usePalette, tooltipStyle } from '../theme/ThemeContext';
import { FAULT_TYPES, INTENSITY, pct } from '../utils/format';
import { Field, Modal, Notice, Tag } from './ui';
import { useToast } from './Toasts';

export function InjectionResult({ injection }) {
  const pal = usePalette();
  const data = (injection.results || []).map((r) => ({ step: r.step, prob: +(r.failureProbability * 100).toFixed(1), diag: r.diagnosis, temp: r.reading.temperature, rpm: r.reading.fanRpm, hash: r.reading.hashrate }));
  const ok = injection.diagnosisMatched;
  return (
    <>
      <div className="result-grid">
        <div><span>Probabilidad máxima</span><strong style={{ color: injection.maxProbability >= 0.7 ? 'var(--red)' : injection.maxProbability >= 0.4 ? 'var(--yellow)' : 'var(--green)' }}>{pct(injection.maxProbability)}</strong></div>
        <div><span>Advertencia en paso</span><strong style={{ color: 'var(--yellow)' }}>{injection.firstWarningStep ?? '—'}<small className="faint"> / {injection.steps}</small></strong></div>
        <div><span>Crítica en paso</span><strong style={{ color: 'var(--red)' }}>{injection.firstCriticalStep ?? 'No'}<small className="faint">{injection.firstCriticalStep ? ` / ${injection.steps}` : ''}</small></strong></div>
        <div><span>Diagnóstico</span><strong style={{ color: ok ? 'var(--green)' : 'var(--yellow)' }}>{ok ? 'Correcto' : 'Distinto'}</strong></div>
      </div>
      <Notice tone={ok ? 'ok' : 'warn'}>
        Falla inyectada: <strong>{FAULT_TYPES[injection.faultType]?.label}</strong>. El modelo diagnosticó <strong>{injection.results?.at(-1)?.diagnosis || '—'}</strong>
        {injection.firstCriticalStep ? `, y la marcó como crítica en el paso ${injection.firstCriticalStep} de ${injection.steps}.` : '. No llegó al umbral crítico: prueba con una intensidad mayor.'}
      </Notice>
      <div className="chart-box">
        <h3>Probabilidad de falla por paso de degradación</h3>
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={pal.grid} vertical={false} />
            <XAxis dataKey="step" tick={{ fill: pal.axis, fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fill: pal.axis, fontSize: 11 }} />
            <Tooltip {...tooltipStyle(pal)} formatter={(v, n) => [n === 'prob' ? `${v} %` : v, n === 'prob' ? 'Probabilidad' : n]} labelFormatter={(s) => `Paso ${s}: ${data[s - 1]?.diag || ''}`} />
            <ReferenceLine y={70} stroke={pal.red} strokeDasharray="4 4" />
            <ReferenceLine y={40} stroke={pal.yellow} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="prob" stroke={pal.purple} strokeWidth={2.5} dot={{ r: 2.5, fill: pal.purple }} isAnimationActive />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="muted small">Ver las {data.length} lecturas sintéticas</summary>
        <div className="table-wrap" style={{ marginTop: 8, maxHeight: 240, overflow: 'auto' }}>
          <table>
            <thead><tr><th>Paso</th><th>°C</th><th>RPM</th><th>MH/s</th><th>Prob.</th><th>Diagnóstico</th></tr></thead>
            <tbody>{data.map((r) => <tr key={r.step}><td>{r.step}</td><td>{r.temp}</td><td>{r.rpm}</td><td>{r.hash}</td><td className="mono">{r.prob} %</td><td className="small">{r.diag}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/** Laboratorio: inyecta una degradación progresiva y muestra cómo responde el modelo paso a paso. */
export default function FaultInjectionModal({ machine, machines, onClose, onDone }) {
  const { can } = useAuth();
  const fleet = useFleet();
  const toast = useToast();
  const [machineId, setMachineId] = useState(machine?.id || machines?.[0]?.id || '');
  const [faultType, setFaultType] = useState('FAN_WEAR');
  const [intensity, setIntensity] = useState('MEDIUM');
  const [steps, setSteps] = useState(20);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const target = useMemo(() => machine || machines?.find((m) => m.id === machineId), [machine, machines, machineId]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/machines/${machineId}/fault-injections`, { method: 'POST', body: { faultType, intensity, steps, notify } });
      setResult(res.injection);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    try {
      const res = await api(`/machines/${machineId}/test-data`, { method: 'DELETE' });
      toast({ tone: 'success', title: 'Datos de prueba eliminados', message: res.message });
      onDone?.();
      onClose();
    } catch (err) { setError(err.message); }
  };

  if (!can('faults.inject')) return null;
  return (
    <Modal wide title={result ? `Resultado de la prueba en ${result.machineCode}` : 'Inyectar falla de prueba'} onClose={onClose} footer={result ? <>
      <button className="btn danger" onClick={clear}><Eraser size={14} />Limpiar datos de prueba</button>
      <button className="btn" onClick={() => { fleet?.openMachine(machineId); onClose(); }}>Ver máquina</button>
      <button className="btn primary" onClick={() => setResult(null)}>Nueva prueba</button>
    </> : <>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn purple" disabled={busy || !machineId} onClick={run}><FlaskConical size={15} />{busy ? `Inyectando ${steps} lecturas…` : 'Inyectar falla'}</button>
    </>}>
      {error && <Notice tone="error">{error}</Notice>}
      {result ? <InjectionResult injection={result} /> : (
        <>
          <Notice tone="info">Se generan lecturas sintéticas cada vez más degradadas que pasan por el mismo flujo que la telemetría real. Quedan marcadas como <Tag tone="purple">prueba</Tag>, no se registran en blockchain y puedes borrarlas después.</Notice>
          {!machine && (
            <Field label="Máquina" htmlFor="fi-machine">
              <select id="fi-machine" className="input" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                {machines?.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
              </select>
            </Field>
          )}
          <div className="field">
            <label>Tipo de falla</label>
            <div className="option-grid">
              {Object.entries(FAULT_TYPES).map(([key, f]) => (
                <button key={key} type="button" className="option" style={{ '--opt': f.color }} aria-pressed={faultType === key} onClick={() => setFaultType(key)}>
                  <strong style={{ color: faultType === key ? f.color : undefined }}>{f.label}</strong><small>{f.desc}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label>Intensidad</label>
              <div className="seg" role="group" aria-label="Intensidad">
                {Object.entries(INTENSITY).map(([k, v]) => <button key={k} type="button" aria-pressed={intensity === k} onClick={() => setIntensity(k)}>{v}</button>)}
              </div>
              <span className="hint">Alta lleva la degradación hasta el punto de falla.</span>
            </div>
            <Field label={`Lecturas a generar: ${steps}`} htmlFor="fi-steps" hint="Más lecturas = degradación más gradual">
              <input id="fi-steps" type="range" min={6} max={40} value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
            </Field>
          </div>
          <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /><span>Enviar también avisos por correo/SMS <span className="faint small">(llegan marcados como [PRUEBA]; útil para validar la cadena de notificación)</span></span></label>
          {target && !target.latest && <Notice tone="warn">{target.code} todavía no tiene lecturas: se usará una línea base típica de rig.</Notice>}
        </>
      )}
    </Modal>
  );
}
