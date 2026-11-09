import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { Field, Modal, Notice } from '../../components/ui';
import { COMPONENT_STATUS, COMPONENT_TYPE, MACHINE_STATUS } from '../../utils/format';

export function MachineFormModal({ machine, onClose, onSaved }) {
  const [f, setF] = useState({ code: machine?.code || '', name: machine?.name || '', location: machine?.location || '', status: machine?.status || 'ONLINE' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { ...f, location: f.location.trim() || undefined };
      const res = machine
        ? await api(`/machines/${machine.id}`, { method: 'PATCH', body })
        : await api('/machines', { method: 'POST', body });
      onSaved(res.machine, machine ? 'Máquina actualizada' : `${res.machine.code} agregada a la flota`);
    } catch (err) {
      setErrors(err.fieldErrors());
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={machine ? `Editar ${machine.code}` : 'Agregar máquina'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !f.code || !f.name} onClick={save}>{busy ? 'Guardando…' : machine ? 'Guardar cambios' : 'Agregar máquina'}</button>
    </>}>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid2">
        <Field label="Código" htmlFor="m-code" error={errors.code} hint="Formato Rig-11">
          <input id="m-code" className="input" value={f.code} onChange={set('code')} placeholder="Rig-11" maxLength={7} />
        </Field>
        <Field label="Estado" htmlFor="m-status">
          <select id="m-status" className="input" value={f.status} onChange={set('status')}>
            {Object.entries(MACHINE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Nombre" htmlFor="m-name" error={errors.name}>
        <input id="m-name" className="input" value={f.name} onChange={set('name')} maxLength={80} />
      </Field>
      <Field label="Ubicación" htmlFor="m-loc" error={errors.location} hint="Empieza con «Rack N» para agruparla en el muro de racks">
        <input id="m-loc" className="input" value={f.location} onChange={set('location')} placeholder="Rack 3 - Bahía 2" maxLength={120} />
      </Field>
    </Modal>
  );
}

export function ComponentFormModal({ machineId, component, onClose, onSaved }) {
  const [f, setF] = useState({
    type: component?.type || 'GPU', model: component?.model || '', serialNumber: component?.serialNumber || '', status: component?.status || 'ACTIVE',
    specs: Object.entries(component?.specs || {}).map(([k, v]) => ({ k, v: String(v) })),
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setSpec = (i, key, val) => setF((s) => ({ ...s, specs: s.specs.map((row, j) => (j === i ? { ...row, [key]: val } : row)) }));

  const save = async () => {
    setBusy(true);
    setError(null);
    const specs = Object.fromEntries(f.specs.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v.trim() !== '' && !Number.isNaN(Number(r.v)) ? Number(r.v) : r.v.trim()]));
    const body = { type: f.type, model: f.model.trim(), status: f.status, specs, ...(f.serialNumber.trim() ? { serialNumber: f.serialNumber.trim() } : {}) };
    try {
      const res = component
        ? await api(`/components/${component.id}`, { method: 'PATCH', body })
        : await api(`/machines/${machineId}/components`, { method: 'POST', body });
      onSaved(res.component, component ? 'Componente actualizado' : 'Componente agregado');
    } catch (err) {
      setErrors(err.fieldErrors());
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={component ? 'Editar componente' : 'Agregar componente'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !f.model.trim()} onClick={save}>{busy ? 'Guardando…' : component ? 'Guardar cambios' : 'Agregar componente'}</button>
    </>}>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid2">
        <Field label="Tipo" htmlFor="c-type">
          <select id="c-type" className="input" value={f.type} onChange={set('type')}>
            {Object.entries(COMPONENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Estado" htmlFor="c-status">
          <select id="c-status" className="input" value={f.status} onChange={set('status')}>
            {Object.entries(COMPONENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Modelo" htmlFor="c-model" error={errors.model}>
        <input id="c-model" className="input" value={f.model} onChange={set('model')} placeholder="NVIDIA RTX 3080" maxLength={100} />
      </Field>
      <Field label="Número de serie" htmlFor="c-serial" error={errors.serialNumber}>
        <input id="c-serial" className="input" value={f.serialNumber} onChange={set('serialNumber')} maxLength={60} />
      </Field>
      <div className="field">
        <label>Especificaciones</label>
        {f.specs.map((row, i) => (
          <div key={i} className="btn-row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" aria-label="Nombre" placeholder="vramGb" value={row.k} onChange={(e) => setSpec(i, 'k', e.target.value)} maxLength={40} />
            <input className="input" aria-label="Valor" placeholder="10" value={row.v} onChange={(e) => setSpec(i, 'v', e.target.value)} maxLength={100} />
            <button type="button" className="btn ghost icon" aria-label="Quitar especificación" onClick={() => setF((s) => ({ ...s, specs: s.specs.filter((_, j) => j !== i) }))}><Trash2 size={15} /></button>
          </div>
        ))}
        {errors.specs && <span className="err">{errors.specs}</span>}
        <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setF((s) => ({ ...s, specs: [...s.specs, { k: '', v: '' }] }))} disabled={f.specs.length >= 20}><Plus size={14} />Agregar especificación</button>
      </div>
    </Modal>
  );
}
