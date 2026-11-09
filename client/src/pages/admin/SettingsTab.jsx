import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { Field, Loading, Notice } from '../../components/ui';
import { useToast } from '../../components/Toasts';

export default function SettingsTab() {
  const toast = useToast();
  const { data, error, loading } = useApi('/admin/settings');
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (data) setF(data.settings); }, [data]);
  if (loading || !f) return error ? <Notice tone="error">{error.message}</Notice> : <Loading />;

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value === '' ? '' : Number(e.target.value) }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await api('/admin/settings', { method: 'PUT', body: f });
      setF(res.settings);
      toast({ tone: 'success', title: 'Configuración de sesión guardada', message: res.message });
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <section className="section" style={{ maxWidth: 720 }}>
      <header><div><h2>Expiración de sesiones</h2><p>Los cambios aplican desde la siguiente petición de cada sesión abierta, sin reiniciar el servidor.</p></div></header>
      {err && <Notice tone="error">{err}</Notice>}
      <form onSubmit={save}>
        <Field label="Expiración del token por inactividad (minutos)" htmlFor="s-token" hint="El token se renueva con cada acción. Si pasa este tiempo sin actividad, vence. Entre 1 y 1440.">
          <input id="s-token" type="number" min={1} max={1440} className="input" style={{ maxWidth: 160 }} value={f.tokenTtlMinutes} onChange={set('tokenTtlMinutes')} />
        </Field>
        <Field label="Cierre de sesión por inactividad (minutos)" htmlFor="s-idle" hint="El servidor cierra la sesión si no recibe actividad en este tiempo. Entre 1 y 1440.">
          <input id="s-idle" type="number" min={1} max={1440} className="input" style={{ maxWidth: 160 }} value={f.sessionIdleMinutes} onChange={set('sessionIdleMinutes')} />
        </Field>
        <Field label="Sesiones simultáneas por usuario" htmlFor="s-max" hint="Al superarlo se cierra la sesión más antigua. Entre 1 y 20.">
          <input id="s-max" type="number" min={1} max={20} className="input" style={{ maxWidth: 160 }} value={f.maxConcurrentSessions} onChange={set('maxConcurrentSessions')} />
        </Field>
        {f.tokenTtlMinutes > f.sessionIdleMinutes && <Notice tone="warn">El token dura más que la sesión: la sesión de servidor vencerá primero.</Notice>}
        <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar configuración'}</button>
      </form>
    </section>
  );
}
