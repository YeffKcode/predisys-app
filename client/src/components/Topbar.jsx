import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, FileDown, FileSpreadsheet, FileText, Info, Menu, Moon, Sun } from 'lucide-react';
import { api, downloadFile } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../auth/LiveContext';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from './Toasts';
import { Modal, Tag } from './ui';
import { SessionTimer } from './SessionGuard';
import { SEVERITY, fmtRelative, pct } from '../utils/format';

const TITLES = [
  ['/dashboard', 'Vista general de flota', 'Inteligencia predictiva con Isolation Forest y Random Forest sobre telemetría en tiempo real.'],
  ['/analytics', 'Analítica ML', 'Desempeño del modelo y laboratorio de fallas de prueba.'],
  ['/alerts', 'Alertas', 'Eventos de riesgo detectados por el modelo, con trazabilidad en blockchain.'],
  ['/admin', 'Administración', 'Usuarios, roles, auditoría, sesiones y estado del sistema.'],
  ['/profile', 'Perfil y preferencias', 'Credenciales, avisos y sesiones activas.'],
  ['/tools/hardware', 'Base de hardware', 'Inventario de componentes de toda la flota.'],
  ['/tools/gpu', 'Calculadora GPU', 'Eficiencia, costo energético y margen térmico de un rig de GPUs.'],
  ['/tools/cpu', 'Calculadora CPU', 'Rendimiento y costo de minería con CPU.'],
];

function useOutside(ref, onClose) {
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [ref, onClose]);
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  return <b>{now.toLocaleTimeString('es-CO', { hour12: false })}</b>;
}

function StatusPill() {
  const { connected } = useLive();
  const [model, setModel] = useState(null);
  useEffect(() => {
    const load = () => api('/health').then((h) => setModel(h.ml)).catch(() => setModel({ status: 'down' }));
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);
  const mlOk = model?.status === 'ok' && model?.auth !== 'token_mismatch';
  return (
    <Link to="/analytics" className="pill hide-sm" style={{ textDecoration: 'none' }} title="Estado del servicio de predicción y del canal en vivo">
      <span className={`live-dot${connected ? '' : ' off'}`} />
      <Clock />
      <span className="sep" />
      {model == null ? 'Modelo…' : mlOk ? <>Modelo <b style={{ color: 'var(--green)' }}>v{String(model.model_version).slice(2, 8)}</b></> : <b style={{ color: 'var(--red)' }}>{model.auth === 'token_mismatch' ? 'ML: token inválido' : 'ML fuera de línea'}</b>}
      <span className="sep" />
      <SessionTimer />
    </Link>
  );
}

function ExportMenu() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false));
  const run = async (key, path, query, label) => {
    setBusy(key);
    try {
      const out = await downloadFile(path, { query });
      toast({ tone: 'success', title: `${label} descargado`, message: `${out.name} · documento ${out.documentId?.slice(0, 8) || '—'} (registrado en auditoría)` });
      setOpen(false);
    } catch (err) {
      toast({ tone: 'error', title: `No se pudo exportar: ${label}`, message: err.message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><FileDown size={16} />Exportar informe<ChevronDown size={14} /></button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" disabled={busy} onClick={() => run('pdf', '/reports/fleet.pdf', null, 'Informe de flota')}>
            <FileText size={18} color="var(--red)" /><span>{busy === 'pdf' ? 'Generando PDF…' : 'Informe de flota (PDF)'}<small>KPIs, máquinas, alertas y pruebas del modelo</small></span>
          </button>
          <button role="menuitem" disabled={busy} onClick={() => run('csv24', '/reports/telemetry.csv', { hours: 24 }, 'Telemetría 24 h')}>
            <FileSpreadsheet size={18} color="var(--green)" /><span>{busy === 'csv24' ? 'Generando…' : 'Telemetría últimas 24 h (CSV)'}<small>Solo lecturas reales</small></span>
          </button>
          <button role="menuitem" disabled={busy} onClick={() => run('csv7', '/reports/telemetry.csv', { hours: 168, includeSynthetic: 'true' }, 'Telemetría 7 días')}>
            <FileSpreadsheet size={18} color="var(--blue)" /><span>{busy === 'csv7' ? 'Generando…' : 'Telemetría 7 días con pruebas (CSV)'}<small>Incluye lecturas de fallas inyectadas</small></span>
          </button>
        </div>
      )}
    </div>
  );
}

