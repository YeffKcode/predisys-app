import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import AuthShell from '../components/AuthShell';
import { Field, Notice, PasswordInput } from '../components/ui';
import { fmtCountdown } from '../utils/format';

const REASONS = {
  LOGOUT: ['ok', 'Cerraste sesión.'],
  LOGOUT_OTHER_TAB: ['info', 'Cerraste sesión en otra pestaña, así que esta también se cerró.'],
  TOKEN_EXPIRED: ['warn', 'Tu sesión expiró por inactividad. Inicia sesión de nuevo.'],
  SESSION_EXPIRED: ['warn', 'Tu sesión expiró por inactividad. Inicia sesión de nuevo.'],
  SESSION_REVOKED: ['warn', 'Tu sesión se cerró desde otro dispositivo o por un administrador.'],
  ACCOUNT_DISABLED: ['error', 'Tu cuenta fue desactivada. Contacta al administrador.'],
  AUTH_REQUIRED: ['info', 'Inicia sesión para ver esa página.'],
  TOKEN_INVALID: ['info', 'Inicia sesión para continuar.'],
};

// Evita redirecciones abiertas: solo rutas internas
const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard');

export default function Login() {
  const { status, login } = useAuth();
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!lockedUntil) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  if (status === 'authenticated') return <Navigate to={safeNext(params.get('next'))} replace />;
  const reason = REASONS[params.get('reason')];
  const lockLeft = lockedUntil ? new Date(lockedUntil).getTime() - now : 0;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
    } catch (err) {
      setPassword('');
      setError(err);
      if (err.code === 'ACCOUNT_LOCKED') setLockedUntil(err.details?.lockedUntil || null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h2>Iniciar sesión</h2>
      <p className="sub">Accede a la sala de control de tu flota.</p>
      {reason && !error && <Notice tone={reason[0]}>{reason[1]}</Notice>}
      {error && (
        <Notice tone={error.code === 'ACCOUNT_LOCKED' ? 'warn' : 'error'}>
          {error.message}
          {error.code === 'ACCOUNT_LOCKED' && lockLeft > 0 && <div style={{ marginTop: 4 }}>Podrás intentarlo de nuevo en <strong>{fmtCountdown(lockLeft)}</strong>.</div>}
        </Notice>
      )}
      <form onSubmit={submit} noValidate>
        <Field label="Usuario o correo" htmlFor="identifier" error={error?.code === 'VALIDATION_ERROR' ? error.message : null}>
          <input id="identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required maxLength={254} autoFocus aria-invalid={error?.code === 'VALIDATION_ERROR' ? 'true' : undefined} />
        </Field>
        <Field label="Contraseña" htmlFor="password">
          <PasswordInput id="password" value={password} onChange={setPassword} required maxLength={128} />
        </Field>
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center', height: 40 }} disabled={busy || !identifier || !password || lockLeft > 0}>
          {busy ? 'Verificando…' : 'Iniciar sesión'}
        </button>
      </form>
      <div className="alt">
        <Link to="/forgot-password">¿Olvidaste tu contraseña?</Link>
        <span>¿Sin cuenta? <Link to="/register">Crear una</Link></span>
      </div>
    </AuthShell>
  );
}
