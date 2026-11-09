import { useState } from 'react';
import { api } from '../api/client';
import { Field, Modal, Notice, Tag } from './ui';
import { pct } from '../utils/format';

/** Registro manual de una lectura (o generación de línea base) para analizar máquinas nuevas. */
export default function ReadingModal({ machine, onClose, onDone }) {
  const last = machine.latest;
  const [f, setF] = useState({ temperature: last?.temperature ?? 68, powerKw: last?.powerKw ?? 1.38, fanRpm: last?.fanRpm ?? 2050, hashrate: last?.hashrate ?? 585 });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async () => {
    setBusy('reading');
    setError(null);
    try {
      const body = { machineId: machine.id, temperature: Number(f.temperature), powerKw: Number(f.powerKw), fanRpm: Math.round(Number(f.fanRpm)), hashrate: Number(f.hashrate) };
      const res = await api('/telemetry', { method: 'POST', body });
      setResult(res);
      onDone?.();
    } catch (err) {
      setError(Array.isArray(err.details) ? err.details.map((d) => `${d.field}: ${d.message}`).join(' · ') : err.message);
    } finally { setBusy(null); }
  };
  const baseline = async () => {
    setBusy('baseline');
    setError(null);
    try {
      const res = await api(`/machines/${machine.id}/baseline`, { method: 'POST', body: { readings: 12 } });
      setResult({ baseline: res });
      onDone?.();
    } catch (err) { setError(err.message); } finally { setBusy(null); }
  };

  return (
    <Modal title={`Registrar lectura en ${machine.code}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cerrar</button>
      <button className="btn" disabled={busy} onClick={baseline}>{busy === 'baseline' ? 'Generando…' : 'Generar línea base (12 lecturas sanas)'}</button>
      <button className="btn primary" disabled={busy} onClick={submit}>{busy === 'reading' ? 'Analizando…' : 'Registrar y analizar'}</button>
    </>}>
      {error && <Notice tone="error">{error}</Notice>}
      {result?.telemetry && (
        <Notice tone={result.mlAvailable ? (result.riskLevel === 'CRITICAL' ? 'error' : result.riskLevel === 'WARNING' ? 'warn' : 'ok') : 'warn'}>
          {result.mlAvailable
            ? <>Lectura registrada. Probabilidad de falla <strong>{pct(result.telemetry.failureProbability)}</strong> · {result.telemetry.diagnosis}{result.alert?.created && <> · <Tag tone="hot">alerta creada</Tag></>}</>
            : <>Lectura guardada, pero sin predicción: {result.mlError}</>}
        </Notice>
      )}
      {result?.baseline && <Notice tone={result.baseline.mlAvailable ? 'ok' : 'warn'}>{result.baseline.message} {result.baseline.mlAvailable ? `Última probabilidad: ${pct(result.baseline.lastProbability)}.` : 'El servicio ML no respondió; las lecturas quedaron sin predicción.'}</Notice>}
      <p className="muted small" style={{ marginBottom: 14 }}>El modelo usa una ventana de las últimas 12 lecturas. Para una máquina nueva, genera primero la línea base y luego registra lecturas reales.</p>
      <div className="grid2">
        <Field label="Temperatura (°C)" htmlFor="r-t"><input id="r-t" type="number" step="0.1" min={-20} max={150} className="input" value={f.temperature} onChange={set('temperature')} /></Field>
        <Field label="Consumo (kW)" htmlFor="r-w"><input id="r-w" type="number" step="0.001" min={0} max={50} className="input" value={f.powerKw} onChange={set('powerKw')} /></Field>
        <Field label="Ventiladores (RPM)" htmlFor="r-r"><input id="r-r" type="number" step="1" min={0} max={20000} className="input" value={f.fanRpm} onChange={set('fanRpm')} /></Field>
        <Field label="Hashrate (MH/s)" htmlFor="r-h"><input id="r-h" type="number" step="0.1" min={0} max={1000000} className="input" value={f.hashrate} onChange={set('hashrate')} /></Field>
      </div>
    </Modal>
  );
}