function BellMenu() {
  const navigate = useNavigate();
  const { summary, lastEvent } = useLive();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false));
  const count = (summary?.open?.critical || 0) + (summary?.open?.warning || 0);
  useEffect(() => {
    if (open) api('/alerts', { query: { status: 'OPEN', pageSize: 8 } }).then((r) => setItems(r.alerts)).catch(() => setItems([]));
  }, [open, lastEvent]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn" aria-label={`Alertas abiertas: ${count}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={18} />{count > 0 && <span className="badge">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="menu wide" role="menu">
          <div className="menu-head"><strong>Alertas abiertas</strong><Link to="/alerts" onClick={() => setOpen(false)} className="small">Ver todas</Link></div>
          {items.length === 0 && <p className="muted small" style={{ padding: '10px' }}>No hay alertas abiertas. La flota está bajo control.</p>}
          {items.map((a) => (
            <button key={a.id} role="menuitem" onClick={() => { setOpen(false); navigate(`/alerts/${a.id}`); }}>
              <span className="dot" style={{ background: a.severity === 'CRITICAL' ? 'var(--red)' : 'var(--yellow)', marginTop: 6 }} />
              <span style={{ flex: 1 }}>
                <strong>{a.machineCode}</strong> · {pct(a.failureProbability)} {a.isTest && <Tag tone="purple">prueba</Tag>}
                <small>{a.diagnosis} · {fmtRelative(a.createdAt)}</small>
              </span>
              <Tag tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Tag>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoModal({ onClose }) {
  const { can } = useAuth();
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { if (can('telemetry.read')) api('/ml/model').then((r) => setModel(r.model)).catch((e) => setError(e.message)); }, [can]);
  const m = model?.metrics;
  return (
    <Modal wide title="Cómo funciona PrediSys" onClose={onClose}>
      <div className="grid2">
        <div>
          <h3 style={{ marginBottom: 6 }}>Lectura del riesgo</h3>
          <p className="muted small" style={{ marginBottom: 10 }}>Cada lectura de temperatura, consumo, ventiladores y hashrate pasa por dos modelos.</p>
          <dl className="kv">
            <dt><Tag tone="ok">0–39 %</Tag></dt><dd>Operación normal.</dd>
            <dt><Tag tone="warm">40–69 %</Tag></dt><dd>Advertencia: planifica una revisión.</dd>
            <dt><Tag tone="hot">70–100 %</Tag></dt><dd>Crítica: alerta por correo y SMS y registro en blockchain.</dd>
          </dl>
          <h3 style={{ margin: '16px 0 6px' }}>Modelos</h3>
          <p className="small muted">Isolation Forest detecta comportamiento anómalo y su puntaje se calibra como probabilidad de falla. Random Forest identifica la causa más probable.</p>
        </div>
        <div>
          <h3 style={{ marginBottom: 6 }}>Modelo en servicio</h3>
          {error && <p className="small" style={{ color: 'var(--red)' }}>{error}</p>}
          {!model && !error && <p className="muted small">{can('telemetry.read') ? 'Consultando…' : 'Necesitas el permiso telemetry.read para ver las métricas.'}</p>}
          {model && (
            <dl className="kv">
              <dt>Versión</dt><dd className="mono">{model.version}</dd>
              <dt>Entrenado</dt><dd>{new Date(model.trained_at).toLocaleString('es-CO')}</dd>
              <dt>Datos</dt><dd>{model.dataset.rows?.toLocaleString('es-CO')} filas · {model.dataset.nodes} nodos {model.dataset.source === 'synthetic' && <Tag tone="warm">sintético</Tag>}</dd>
              <dt>ROC-AUC</dt><dd className="mono">{m?.isolation_forest.roc_auc}</dd>
              <dt>Fallas anticipadas</dt><dd className="mono">{m?.isolation_forest.failures_anticipated_pct} %</dd>
              <dt>Anticipación media</dt><dd className="mono">{m?.isolation_forest.median_lead_time_hours} h</dd>
              <dt>Diagnóstico (F1)</dt><dd className="mono">{m?.random_forest.macro_f1}</dd>
            </dl>
          )}
          <p className="small muted" style={{ marginTop: 14 }}>Atajos: <kbd>/</kbd> buscar rig · <kbd>Esc</kbd> cerrar paneles.</p>
        </div>
      </div>
    </Modal>
  );
}

export default function Topbar({ onMenu }) {
  const { pathname } = useLocation();
  const { can } = useAuth();
  const { theme, toggle } = useTheme();
  const [info, setInfo] = useState(false);
  const [, title, subtitle] = TITLES.find(([p]) => pathname.startsWith(p)) || ['', 'PrediSys', ''];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        document.querySelector('.side-search input')?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="topbar">
      <button className="icon-btn menu-toggle" aria-label="Abrir menú" onClick={onMenu}><Menu size={18} /></button>
      <div className="title"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      <StatusPill />
      {can('reports.export') && <ExportMenu />}
      {can('alerts.read') && <BellMenu />}
      <button className="icon-btn" aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'} onClick={toggle}>
        {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
      </button>
      <button className="icon-btn" aria-label="Cómo funciona PrediSys" title="Información" onClick={() => setInfo(true)}><Info size={18} /></button>
      {info && <InfoModal onClose={() => setInfo(false)} />}
    </header>
  );
}
