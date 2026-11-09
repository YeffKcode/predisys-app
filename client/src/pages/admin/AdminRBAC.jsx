import { useSearchParams } from 'react-router-dom';
import { Bug, ScrollText, ShieldCheck, Timer, Users } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import UsersTab from './UsersTab';
import RolesTab from './RolesTab';
import AuditTab from './AuditTab';
import SettingsTab from './SettingsTab';
import SystemTab from './SystemTab';

const TABS = [
  { key: 'users', label: 'Usuarios', icon: Users, perm: 'users.read', C: UsersTab },
  { key: 'roles', label: 'Roles y permisos', icon: ShieldCheck, perm: 'roles.manage', C: RolesTab },
  { key: 'audit', label: 'Auditoría', icon: ScrollText, perm: 'audit.read', C: AuditTab },
  { key: 'sessions', label: 'Sesiones', icon: Timer, perm: 'settings.manage', C: SettingsTab },
  { key: 'system', label: 'Sistema', icon: Bug, perm: 'system.debug', C: SystemTab },
];

export default function AdminRBAC() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const visible = TABS.filter((t) => can(t.perm));
  const active = visible.find((t) => t.key === params.get('tab')) || visible[0];

  return (
    <>
      
      <div className="tabs" role="tablist">
        {visible.map((t) => (
          <button key={t.key} role="tab" aria-selected={active?.key === t.key} onClick={() => setParams({ tab: t.key })}><t.icon size={15} />{t.label}</button>
        ))}
      </div>
      {active && <active.C />}
    </>
  );
}
