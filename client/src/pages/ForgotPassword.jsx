import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import AuthShell from '../components/AuthShell';
import { Field, Notice, PasswordChecklist, PasswordInput } from '../components/ui';

export default function ForgotPassword() {
  const [step, setStep] = useState('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const request = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim() } });
      setInfo(res.message);
      setStep('reset');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const reset = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { email: email.trim(), code: code.trim(), newPassword: password } });
      setStep('done');
    } catch (err) {
      const details = Array.isArray(err.details) ? err.details.map((d) => d.message).join(' ') : '';
      setError(`${err.message} ${details}`.trim());
    } finally {
      setBusy(false);
      setPassword('');
      setConfirm('');
    }
  };

  return (
    <AuthShell>
      {step === 'request' && (
        <>
          <h2>Recuperar contraseña</h2>
          <p className="sub">Te enviaremos un código de 6 dígitos al correo de tu cuenta. Vence en 15 minutos.</p>
          {error && <Notice tone="error">{error}</Notice>}
          <form onSubmit={request} noValidate>
            <Field label="Correo electrónico" htmlFor="email">
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
            </Field>
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center', height: 40 }} disabled={busy || !email}>{busy ? 'Enviando…' : 'Enviar código'}</button>
          </form>
        </>
      )}
      {step === 'reset' && (
        <>
          <h2>Ingresa el código</h2>
          <p className="sub">{info}</p>
          {error && <Notice tone="error">{error}</Notice>}
          <form onSubmit={reset} noValidate>
            <Field label="Código de recuperación" htmlFor="code" hint="Revisa también la carpeta de spam">
              <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus />
            </Field>
            <Field label="Nueva contraseña" htmlFor="password">
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" />
            </Field>
            <PasswordChecklist password={password} email={email} />
            <Field label="Confirmar contraseña" htmlFor="confirm">
              <PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            </Field>
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center', height: 40 }} disabled={busy || code.length !== 6 || !password}>{busy ? 'Guardando…' : 'Cambiar contraseña'}</button>
          </form>
          <div className="alt"><button className="btn ghost sm" onClick={() => { setStep('request'); setCode(''); setError(null); }}>Solicitar otro código</button></div>
        </>
      )}
      {step === 'done' && (
        <>
          <h2>Contraseña cambiada</h2>
          <p className="sub">Por seguridad cerramos todas tus sesiones abiertas. Inicia sesión con la nueva contraseña.</p>
          <Link className="btn primary" to="/login">Ir a iniciar sesión</Link>
        </>
      )}
      {step !== 'done' && <div className="alt"><Link to="/login">Volver a iniciar sesión</Link></div>}
    </AuthShell>
  );
}
