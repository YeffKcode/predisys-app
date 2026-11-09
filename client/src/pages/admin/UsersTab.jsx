import { useState } from 'react';
import { KeyRound, LogOut, Plus, ShieldCheck, Unlock, UserCheck, UserX } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../hooks/useApi';
import { ConfirmModal, Field, Loading, Modal, Notice, PasswordChecklist, PasswordInput, Tag } from '../../components/ui';
import { useToast } from '../../components/Toasts';
import { fmtDate, fmtRelative } from '../../utils/format';

function RolePicker({ roles, selected, onToggle }) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      {roles.map((r) => (
        <label className="check" key={r.id}>
          <input type="checkbox" checked={selected.includes(r.id)} onChange={() => onToggle(r.id)} />
          <span><strong>{r.name}</strong><span className="faint small" style={{ display: 'block' }}>{r.permissions.map((p) => p.key).join(', ') || 'sin permisos'}</span></span>
        </label>
      ))}
    </div>
  );
}

function CreateUserModal({ roles, onClose, onSaved }) {
  const [f, setF] = useState({ username: '', fullName: '', email: '', password: '', roleIds: [] });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: typeof v === 'string' ? v : v.target.value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/users', { method: 'POST', body: { username: f.username.trim(), email: f.email.trim(), password: f.password, roleIds: f.roleIds, ...(f.fullName.trim() ? { fullName: f.fullName.trim() } : {}) } });
      onSaved(`Usuario ${f.username} creado`);
    } catch (err) {
      const fe = err.fieldErrors();
      if (err.code === 'EMAIL_TAKEN') fe.email = err.message;
      if (err.code === 'USERNAME_TAKEN') fe.username = err.message;
      setErrors(fe);
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal wide title="Crear usuario" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f.username || !f.email || !f.password} onClick={save}>{busy ? 'Creando…' : 'Crear usuario'}</button></>}>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid2">
        <div>
          <Field label="Usuario" htmlFor="nu-user" error={errors.username}><input id="nu-user" className="input" value={f.username} onChange={set('username')} maxLength={40} autoComplete="off" /></Field>
          <Field label="Nombre completo" htmlFor="nu-name" error={errors.fullName}><input id="nu-name" className="input" value={f.fullName} onChange={set('fullName')} maxLength={100} /></Field>
          <Field label="Correo" htmlFor="nu-email" error={errors.email}><input id="nu-email" type="email" className="input" value={f.email} onChange={set('email')} maxLength={254} autoComplete="off" /></Field>
          <Field label="Contraseña inicial" htmlFor="nu-pw" error={errors.password}><PasswordInput id="nu-pw" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
          <PasswordChecklist password={f.password} username={f.username} email={f.email} />
        </div>
        <div className="field"><label>Roles</label><RolePicker roles={roles} selected={f.roleIds} onToggle={(id) => setF((s) => ({ ...s, roleIds: s.roleIds.includes(id) ? s.roleIds.filter((x) => x !== id) : [...s.roleIds, id] }))} /><span className="hint">Sin selección se asigna OPERATOR.</span></div>
      </div>
    </Modal>
  );
}

function RolesModal({ user, roles, onClose, onSaved }) {
  const [selected, setSelected] = useState(user.roles.map((r) => r.id));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/admin/users/${user.id}/roles`, { method: 'PUT', body: { roleIds: selected } });
      onSaved(`Roles de ${user.username} actualizados`);
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={`Roles de ${user.username}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>Guardar roles</button></>}>
      {error && <Notice tone="error">{error}</Notice>}
      <p className="muted" style={{ marginBottom: 12 }}>Un usuario puede tener varios roles; sus permisos se suman.</p>
      <RolePicker roles={roles} selected={selected} onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
    </Modal>
  );
}

