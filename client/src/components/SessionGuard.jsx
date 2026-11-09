import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { fmtCountdown } from '../utils/format';
import { Modal } from './ui';

const WARN_MS = 60000;

function useRemaining() {
  const { expiry } = useAuth();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ends = [expiry.tokenExpiresAt, expiry.idleExpiresAt].filter(Boolean).map((d) => new Date(d).getTime());
  return ends.length ? Math.min(...ends) - now : null;
}

/** Temporizador visible + aviso un minuto antes de que expire el token o la sesión por inactividad. */
export function SessionTimer() {
  const remaining = useRemaining();
  if (remaining == null) return null;
  return (
    <span className={`timer${remaining < WARN_MS * 2 ? ' low' : ''}`} title="Tiempo antes de que la sesión expire por inactividad">
      <Clock size={13} /> {fmtCountdown(remaining)}
    </span>
  );
}

export function SessionWarning() {
  const { extend, logout, endSession } = useAuth();
  const remaining = useRemaining();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (remaining != null && remaining <= 0) endSession('SESSION_EXPIRED');
  }, [remaining, endSession]);

  if (remaining == null || remaining > WARN_MS || remaining <= 0) return null;
  return (
    <Modal title="Tu sesión está por expirar" onClose={() => {}} footer={<>
      <button className="btn" onClick={() => logout()}>Cerrar sesión</button>
      <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { await extend(); } finally { setBusy(false); } }}>Seguir conectado</button>
    </>}>
      <p>Por inactividad, la sesión se cerrará en <strong>{fmtCountdown(remaining)}</strong>. Elige seguir conectado para renovarla.</p>
    </Modal>
  );
}
