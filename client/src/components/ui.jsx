import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Eye, EyeOff, Info, X, XCircle } from 'lucide-react';
import { passwordRules } from '../utils/passwordPolicy';

export function Modal({ title, onClose, children, footer, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button:not([data-close])')?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header><h2>{title}</h2><button data-close className="btn ghost icon sm" aria-label="Cerrar" onClick={onClose}><X size={16} /></button></header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ onClose, header, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <header>{header}</header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function Notice({ tone = 'info', children }) {
  const Icon = { error: XCircle, warn: AlertTriangle, ok: CheckCircle2, info: Info }[tone] || Info;
  return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}><Icon size={16} /><div>{children}</div></div>;
}

export function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="err" id={`${htmlFor}-err`}>{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/**
 * Contraseña enmascarada con protección de portapapeles: bloquea copiar, cortar, arrastrar
 * y el menú contextual. Mostrarla es temporal (5 s) y aun visible no se puede copiar.
 */
export function PasswordInput({ id, value, onChange, autoComplete = 'current-password', invalid, ...rest }) {
  const [visible, setVisible] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!visible) return undefined;
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, [visible]);
  const block = (e) => {
    e.preventDefault();
    setBlocked(true);
    setTimeout(() => setBlocked(false), 2500);
  };
  return (
    <>
      <div className="pw">
        <input
          id={id} className="input" type={visible ? 'text' : 'password'} value={value}
          onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete}
          spellCheck={false} autoCapitalize="off" autoCorrect="off"
          onCopy={block} onCut={block} onDragStart={block} onContextMenu={block}
          aria-invalid={invalid ? 'true' : undefined} aria-describedby={invalid ? `${id}-err` : undefined}
          {...rest}
        />
        <button type="button" className="btn ghost icon" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña por 5 segundos'} aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {blocked && <span className="hint" role="status">Por seguridad, la contraseña no se puede copiar ni cortar.</span>}
    </>
  );
}

export function PasswordChecklist({ password, username, email }) {
  const rules = passwordRules(password, { username, email });
  return (
    <ul className="policy" aria-label="Requisitos de la contraseña">
      {rules.map((r) => (
        <li key={r.label} className={password ? (r.ok ? 'ok' : 'bad') : ''}>
          {password && r.ok ? <CheckCircle2 size={13} /> : password ? <XCircle size={13} /> : <Circle size={13} />}{r.label}
        </li>
      ))}
    </ul>
  );
}

export function Tag({ tone = '', children, title }) {
  return <span className={`tag ${tone}`} title={title}>{children}</span>;
}

export function ConfirmModal({ title, message, confirmLabel, danger = true, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try { await onConfirm(); onClose(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={run}>{busy ? 'Procesando…' : confirmLabel}</button>
    </>}>
      {error && <Notice tone="error">{error}</Notice>}
      <p>{message}</p>
    </Modal>
  );
}

export function Pager({ page, totalPages, total, onPage }) {
  if (!totalPages || totalPages <= 1) return <div className="pager"><span>{total ?? 0} registros</span></div>;
  return (
    <div className="pager">
      <span>{total} registros · página {page} de {totalPages}</span>
      <div className="btn-row">
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
        <button className="btn sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Siguiente</button>
      </div>
    </div>
  );
}

export const Loading = () => <div className="center-load"><span className="spinner" aria-label="Cargando" /></div>;
