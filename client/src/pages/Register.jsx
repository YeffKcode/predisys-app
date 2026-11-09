import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import AuthShell from '../components/AuthShell';
import { Field, Notice, PasswordChecklist, PasswordInput } from '../components/ui';

export default function Register() {
  const { status } = useAuth();
  const [f, setF] = useState({ username: '', fullName: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: typeof v === 'string' ? v : v.target.value }));

  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) { setErrors({ confirm: 'Las contraseñas no coinciden.' }); return; }
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await api('/auth/register', { method: 'POST', body: { username: f.username.trim(), email: f.email.trim(), password: f.password, ...(f.fullName.trim() ? { fullName: f.fullName.trim() } : {}) } });
      setDone(true);
    } catch (err) {
      const fe = err.fieldErrors();
      if (err.code === 'EMAIL_TAKEN') fe.email = err.message;
      if (err.code === 'USERNAME_TAKEN') fe.username = err.message;
      setErrors(fe);
      setError(err);
    } finally {
      setBusy(false);
      setF((s) => ({ ...s, password: '', confirm: '' }));
    }
  };

  if (done) {
    return (
      <AuthShell>
        <h2>Cuenta creada</h2>
        <p className="sub">Tu cuenta tiene el rol de operador (solo lectura). Un administrador puede ampliar tus permisos.</p>
        <Link className="btn primary" to="/login">Ir a iniciar sesión</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h2>Crear cuenta</h2>
      <p className="sub">Las cuentas nuevas empiezan con acceso de solo lectura.</p>
      {error && !Object.keys(errors).length && <Notice tone="error">{error.message}</Notice>}
      <form onSubmit={submit} noValidate>
        <div className="grid2">
          <Field label="Usuario" htmlFor="username" error={errors.username} hint="Letras, números, punto, guion y guion bajo">
            <input id="username" className="input" value={f.username} onChange={set('username')} autoComplete="username" maxLength={40} aria-invalid={errors.username ? 'true' : undefined} />
          </Field>
          <Field label="Nombre completo (opcional)" htmlFor="fullName" error={errors.fullName}>
            <input id="fullName" className="input" value={f.fullName} onChange={set('fullName')} autoComplete="name" maxLength={100} />
          </Field>
        </div>
        <Field label="Correo electrónico" htmlFor="email" error={errors.email}>
          <input id="email" type="email" className="input" value={f.email} onChange={set('email')} autoComplete="email" maxLength={254} aria-invalid={errors.email ? 'true' : undefined} />
        </Field>
        <Field label="Contraseña" htmlFor="password" error={errors.password}>
          <PasswordInput id="password" value={f.password} onChange={set('password')} autoComplete="new-password" maxLength={128} invalid={Boolean(errors.password)} />
        </Field>
        <PasswordChecklist password={f.password} username={f.username} email={f.email} />
        <Field label="Confirmar contraseña" htmlFor="confirm" error={errors.confirm}>
          <PasswordInput id="confirm" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" maxLength={128} invalid={Boolean(errors.confirm)} />
        </Field>
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center', height: 40 }} disabled={busy || !f.username || !f.email || !f.password}>
          {busy ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>
      <div className="alt"><span>¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link></span></div>
    </AuthShell>
  );
}
