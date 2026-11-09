import { useEffect, useMemo, useState } from 'react';
import { Lock, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { api } from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { ConfirmModal, Field, Loading, Modal, Notice, Tag } from '../../components/ui';
import { useToast } from '../../components/Toasts';

function PermissionGrid({ permissions, selected, onToggle, disabled }) {
  return (
    <div className="perm-grid">
      {permissions.map((p) => (
        <label className="check" key={p.id}>
          <input type="checkbox" checked={selected.includes(p.id)} disabled={disabled} onChange={() => onToggle(p.id)} />
          <span>{p.key}<small>{p.description}</small></span>
        </label>
      ))}
    </div>
  );
}

function UserPicker({ users, exclude = [], selected, onToggle }) {
  const available = users.filter((u) => !exclude.includes(u.id));
  if (!available.length) return <p className="muted">Todos los usuarios ya tienen este rol.</p>;
  return (
    <div style={{ display: 'grid', gap: 2, maxHeight: 300, overflow: 'auto' }}>
      {available.map((u) => (
        <label className="check" key={u.id}>
          <input type="checkbox" checked={selected.includes(u.id)} onChange={() => onToggle(u.id)} />
          <span>{u.username} <span className="faint small">{u.roles.map((r) => r.name).join(', ')}</span></span>
        </label>
      ))}
    </div>
  );
}

const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export default function RolesTab() {
  const toast = useToast();
  const roles = useApi('/admin/roles');
  const perms = useApi('/admin/permissions');
  const users = useApi('/admin/users');
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', permissionIds: [], userIds: [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const role = useMemo(() => roles.data?.roles.find((r) => r.id === selectedId) || roles.data?.roles[0], [roles.data, selectedId]);
  useEffect(() => { if (role) setDraft(role.permissions.map((p) => p.id)); }, [role]);
  const dirty = role && JSON.stringify([...draft].sort()) !== JSON.stringify(role.permissions.map((p) => p.id).sort());

  const refresh = () => { roles.reload({ silent: true }); users.reload({ silent: true }); };
  const run = async (fn, msg) => {
    setBusy(true);
    setError(null);
    try { await fn(); toast({ tone: 'success', title: msg }); setModal(null); refresh(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if ((roles.loading && !roles.data) || (perms.loading && !perms.data)) return <Loading />;
  if (roles.error) return <Notice tone="error">{roles.error.message}</Notice>;

  const createRole = () => run(async () => {
    const res = await api('/admin/roles', { method: 'POST', body: { name: form.name, description: form.description.trim() || undefined, permissionIds: form.permissionIds } });
    if (form.userIds.length) await api(`/admin/roles/${res.role.id}/users`, { method: 'POST', body: { userIds: form.userIds } });
    setSelectedId(res.role.id);
  }, `Rol ${form.name.toUpperCase()} creado`);

  return (
    <div className="split">
      <section className="section" style={{ alignSelf: 'start' }}>
        <header><h2>Roles</h2><button className="btn sm primary" onClick={() => { setForm({ name: '', description: '', permissionIds: [], userIds: [] }); setError(null); setModal('create'); }}><Plus size={14} />Nuevo rol</button></header>
        {roles.data.roles.map((r) => (
          <button key={r.id} className="list-btn" aria-current={role?.id === r.id} onClick={() => setSelectedId(r.id)}>
            <span>{r.name} {r.isSystem && <Lock size={12} className="faint" />}</span>
            <span className="faint small">{r.users.length} usuario(s)</span>
          </button>
        ))}
      </section>

      {role && (
        <div>
          <section className="section">
            <header>
              <div><h2>{role.name}</h2><p>{role.description || 'Sin descripción'}{role.isSystem ? ' · rol del sistema' : ''}</p></div>
              {!role.isSystem && <button className="btn sm danger" onClick={() => setModal('delete')}><Trash2 size={14} />Eliminar rol</button>}
            </header>
            {error && !modal && <Notice tone="error">{error}</Notice>}
            <h3 style={{ marginBottom: 8 }}>Permisos ({draft.length})</h3>
            {role.name === 'ADMIN' && <Notice tone="info">Los permisos del rol ADMIN están protegidos para no dejar la plataforma sin administración.</Notice>}
            <PermissionGrid permissions={perms.data?.permissions || []} selected={draft} disabled={role.name === 'ADMIN'} onToggle={(id) => setDraft((d) => toggle(d, id))} />
            {role.name !== 'ADMIN' && (
              <div className="btn-row" style={{ marginTop: 14 }}>
                <button className="btn primary" disabled={!dirty || busy} onClick={() => run(() => api(`/admin/roles/${role.id}/permissions`, { method: 'PUT', body: { permissionIds: draft } }), `Permisos de ${role.name} guardados`)}>Guardar permisos</button>
                {dirty && <button className="btn ghost" onClick={() => setDraft(role.permissions.map((p) => p.id))}>Descartar cambios</button>}
                <button className="btn ghost" onClick={() => setDraft([])}>Quitar todos</button>
              </div>
            )}
          </section>

          <section className="section">
            <header>
              <div><h2>Usuarios con este rol</h2><p>Quitar el rol no afecta los demás roles del usuario.</p></div>
              <button className="btn sm" onClick={() => { setForm((f) => ({ ...f, userIds: [] })); setError(null); setModal('assign'); }}><UserPlus size={14} />Asignar usuarios</button>
            </header>
            {role.users.length === 0 ? <p className="muted">Ningún usuario tiene este rol todavía.</p> : (
              <div className="btn-row">
                {role.users.map((u) => (
                  <Tag key={u.id}>{u.username}
                    <button className="btn ghost sm icon" style={{ height: 18, width: 18 }} aria-label={`Quitar ${role.name} a ${u.username}`} onClick={() => run(() => api(`/admin/roles/${role.id}/users/${u.id}`, { method: 'DELETE' }), `${role.name} retirado a ${u.username}`)}><X size={12} /></button>
                  </Tag>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {modal === 'create' && (
        <Modal wide title="Nuevo rol" onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn primary" disabled={busy || form.name.trim().length < 3} onClick={createRole}>{busy ? 'Creando…' : 'Crear rol'}</button></>}>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="grid2">
            <Field label="Nombre" htmlFor="r-name" hint="Se guarda en mayúsculas, ej. JEFE_DE_TURNO"><input id="r-name" className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={50} /></Field>
            <Field label="Descripción" htmlFor="r-desc"><input id="r-desc" className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={255} /></Field>
          </div>
          <h3 style={{ margin: '4px 0 8px' }}>Permisos</h3>
          <PermissionGrid permissions={perms.data?.permissions || []} selected={form.permissionIds} onToggle={(id) => setForm((f) => ({ ...f, permissionIds: toggle(f.permissionIds, id) }))} />
          <h3 style={{ margin: '16px 0 8px' }}>Asignar a usuarios (opcional)</h3>
          <UserPicker users={users.data?.users || []} selected={form.userIds} onToggle={(id) => setForm((f) => ({ ...f, userIds: toggle(f.userIds, id) }))} />
        </Modal>
      )}
      {modal === 'assign' && role && (
        <Modal title={`Asignar ${role.name}`} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn primary" disabled={busy || !form.userIds.length} onClick={() => run(() => api(`/admin/roles/${role.id}/users`, { method: 'POST', body: { userIds: form.userIds } }), `${role.name} asignado a ${form.userIds.length} usuario(s)`)}>Asignar rol</button></>}>
          {error && <Notice tone="error">{error}</Notice>}
          <UserPicker users={users.data?.users || []} exclude={role.users.map((u) => u.id)} selected={form.userIds} onToggle={(id) => setForm((f) => ({ ...f, userIds: toggle(f.userIds, id) }))} />
        </Modal>
      )}
      {modal === 'delete' && role && (
        <ConfirmModal title={`Eliminar ${role.name}`} confirmLabel="Eliminar rol" onClose={() => setModal(null)}
          message={`${role.users.length} usuario(s) perderán los permisos de este rol. Sus demás roles no cambian.`}
          onConfirm={async () => { await api(`/admin/roles/${role.id}`, { method: 'DELETE' }); toast({ tone: 'success', title: `Rol ${role.name} eliminado` }); setSelectedId(null); refresh(); }} />
      )}
    </div>
  );
}