function PasswordModal({ user, onClose, onSaved }) {
  const [pw, setPw] = useState('');
  const [errors, setErrors] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Se envía aunque la lista local marque fallas: la política la aplica el servidor y el intento queda auditado
  const save = async () => {
    setBusy(true);
    setError(null);
    setErrors([]);
    try {
      const res = await api(`/admin/users/${user.id}/password`, { method: 'PUT', body: { newPassword: pw } });
      onSaved(res.message);
    } catch (err) {
      setError(err.message);
      setErrors(Array.isArray(err.details) ? err.details.map((d) => d.message) : []);
      setBusy(false);
    } finally {
      setPw('');
    }
  };
  return (
    <Modal title={`Cambiar contraseña de ${user.username}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !pw} onClick={save}>Cambiar contraseña</button></>}>
      <Notice tone="warn">La política de seguridad también aplica a los administradores. Al cambiarla se cerrarán todas las sesiones de {user.username}.</Notice>
      {error && <Notice tone="error">{error}{errors.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}</Notice>}
      <Field label="Nueva contraseña" htmlFor="ap-pw"><PasswordInput id="ap-pw" value={pw} onChange={setPw} autoComplete="new-password" /></Field>
      <PasswordChecklist password={pw} username={user.username} email={user.email} />
    </Modal>
  );
}

export default function UsersTab() {
  const { user: me, can } = useAuth();
  const toast = useToast();
  const users = useApi('/admin/users');
  const roles = useApi('/admin/roles', { enabled: can('roles.manage') });
  const [modal, setModal] = useState(null);

  const done = (msg) => { setModal(null); toast({ tone: 'success', title: msg }); users.reload({ silent: true }); };
  const act = async (path, method, msg) => {
    try { const res = await api(path, { method }); done(res?.message || msg); } catch (err) { toast({ tone: 'error', title: 'No se pudo completar', message: err.message }); }
  };

  if (users.loading && !users.data) return <Loading />;
  if (users.error) return <Notice tone="error">{users.error.message}</Notice>;
  const roleList = roles.data?.roles || [];

  return (
    <section className="section">
      <header>
        <div><h2>Usuarios</h2><p>{users.data.users.length} cuentas. El correo se guarda cifrado y solo se descifra para mostrarlo aquí.</p></div>
        {can('users.write') && <button className="btn primary" onClick={() => setModal({ type: 'create' })}><Plus size={15} />Crear usuario</button>}
      </header>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Usuario</th><th>Correo</th><th>Roles</th><th>Estado</th><th>Sesiones</th><th>Último acceso</th><th aria-label="Acciones" /></tr></thead>
          <tbody>
            {users.data.users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.username}</strong>{u.fullName && <div className="faint small">{u.fullName}</div>}</td>
                <td>{u.email}</td>
                <td><div className="btn-row" style={{ gap: 4 }}>{u.roles.map((r) => <Tag key={r.id}>{r.name}</Tag>)}</div></td>
                <td>
                  {!u.isActive ? <Tag tone="muted">Desactivado</Tag> : u.isLocked ? <Tag tone="hot" title={`Hasta ${fmtDate(u.lockedUntil)}`}>Bloqueado</Tag> : <Tag tone="ok">Activo</Tag>}
                  {u.failedLoginAttempts > 0 && !u.isLocked && <div className="faint small">{u.failedLoginAttempts} intento(s) fallido(s)</div>}
                </td>
                <td>{u.activeSessions}</td>
                <td className="muted">{u.lastLoginAt ? fmtRelative(u.lastLoginAt) : 'Nunca'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {can('roles.manage') && <button className="btn ghost sm icon" title="Roles" aria-label={`Roles de ${u.username}`} onClick={() => setModal({ type: 'roles', user: u })}><ShieldCheck size={15} /></button>}
                  {can('users.write') && <>
                    <button className="btn ghost sm icon" title="Cambiar contraseña" aria-label={`Cambiar contraseña de ${u.username}`} onClick={() => setModal({ type: 'password', user: u })}><KeyRound size={15} /></button>
                    {u.isLocked && <button className="btn ghost sm icon" title="Desbloquear" aria-label={`Desbloquear ${u.username}`} onClick={() => act(`/admin/users/${u.id}/unlock`, 'POST')}><Unlock size={15} /></button>}
                    {u.activeSessions > 0 && <button className="btn ghost sm icon" title="Cerrar sus sesiones" aria-label={`Cerrar sesiones de ${u.username}`} onClick={() => setModal({ type: 'sessions', user: u })}><LogOut size={15} /></button>}
                    {u.id !== me.id && (u.isActive
                      ? <button className="btn ghost sm icon" title="Desactivar" aria-label={`Desactivar ${u.username}`} onClick={() => setModal({ type: 'disable', user: u })}><UserX size={15} /></button>
                      : <button className="btn ghost sm icon" title="Activar" aria-label={`Activar ${u.username}`} onClick={async () => { await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { isActive: true } }); done(`${u.username} activado`); }}><UserCheck size={15} /></button>)}
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === 'create' && <CreateUserModal roles={roleList} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.type === 'roles' && <RolesModal user={modal.user} roles={roleList} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.type === 'password' && <PasswordModal user={modal.user} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.type === 'sessions' && <ConfirmModal title="Cerrar sesiones" confirmLabel="Cerrar sus sesiones" onClose={() => setModal(null)} message={`Se cerrarán las ${modal.user.activeSessions} sesiones activas de ${modal.user.username} en todos sus dispositivos.`} onConfirm={async () => { const r = await api(`/admin/users/${modal.user.id}/sessions`, { method: 'DELETE' }); done(r.message); }} />}
      {modal?.type === 'disable' && <ConfirmModal title={`Desactivar a ${modal.user.username}`} confirmLabel="Desactivar usuario" onClose={() => setModal(null)} message="No podrá iniciar sesión y sus sesiones abiertas se cerrarán de inmediato. Puedes reactivarlo después." onConfirm={async () => { await api(`/admin/users/${modal.user.id}`, { method: 'PATCH', body: { isActive: false } }); done(`${modal.user.username} desactivado`); }} />}
    </section>
  );
}
