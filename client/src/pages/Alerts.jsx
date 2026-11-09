import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCheck, ExternalLink, Mail, MessageSquare, RefreshCw, Send, ShieldAlert, ShieldCheck, ShieldQuestion, X } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../auth/LiveContext';
import { useApi } from '../hooks/useApi';
import { Drawer, Field, Loading, Modal, Notice, Pager, Tag } from '../components/ui';
import { useToast } from '../components/Toasts';
import { ALERT_STATUS, CHAIN_STATUS, SEVERITY, fmtDate, fmtRelative, num, pct, riskColor } from '../utils/format';

const VERDICTS = {
  VERIFIED: { icon: ShieldCheck, title: 'Registro íntegro', text: 'El hash recalculado desde la bitácora coincide con el guardado y con el registrado en la Testnet.' },
  TAMPERED: { icon: ShieldAlert, title: 'Integridad comprometida', text: 'El registro de la bitácora no coincide con su huella. Alguien modificó los datos de esta alerta después de crearla.' },
  NOT_ANCHORED: { icon: ShieldQuestion, title: 'Sin registro en blockchain', text: 'La bitácora es consistente, pero esta alerta no está registrada en la cadena (las advertencias no se registran).' },
  CHAIN_UNAVAILABLE: { icon: ShieldQuestion, title: 'Testnet no disponible', text: 'La bitácora es consistente, pero ahora no se puede consultar la cadena para compararla.' },
};

