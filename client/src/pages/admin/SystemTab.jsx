import { useState } from 'react';
import { Bug, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../hooks/useApi';
import { Loading, Notice, Tag } from '../../components/ui';
import { fmtDate } from '../../utils/format';

const FAILURES = [
  ['sync', 'Error síncrono', 'Excepción lanzada dentro del controlador.'],
  ['async', 'Rechazo asíncrono', 'Promesa rechazada durante la petición.'],
  ['database', 'Error de base de datos', 'Consulta a una tabla que no existe.'],
];

function NotificationChannels() {
  const { data, error, loading, reload } = useApi('/admin/notifications/status');
  const row = (label, st, okText) => (
    <><dt>{label}</dt><dd>{st.ok ? <Tag tone="ok">{okText}</Tag> : <Tag tone="hot">No envía</Tag>} {!st.ok && <span className="small">{st.error}</span>}{st.ok && st.note && <span className="faint small"> {st.note}</span>}</dd></>
  );
  return (
    <section className="section">
      <header><div><h2>Canales de aviso</h2><p>Comprueba que las alertas puedan salir por correo y SMS, y quién las recibiría.</p></div><button className="btn sm" onClick={() => reload()}><RefreshCw size={14} />Comprobar</button></header>
      {loading && !data && <Loading />}
      {error && <Notice tone="error">{error.message}</Notice>}
      {data && (
        <>
          <dl className="kv" style={{ marginBottom: 14 }}>
            {row('Correo', data.email, `SMTP ${data.email.host}:${data.email.port}`)}
            {row('SMS', data.sms, data.sms.provider === 'twilio' ? 'Twilio' : 'Amazon SNS')}
            <dt>Lista de guardia</dt><dd>{data.oncall.emails} correo(s), {data.oncall.phones} teléfono(s)</dd>
            <dt>Destinos válidos</dt><dd>{data.deliverable === 0 ? <Tag tone="hot">Ninguno: una alerta crítica no le llegaría a nadie</Tag> : `${data.deliverable} para una alerta crítica`}</dd>
          </dl>
          {(!data.email.ok || !data.sms.ok) && <Notice tone="warn">Configura el canal en el .env de la raíz (ver los ejemplos de Gmail, SES, Twilio y SNS en .env.example), reinicia la API y ejecuta <span className="code">npm run notify:check -- --to=tu@correo.com</span>.</Notice>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Usuario</th><th>Correo</th><th>SMS</th><th>Desde</th><th>Problemas</th></tr></thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.username}>
                    <td><strong>{p.username}</strong></td>
                    <td>{p.emailEnabled ? p.email : <span className="faint">desactivado</span>}</td>
                    <td>{p.smsEnabled ? p.phone : <span className="faint">no</span>}</td>
                    <td>{p.minSeverity === 'WARNING' ? 'Advertencia' : 'Crítica'}</td>
                    <td className="small">{p.issues.length ? p.issues.join(' ') : <Tag tone="ok">Listo</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function ChainStatus() {
  const { data, error, loading, reload } = useApi('/admin/blockchain/status');
  const b = data?.blockchain;
  return (
    <section className="section">
      <header><div><h2>Blockchain</h2><p>Contrato donde se registran las huellas de las alertas críticas.</p></div><button className="btn sm" onClick={() => reload()}><RefreshCw size={14} />Actualizar</button></header>
      {loading && <Loading />}
      {error && <Notice tone="error">{error.message}</Notice>}
      {b && !b.enabled && <Notice tone="info">El registro en blockchain está deshabilitado. Despliega el contrato con <span className="code">npm run chain:deploy</span> y activa BLOCKCHAIN_ENABLED.</Notice>}
      {b?.enabled && (
        <dl className="kv">
          <dt>Red</dt><dd>{b.network} (chainId {b.chainId})</dd>
          <dt>Contrato</dt><dd className="code">{b.contract}</dd>
          <dt>Cuenta firmante</dt><dd className="code">{b.signer} {b.signerIsWriter ? <Tag tone="ok">autorizada</Tag> : <Tag tone="hot">sin permiso de escritura</Tag>}</dd>
          <dt>Saldo de prueba</dt><dd>{Number(b.balance).toFixed(5)} ETH {Number(b.balance) < 0.01 && <Tag tone="warm">recarga en un faucet</Tag>}</dd>
          <dt>Último bloque</dt><dd>{b.latestBlock}</dd>
          <dt>Alertas registradas</dt><dd>{b.totalRecords}</dd>
        </dl>
      )}
    </section>
  );
}

export default function SystemTab() {
  const { can } = useAuth();
  const health = useApi('/health');
  const logs = useApi('/admin/system/error-logs', { query: { lines: 50 } });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);

  const force = async (type) => {
    setBusy(type);
    setResult(null);
    try {
      await api('/admin/system/force-error', { method: 'POST', query: { type } });
    } catch (err) {
      setResult({ type, status: err.status, message: err.message, requestId: err.requestId });
      setTimeout(() => logs.reload({ silent: true }), 400);
    } finally {
      setBusy(null);
    }
  };

  const h = health.data;
  return (
    <>
      <section className="section">
        <header><div><h2>Estado de los servicios</h2></div><button className="btn sm" onClick={() => health.reload()}><RefreshCw size={14} />Actualizar</button></header>
        {h && (
          <dl className="kv">
            <dt>API</dt><dd><Tag tone={h.status === 'ok' ? 'ok' : 'warm'}>{h.status === 'ok' ? 'Operativa' : 'Degradada'}</Tag></dd>
            <dt>Base de datos</dt><dd><Tag tone={h.database === 'up' ? 'ok' : 'hot'}>{h.database === 'up' ? 'Conectada' : 'Sin conexión'}</Tag></dd>
            <dt>Servicio de predicción</dt><dd><Tag tone={h.ml?.status === 'ok' ? 'ok' : 'hot'}>{h.ml?.status === 'ok' ? `Modelo ${h.ml.model_version}` : 'No disponible'}</Tag>{h.ml?.dataset_source === 'synthetic' && <span className="faint small"> entrenado con datos sintéticos</span>}</dd>
          </dl>
        )}
      </section>

      {can('settings.manage') && <NotificationChannels />}
      {can('settings.manage') && <ChainStatus />}

      <section className="section">
        <header><div><h2>Prueba del registro de errores</h2><p>Provoca un fallo controlado para comprobar que queda capturado en logs/error.log con su identificador de petición.</p></div></header>
        <div className="btn-row" style={{ marginBottom: 12 }}>
          {FAILURES.map(([type, label, hint]) => (
            <button key={type} className="btn" title={hint} disabled={busy} onClick={() => force(type)}><Bug size={14} />{busy === type ? 'Provocando…' : label}</button>
          ))}
        </div>
        {result && (
          <Notice tone="warn">
            La API respondió {result.status}: «{result.message}». Busca el identificador <span className="code">{result.requestId}</span> en el registro.
          </Notice>
        )}
      </section>

      <section className="section">
        <header><div><h2>Últimos errores (logs/error.log)</h2></div><button className="btn sm" onClick={() => logs.reload()}><RefreshCw size={14} />Actualizar</button></header>
        {logs.loading && !logs.data && <Loading />}
        {logs.error && <Notice tone="error">{logs.error.message}</Notice>}
        {logs.data && (logs.data.entries.length === 0 ? <p className="muted">No hay errores registrados.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Mensaje</th><th>Ruta</th><th>Petición</th></tr></thead>
              <tbody>
                {logs.data.entries.map((e, i) => (
                  <tr key={`${e.timestamp}-${i}`} className={result?.requestId && e.requestId === result.requestId ? 'fresh' : ''}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.timestamp)}</td>
                    <td>{e.message}{e.stack && <details><summary className="faint small">Traza</summary><pre className="code">{e.stack}</pre></details>}</td>
                    <td className="code">{e.method ? `${e.method} ${e.path}` : '—'}</td>
                    <td className="code">{e.requestId ? e.requestId.slice(0, 8) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </>
  );
}
