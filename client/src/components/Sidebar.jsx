import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ArrowDownWideNarrow, ArrowUpAZ, BarChart3, Bell, Cpu, Database, Home, LogOut, MonitorCog, Search, ShieldCheck, UserCog } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useFleet } from '../auth/FleetContext';
import { useLive } from '../auth/LiveContext';
import { hashUnit, num, riskVar } from '../utils/format';
import Sparkline from './Sparkline';

export default function Sidebar({ open, onNavigate }) {
  const { user, logout, can, canAny } = useAuth();
  const { summary } = useLive();
  const fleet = useFleet();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('code');
  const openAlerts = (summary?.open?.critical || 0) + (summary?.open?.warning || 0);

  const list = useMemo(() => {
    const items = (fleet?.machines || []).filter((m) => `${m.code} ${m.name} ${m.location || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
    return sort === 'risk'
      ? [...items].sort((a, b) => (b.latest?.failureProbability ?? -1) - (a.latest?.failureProbability ?? -1))
      : [...items].sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
  }, [fleet?.machines, q, sort]);

  const initials = (user?.fullName || user?.username || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const link = (to, Icon, label, extra) => (
    <NavLink to={to} onClick={onNavigate}><Icon size={18} />{label}{extra}</NavLink>
  );

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Menú principal">
      <div className="brand">
        <img className="brand-logo" src="/favicon.svg" alt="" />
        <div><strong>PrediSys</strong><span>FLOTA OPERATIVA</span></div>
      </div>
      <nav className="nav">
        {can('machines.read') && link('/dashboard', Home, 'Vista general')}
        {can('telemetry.read') && link('/analytics', BarChart3, 'Analítica ML')}
        {can('alerts.read') && link('/alerts', Bell, 'Alertas', openAlerts > 0 && <span className="count">{openAlerts > 99 ? '99+' : openAlerts}</span>)}
        {canAny('users.read', 'roles.manage', 'audit.read', 'settings.manage', 'system.debug') && link('/admin/rbac', ShieldCheck, 'Administración')}
        {link('/profile', UserCog, 'Perfil y preferencias')}
      </nav>
      {can('machines.read') && (
        <>
          <div className="nav-group label-caps">Herramientas de minería</div>
          <nav className="nav sub">
            {link('/tools/hardware', Database, 'Base de hardware')}
            {link('/tools/gpu', MonitorCog, 'Calculadora GPU')}
            {link('/tools/cpu', Cpu, 'Calculadora CPU')}
          </nav>
          <div className="side-list">
            <div className="side-search">
              <div className="wrap">
                <Search size={14} />
                <input className="input" placeholder="Buscar rig…" aria-label="Buscar máquina" value={q} onChange={(e) => setQ(e.target.value)} maxLength={40} />
              </div>
              <button className="btn icon" title={sort === 'code' ? 'Ordenar por riesgo' : 'Ordenar por código'} aria-label={sort === 'code' ? 'Ordenar por riesgo' : 'Ordenar por código'} onClick={() => setSort((s) => (s === 'code' ? 'risk' : 'code'))}>
                {sort === 'code' ? <ArrowDownWideNarrow size={16} /> : <ArrowUpAZ size={16} />}
              </button>
            </div>
            <div className="rig-list">
              {list.map((m) => {
                const c = riskVar(m.risk);
                const h = hashUnit(m.latest?.hashrate);
                return (
                  <button key={m.id} className="rig-item" onClick={() => { fleet.openMachine(m.id); onNavigate?.(); }} title={`${m.code} · ${m.latest?.diagnosis || 'sin datos'}`}>
                    <span className="dot" style={{ background: c }} />
                    <span><strong>{m.code}</strong><small>{num(m.latest?.temperature)}°C · {h.value}{h.unit ? h.unit.replace('/s', '') : ''}</small></span>
                    <Sparkline values={m.trend?.map((t) => t.p)} color={c} />
                    <span className="pct" style={{ color: c }}>{m.latest?.failureProbability == null ? '—' : `${Math.round(m.latest.failureProbability * 100)}%`}</span>
                  </button>
                );
              })}
              {fleet?.machines && list.length === 0 && <p className="muted small" style={{ padding: 10 }}>Ningún rig coincide con «{q}».</p>}
            </div>
          </div>
        </>
      )}
      <div className="user-card">
        <span className="avatar" aria-hidden="true">{initials}</span>
        <div className="who"><strong>{user?.fullName || user?.username}</strong><span>{user?.roles?.map((r) => r.name).join(', ') || 'Sin roles'}</span></div>
        <button className="btn ghost icon" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => logout()}><LogOut size={18} /></button>
      </div>
    </aside>
  );
}