function Verification({ alertId }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try { setResult(await api(`/alerts/${alertId}/verify`)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const v = result?.verification;
  const meta = v && VERDICTS[v.verdict];
  return (
    <div>
      <button className="btn sm" onClick={run} disabled={busy}><ShieldCheck size={14} />{busy ? 'Verificando…' : 'Verificar integridad'}</button>
      {error && <Notice tone="error">{error}</Notice>}
      {meta && (
        <div className={`verdict ${v.verdict}`}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><meta.icon size={18} /><strong>{meta.title}</strong></div>
          <p className="muted small" style={{ margin: '6px 0 10px' }}>{meta.text}</p>
          <dl className="kv">
            <dt>Hash guardado</dt><dd className="code">{v.database.storedHash}</dd>
            <dt>Hash recalculado</dt><dd className="code" style={{ color: v.database.consistent ? undefined : 'var(--hot)' }}>{v.database.recomputedHash}</dd>
            {v.chain.onChain && <><dt>Hash en la cadena</dt><dd className="code" style={{ color: v.chain.matches ? undefined : 'var(--hot)' }}>{v.chain.onChain.recordHash}</dd></>}
            {v.chain.onChain && <><dt>Registrado en bloque</dt><dd>{fmtDate(v.chain.onChain.anchoredAt)} por <span className="code">{v.chain.onChain.submitter}</span></dd></>}
          </dl>
          <details style={{ marginTop: 10 }}><summary className="muted small">Ver registro canónico firmado</summary><pre className="code">{JSON.stringify(result.canonicalRecord, null, 2)}</pre></details>
        </div>
      )}
    </div>
  );
}

function AlertDetail({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const { lastEvent } = useLive();
  const { data, error, loading, reload } = useApi(`/alerts/${id}`);
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  useEffect(() => { if (lastEvent?.alert?.id === id || lastEvent?.alertId === id) reload({ silent: true }); }, [lastEvent, id, reload]);

  const act = async (key, path, body, msg) => {
    setBusy(key);
    try {
      await api(`/alerts/${id}/${path}`, { method: 'POST', body });
      toast({ tone: 'success', title: msg });
      reload({ silent: true });
      onChanged();
    } catch (err) {
      toast({ tone: 'error', title: 'No se pudo completar la acción', message: err.message });
    } finally {
      setBusy(null);
    }
  };

  const a = data?.alert;
  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 16, gap: 12 }}>
      <div>
        <h1>{a ? `Alerta en ${a.machineCode}` : 'Alerta'}</h1>
        {a && <div className="btn-row" style={{ marginTop: 8 }}><Tag tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Tag><Tag tone={ALERT_STATUS[a.status].tone}>{ALERT_STATUS[a.status].label}</Tag>{a.escalatedAt && <Tag tone="hot">Escalada</Tag>}{a.isTest && <Tag tone="purple">Prueba de laboratorio</Tag>}</div>}
      </div>
      <button className="btn ghost icon" aria-label="Cerrar" onClick={onClose}><X size={18} /></button>
    </div>
  );

  return (
    <Drawer onClose={onClose} header={header}>
      {loading && !a && <Loading />}
      {error && <Notice tone="error">{error.message}</Notice>}
      {a && (
        <>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 18 }}>
            <div>
              <div style={{ font: '600 42px/1 var(--font-cond)', color: riskColor(a.failureProbability) }}>{pct(a.failureProbability)}</div>
              <div className="muted small">probabilidad de falla</div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h2>{a.diagnosis || 'Sin diagnóstico'}</h2>
              {a.diagnosisConfidence != null && <p className="muted small">Confianza del diagnóstico: {pct(a.diagnosisConfidence)}</p>}
              {a.recommendation && <p style={{ marginTop: 8 }}>{a.recommendation}</p>}
            </div>
          </div>

          {can('alerts.manage') && a.status !== 'RESOLVED' && (
            <div className="btn-row" style={{ marginBottom: 20 }}>
              {a.status === 'OPEN' && <button className="btn primary" disabled={busy} onClick={() => act('ack', 'acknowledge', undefined, 'Alerta reconocida')}><CheckCheck size={15} />Reconocer alerta</button>}
              <button className="btn" disabled={busy} onClick={() => setResolving(true)}>Marcar como resuelta</button>
              <button className="btn ghost" disabled={busy} onClick={() => act('notify', 'notify', undefined, 'Notificaciones reenviadas')}><Send size={14} />Reenviar avisos</button>
            </div>
          )}

          <section className="section">
            <header><h3>Lectura que originó la alerta</h3><span className="muted small">{fmtDate(a.recordedAt)}</span></header>
            <dl className="kv">
              <dt>Temperatura</dt><dd>{num(a.variables?.temperature)} °C</dd>
              <dt>Ventiladores</dt><dd>{num(a.variables?.fanRpm, 0)} RPM</dd>
              <dt>Consumo</dt><dd>{num(a.variables?.powerKw, 3)} kW</dd>
              <dt>Hashrate</dt><dd>{num(a.variables?.hashrate)} MH/s</dd>
              <dt>Ocurrencias</dt><dd>{a.occurrences} (última {fmtRelative(a.lastSeenAt)})</dd>
              {a.modelVersion && <><dt>Versión del modelo</dt><dd>{a.modelVersion}</dd></>}
            </dl>
            {a.contributingFactors?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <h3 style={{ marginBottom: 4 }}>Variables que más se desvían</h3>
                {a.contributingFactors.map((f) => <div className="factor" key={f.feature}><span>{f.label}</span><span className="muted">{f.direction === 'alto' ? 'por encima' : 'por debajo'} de lo normal · {Math.abs(f.z_score)} σ</span></div>)}
              </div>
            )}
          </section>

          <section className="section">
            <header><div><h3>Trazabilidad en blockchain</h3><p>Solo las alertas críticas se registran en la Testnet.</p></div><Tag tone={CHAIN_STATUS[a.chain.status].tone}>{CHAIN_STATUS[a.chain.status].label}</Tag></header>
            <dl className="kv" style={{ marginBottom: 12 }}>
              <dt>Huella del registro</dt><dd className="code">{a.recordHash}</dd>
              {a.chain.network && <><dt>Red</dt><dd>{a.chain.network}</dd></>}
              {a.chain.txHash && <><dt>Transacción</dt><dd className="code">{a.chain.explorerUrl ? <a href={a.chain.explorerUrl} target="_blank" rel="noreferrer noopener">{a.chain.txHash} <ExternalLink size={12} /></a> : a.chain.txHash}</dd></>}
              {a.chain.blockNumber && <><dt>Bloque</dt><dd>{a.chain.blockNumber}</dd></>}
              {a.chain.error && <><dt>Último error</dt><dd style={{ color: '#ff9d95' }}>{a.chain.error} (intento {a.chain.attempts})</dd></>}
            </dl>
            <div className="btn-row">
              <Verification alertId={a.id} />
              {can('alerts.manage') && a.severity === 'CRITICAL' && ['FAILED', 'DISABLED'].includes(a.chain.status) && (
                <button className="btn sm" disabled={busy} onClick={() => act('anchor', 'anchor', undefined, 'Registro en blockchain reintentado')}><RefreshCw size={14} />Reintentar registro</button>
              )}
            </div>
          </section>

          <section className="section">
            <header><div><h3>Avisos enviados</h3><p>Correo y SMS según las preferencias de cada usuario y la lista de guardia.</p></div></header>
            {!a.notifications?.length ? <p className="muted">Nadie tenía avisos activados para esta severidad.</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Canal</th><th>Destino</th><th>Estado</th><th>Enviado</th></tr></thead>
                  <tbody>
                    {a.notifications.map((n) => (
                      <tr key={n.id}>
                        <td>{n.channel === 'EMAIL' ? <><Mail size={13} /> Correo</> : <><MessageSquare size={13} /> SMS</>}{n.isEscalation && <> <Tag tone="hot">escalada</Tag></>}</td>
                        <td className="code">{n.recipient}</td>
                        <td><Tag tone={{ SENT: 'ok', FAILED: 'hot', PENDING: 'warm', SKIPPED: 'muted' }[n.status]}>{{ SENT: 'Enviado', FAILED: 'Falló', PENDING: 'Pendiente', SKIPPED: 'Omitido' }[n.status]}</Tag>{n.error && <div className="faint small">{n.error}</div>}</td>
                        <td className="muted">{n.sentAt ? fmtDate(n.sentAt) : `${n.attempts} intento(s)`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {(a.acknowledgedAt || a.resolvedAt) && (
            <section className="section">
              <header><h3>Atención</h3></header>
              <dl className="kv">
                {a.acknowledgedAt && <><dt>Reconocida</dt><dd>{fmtDate(a.acknowledgedAt)} por {a.acknowledgedBy || '—'}</dd></>}
                {a.resolvedAt && <><dt>Resuelta</dt><dd>{fmtDate(a.resolvedAt)} por {a.resolvedBy || '—'}</dd></>}
                {a.resolutionNote && <><dt>Nota</dt><dd>{a.resolutionNote}</dd></>}
              </dl>
            </section>
          )}
        </>
      )}
      {resolving && (
        <Modal title="Resolver alerta" onClose={() => setResolving(false)} footer={<>
          <button className="btn" onClick={() => setResolving(false)}>Cancelar</button>
          <button className="btn primary" disabled={busy} onClick={async () => { await act('resolve', 'resolve', note.trim() ? { note: note.trim() } : {}, 'Alerta resuelta'); setResolving(false); setNote(''); }}>Marcar como resuelta</button>
        </>}>
          <Field label="Qué se hizo (opcional)" htmlFor="note" hint="Ej.: se reemplazaron los ventiladores del slot 3">
            <textarea id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
        </Modal>
      )}
    </Drawer>
  );
}

export default function Alerts() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lastEvent, reloadSummary } = useLive();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [kind, setKind] = useState('ALL');
  const { data, error, loading, reload } = useApi('/alerts', { query: { page, pageSize: 25, status, severity, kind } });
  useEffect(() => { if (lastEvent) reload({ silent: true }); }, [lastEvent, reload]);

  return (
    <>
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div>
          <p style={{ marginTop: 0 }}>Se generan cuando la probabilidad de falla supera el 40 % (advertencia) o el 70 % (crítica). Reconócelas para detener el escalamiento.</p>
        </div>
        <div className="btn-row">
          <div className="seg" role="group" aria-label="Origen">{[['ALL', 'Todas'], ['REAL', 'Reales'], ['TEST', 'Pruebas']].map(([k, l]) => <button key={k} aria-pressed={kind === k} onClick={() => { setKind(k); setPage(1); }}>{l}</button>)}</div>
          <select className="input" style={{ width: 160 }} aria-label="Estado" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Todos los estados</option>
            {Object.entries(ALERT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className="input" style={{ width: 170 }} aria-label="Severidad" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}>
            <option value="">Todas las severidades</option>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>
      {error && <Notice tone="error">{error.message}</Notice>}
      {loading && !data && <Loading />}
      {data && data.alerts.length === 0 && <div className="empty"><h3>No hay alertas con estos filtros</h3><p>Cuando una máquina muestre señales de deterioro aparecerá aquí y recibirás un aviso.</p></div>}
      {data && data.alerts.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Máquina</th><th>Severidad</th><th>Probabilidad</th><th>Diagnóstico</th><th>Estado</th><th>Blockchain</th><th>Creada</th></tr></thead>
              <tbody>
                {data.alerts.map((a) => (
                  <tr key={a.id} className={`clickable${lastEvent?.alert?.id === a.id && lastEvent.type === 'created' ? ' fresh' : ''}`} onClick={() => navigate(`/alerts/${a.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/alerts/${a.id}`)}>
                    <td><strong>{a.machineCode}</strong>{a.isTest && <> <Tag tone="purple">prueba</Tag></>}{a.occurrences > 1 && <span className="faint small"> ×{a.occurrences}</span>}</td>
                    <td><Tag tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Tag></td>
                    <td style={{ color: riskColor(a.failureProbability), fontWeight: 600 }}>{pct(a.failureProbability)}</td>
                    <td>{a.diagnosis}</td>
                    <td><Tag tone={ALERT_STATUS[a.status].tone}>{ALERT_STATUS[a.status].label}</Tag></td>
                    <td><Tag tone={CHAIN_STATUS[a.chain.status].tone}>{CHAIN_STATUS[a.chain.status].label}</Tag></td>
                    <td className="muted" title={fmtDate(a.createdAt)}>{fmtRelative(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
        </>
      )}
      {id && <AlertDetail id={id} onClose={() => navigate('/alerts')} onChanged={() => { reload({ silent: true }); reloadSummary(); }} />}
    </>
  );
}
