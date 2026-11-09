import { useEffect, useState } from 'react';
import { BellRing, LogOut, Mail, MessageSquare, Monitor, Smartphone, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../hooks/useApi';
import { Field, Loading, Notice, PasswordChecklist, PasswordInput, Tag } from '../components/ui';
import { useToast } from '../components/Toasts';
import { fmtDate, fmtRelative } from '../utils/format';

function Credentials() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: '', newEmail: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: typeof v === 'string' ? v : v.target.value }));

  const save = async (e) => {
    e.preventDefault();
    if (f.newPassword && f.newPassword !== f.confirm) { setErrors({ confirm: 'Las contraseñas no coinciden.' }); return; }
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const body = { currentPassword: f.currentPassword };
      if (f.newEmail.trim() && f.newEmail.trim() !== user.email) body.newEmail = f.newEmail.trim();
      if (f.newPassword) body.newPassword = f.newPassword;
      const res = await api('/profile/credentials', { method: 'PATCH', body });
      toast({ tone: 'success', title: 'Credenciales actualizadas', message: res.changes.includes('password') ? 'Cerramos tus otras sesiones por seguridad.' : undefined });
      setF({ currentPassword: '', newEmail: '', newPassword: '', confirm: '' });
      refreshUser();
    } catch (err) {
      const fe = err.fieldErrors();
      if (err.code === 'INVALID_CURRENT_PASSWORD') fe.currentPassword = err.message;
      if (err.code === 'EMAIL_TAKEN') fe.newEmail = err.message;
      if (fe.password) fe.newPassword = fe.password;
      setErrors(fe);
      setError(err.message);
    } finally {
      setBusy(false);
      setF((s) => ({ ...s, currentPassword: '', newPassword: '', confirm: '' }));
    }
  };

  return (
    <section className="section">
      <header><div><h2>Correo y contraseña</h2><p>Confirma con tu contraseña actual para guardar cualquier cambio.</p></div></header>
      {error && !Object.keys(errors).length && <Notice tone="error">{error}</Notice>}
      <form onSubmit={save} noValidate>
        <div className="grid2">
          <Field label="Nuevo correo" htmlFor="p-email" error={errors.newEmail} hint={`Actual: ${user.email}`}>
            <input id="p-email" type="email" className="input" value={f.newEmail} onChange={set('newEmail')} autoComplete="email" maxLength={254} />
          </Field>
          <div />
          <div>
            <Field label="Nueva contraseña" htmlFor="p-new" error={errors.newPassword}>
              <PasswordInput id="p-new" value={f.newPassword} onChange={set('newPassword')} autoComplete="new-password" invalid={Boolean(errors.newPassword)} />
            </Field>
            {f.newPassword && <PasswordChecklist password={f.newPassword} username={user.username} email={f.newEmail || user.email} />}
          </div>
          <Field label="Confirmar nueva contraseña" htmlFor="p-confirm" error={errors.confirm}>
            <PasswordInput id="p-confirm" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" invalid={Boolean(errors.confirm)} />
          </Field>
        </div>
        <Field label="Contraseña actual" htmlFor="p-current" error={errors.currentPassword}>
          <PasswordInput id="p-current" value={f.currentPassword} onChange={set('currentPassword')} invalid={Boolean(errors.currentPassword)} style={{ maxWidth: 360 }} />
        </Field>
        <button className="btn primary" disabled={busy || !f.currentPassword || (!f.newEmail.trim() && !f.newPassword)}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
      </form>
    </section>
  );
}

