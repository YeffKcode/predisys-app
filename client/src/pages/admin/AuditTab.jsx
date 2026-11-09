import { useCallback, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useEventSource } from '../../hooks/useEventSource';
import { Loading, Notice, Pager, Tag } from '../../components/ui';
import { fmtDate } from '../../utils/format';

const tone = (action) => (/FAIL|DENIED|LOCKED|REJECTED|TAMPER|BLOCKED|ERROR/.test(action) ? 'hot' : /DELETE|OVERRIDE|REVOKED|ESCALATED|CRITICAL|FAULT|TEST_|CLEARED/.test(action) ? 'warm' : /SUCCESS|CREATED|VERIFIED|ANCHORED|UPLOADED|EXPORTED|BASELINE/.test(action) ? 'ok' : '');

export default function AuditTab() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ action: '', from: '', to: '' });
  const [live, setLive] = useState(true);
  const [fresh, setFresh] = useState(new Set());
  const query = { page, pageSize: 50, action: filters.action, from: filters.from ? new Date(filters.from).toISOString() : '', to: filters.to ? new Date(filters.to).toISOString() : '' };
  const { data, error, loading, setData } = useApi('/audit', { query });
  const unfiltered = page === 1 && !filters.action && !filters.from && !filters.to;

  const onLog = useCallback((log) => {
    if (!unfiltered) return;
    setData((d) => (d ? { ...d, total: d.total + 1, logs: [log, ...d.logs].slice(0, 50), actions: d.actions.includes(log.action) ? d.actions : [...d.actions, log.action].sort() } : d));
    setFresh((s) => new Set(s).add(log.id));
  }, [unfiltered, setData]);
  const connected = useEventSource('/audit/stream', 'audit', onLog, live);
  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };

  return (
    <section className="section">
      <header>
        <div>
          <h2>Registro de auditoría</h2>
          <p>Cada acción sensible queda registrada con usuario, IP y fecha. Las nuevas aparecen al instante en la primera página sin filtros.</p>
        </div>
        <div className="btn-row">
          <span className={`live${connected ? ' on' : ''}`}><span className="dot" />{connected ? 'En vivo' : live ? 'Conectando…' : 'En pausa'}</span>
          <button className="btn sm" onClick={() => setLive((v) => !v)}>{live ? 'Pausar' : 'Reanudar'}</button>
        </div>
      </header>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <select className="input" style={{ width: 240 }} aria-label="Acción" value={filters.action} onChange={set('action')}>
          <option value="">Todas las acciones</option>
          {(data?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="muted small">Desde <input type="datetime-local" className="input" style={{ width: 200, display: 'inline-block' }} value={filters.from} onChange={set('from')} /></label>
        <label className="muted small">Hasta <input type="datetime-local" className="input" style={{ width: 200, display: 'inline-block' }} value={filters.to} onChange={set('to')} /></label>
        {(filters.action || filters.from || filters.to) && <button className="btn ghost sm" onClick={() => { setFilters({ action: '', from: '', to: '' }); setPage(1); }}>Limpiar filtros</button>}
      </div>
      {error && <Notice tone="error">{error.message}</Notice>}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Acción</th><th>Usuario</th><th>IP</th><th>Objeto</th><th>Detalle</th></tr></thead>
              <tbody>
                {data.logs.length === 0 && <tr><td colSpan={6} className="muted">No hay registros con estos filtros.</td></tr>}
                {data.logs.map((l) => (
                  <tr key={l.id} className={fresh.has(l.id) ? 'fresh' : ''}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.createdAt)}</td>
                    <td><Tag tone={tone(l.action)}>{l.action}</Tag></td>
                    <td>{l.actorUsername || <span className="faint">anónimo</span>}</td>
                    <td className="code">{l.ip || '—'}</td>
                    <td className="muted small">{l.entity ? `${l.entity}${l.entityId ? ` · ${String(l.entityId).slice(0, 12)}` : ''}` : '—'}</td>
                    <td>{l.details ? <details><summary className="muted small">Ver</summary><pre className="code">{JSON.stringify(l.details, null, 2)}</pre></details> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}