function Sessions() {
  const { logout } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useApi('/auth/sessions');
  const revoke = async (s) => {
    await api(`/auth/sessions/${s.id}`, { method: 'DELETE' });
    if (s.current) { logout(); return; }
    toast({ tone: 'success', title: 'Sesión cerrada en ese dispositivo' });
    reload({ silent: true });
  };
  return (
    <section className="section">
      <header>
        <div><h2>Sesiones activas</h2><p>Cada inicio de sesión es independiente. Cierra las que no reconozcas.</p></div>
        <button className="btn sm danger" onClick={() => logout({ everywhere: true })}><LogOut size={14} />Cerrar todas</button>
      </header>
      {loading && !data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Dispositivo</th><th>IP</th><th>Inicio</th><th>Última actividad</th><th aria-label="Acciones" /></tr></thead>
            <tbody>
              {data?.sessions.map((s) => (
                <tr key={s.id}>
                  <td><Monitor size={13} /> {(s.userAgent || 'Desconocido').slice(0, 70)} {s.current && <Tag tone="ok">esta sesión</Tag>}</td>
                  <td className="code">{s.ip || '—'}</td>
                  <td className="muted">{fmtDate(s.createdAt)}</td>
                  <td className="muted">{fmtRelative(s.lastActivityAt)}</td>
                  <td><button className="btn ghost sm" onClick={() => revoke(s)}>Cerrar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Notifications() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, reload } = useApi('/profile/notifications');
  const [prefs, setPrefs] = useState(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [browserPerm, setBrowserPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  useEffect(() => { if (data) { setPrefs(data.preferences); if (data.preferences.phoneVerificationPending) setStep('code'); } }, [data]);
  if (loading || !prefs) return <section className="section"><Loading /></section>;

  const run = async (key, fn) => {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(null); }
  };
  const update = (patch) => run('save', async () => {
    const res = await api('/profile/notifications', { method: 'PUT', body: patch });
    setPrefs(res.preferences);
    toast({ tone: 'success', title: 'Preferencias de aviso guardadas' });
  });
  const quiet = prefs.quietHoursStart != null;

  return (
    <section className="section">
      <header><div><h2>Avisos de alertas</h2><p>Además de la app, PrediSys puede avisarte por correo y por SMS cuando una máquina esté en riesgo.</p></div></header>
      {error && <Notice tone="error">{error}</Notice>}
      {/@([^@]+\.)?(local|localhost|test|example|invalid)$/i.test(user.email || '') && <Notice tone="warn">Tu correo ({user.email}) usa un dominio que no existe, así que nunca recibirás alertas por correo. Cámbialo en «Correo y contraseña».</Notice>}

      <Field label="Avisarme desde" htmlFor="n-sev" hint="Las alertas críticas sin reconocer se escalan a los responsables a los 15 minutos.">
        <select id="n-sev" className="input" style={{ maxWidth: 360 }} value={prefs.minSeverity} onChange={(e) => update({ minSeverity: e.target.value })}>
          <option value="WARNING">Advertencias y críticas (40 % o más)</option>
          <option value="CRITICAL">Solo críticas (70 % o más)</option>
        </select>
      </Field>

      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <tbody>
            <tr>
              <td style={{ width: 40 }}><Mail size={18} /></td>
              <td><strong>Correo electrónico</strong><div className="muted small">Mensaje con el diagnóstico, las variables y un enlace para reconocer la alerta.</div></td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <label className="check" style={{ display: 'inline-flex' }}><input type="checkbox" checked={prefs.emailEnabled} onChange={(e) => update({ emailEnabled: e.target.checked })} />Activado</label>
                <button className="btn ghost sm" disabled={busy || !prefs.emailEnabled} onClick={() => run('test-email', async () => { const r = await api('/profile/notifications/test', { method: 'POST', body: { channel: 'EMAIL' } }); toast({ tone: 'success', title: r.message }); })}>Enviar prueba</button>
              </td>
            </tr>
            <tr>
              <td><MessageSquare size={18} /></td>
              <td>
                <strong>SMS</strong>
                <div className="muted small">{prefs.phoneVerified ? `Número verificado ${prefs.phone}` : 'Verifica tu celular para recibir alertas por mensaje de texto.'}</div>
              </td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                {prefs.phoneVerified ? <>
                  <label className="check" style={{ display: 'inline-flex' }}><input type="checkbox" checked={prefs.smsEnabled} onChange={(e) => update({ smsEnabled: e.target.checked })} />Activado</label>
                  <button className="btn ghost sm" disabled={busy || !prefs.smsEnabled} onClick={() => run('test-sms', async () => { const r = await api('/profile/notifications/test', { method: 'POST', body: { channel: 'SMS' } }); toast({ tone: 'success', title: r.message }); })}>Enviar prueba</button>
                  <button className="btn ghost sm icon" aria-label="Quitar número" disabled={busy} onClick={() => run('rm', async () => { const r = await api('/profile/notifications/phone', { method: 'DELETE' }); setPrefs(r.preferences); })}><Trash2 size={14} /></button>
                </> : !step && <button className="btn sm" onClick={() => setStep('phone')}><Smartphone size={14} />Agregar celular</button>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {step === 'phone' && (
        <div className="btn-row" style={{ alignItems: 'flex-end', marginBottom: 16 }}>
          <Field label="Celular en formato internacional" htmlFor="n-phone" hint="Ej.: +57 300 123 4567">
            <input id="n-phone" className="input" style={{ width: 240 }} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
          </Field>
          <div className="field btn-row">
            <button className="btn primary" disabled={busy || phone.replace(/\D/g, '').length < 8} onClick={() => run('send', async () => { const r = await api('/profile/notifications/phone', { method: 'POST', body: { phone } }); toast({ tone: r.simulated ? 'warning' : 'info', title: r.simulated ? 'SMS no enviado (modo desarrollo)' : r.message, message: r.simulated ? r.message : undefined, duration: r.simulated ? 12000 : undefined }); setStep('code'); })}>Enviar código</button>
            <button className="btn ghost" onClick={() => setStep(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {step === 'code' && (
        <div className="btn-row" style={{ alignItems: 'flex-end', marginBottom: 16 }}>
          <Field label="Código recibido por SMS" htmlFor="n-code" hint="Vence en 10 minutos">
            <input id="n-code" className="input" style={{ width: 160 }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" />
          </Field>
          <div className="field btn-row">
            <button className="btn primary" disabled={busy || code.length !== 6} onClick={() => run('verify', async () => { const r = await api('/profile/notifications/phone/verify', { method: 'POST', body: { code } }); setPrefs(r.preferences); setStep(null); setCode(''); toast({ tone: 'success', title: r.message }); })}>Verificar número</button>
            <button className="btn ghost" onClick={() => setStep('phone')}>Cambiar número</button>
          </div>
        </div>
      )}

      <div className="check" style={{ marginBottom: 6 }}>
        <input id="n-quiet" type="checkbox" checked={quiet} onChange={(e) => update(e.target.checked ? { quietHoursStart: 22, quietHoursEnd: 6 } : { quietHoursStart: null, quietHoursEnd: null })} />
        <label htmlFor="n-quiet">Horario silencioso para SMS de advertencia <span className="faint small">(las críticas siempre llegan)</span></label>
      </div>
      {quiet && (
        <div className="btn-row" style={{ marginLeft: 24, marginBottom: 14 }}>
          <label className="muted small">De <select className="input" style={{ width: 90, display: 'inline-block' }} value={prefs.quietHoursStart} onChange={(e) => update({ quietHoursStart: Number(e.target.value), quietHoursEnd: prefs.quietHoursEnd })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
          <label className="muted small">a <select className="input" style={{ width: 90, display: 'inline-block' }} value={prefs.quietHoursEnd} onChange={(e) => update({ quietHoursStart: prefs.quietHoursStart, quietHoursEnd: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
        </div>
      )}

      <div className="check" style={{ marginTop: 10 }}>
        <BellRing size={16} style={{ marginTop: 2 }} />
        <div>
          <strong>Notificaciones del navegador</strong>
          <div className="muted small">
            {browserPerm === 'granted' && 'Activadas: verás un aviso del sistema aunque esta pestaña esté en segundo plano.'}
            {browserPerm === 'denied' && 'Bloqueadas en este navegador. Puedes habilitarlas desde la configuración del sitio.'}
            {browserPerm === 'unsupported' && 'Este navegador no las admite.'}
            {browserPerm === 'default' && <button className="btn sm" style={{ marginTop: 6 }} onClick={async () => setBrowserPerm(await Notification.requestPermission())}>Activar en este navegador</button>}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Profile() {
  const { user, can } = useAuth();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{user.fullName || user.username}</h1>
          <p>{user.username} · {user.email} · {user.roles.map((r) => r.name).join(', ') || 'sin roles'}</p>
        </div>
      </div>
      <Credentials />
      {can('alerts.read') && <Notifications />}
      <Sessions />
    </>
  );
}
