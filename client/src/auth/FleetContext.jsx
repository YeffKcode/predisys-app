import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import { useLive } from './LiveContext';

const FleetContext = createContext(null);

/** Estado compartido de la flota: lo usan la barra lateral, el panel general, herramientas y el panel de máquina. */
export function FleetProvider({ children }) {
  const { status, can } = useAuth();
  const { lastEvent } = useLive();
  const enabled = status === 'authenticated' && can('machines.read');
  const [machines, setMachines] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [threshold, setThreshold] = useState(0.7);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [openTab, setOpenTab] = useState('telemetry');
  const [updatedAt, setUpdatedAt] = useState(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const [m, k] = await Promise.all([api('/machines'), api('/machines/kpis')]);
      setMachines(m.machines);
      setThreshold(m.alertThreshold ?? 0.7);
      setKpis(k.kpis);
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err);
    }
  }, [enabled]);

  useEffect(() => {
    reload();
    if (!enabled) return undefined;
    const id = setInterval(reload, 15000);
    return () => clearInterval(id);
  }, [reload, enabled]);
  useEffect(() => { if (lastEvent) reload(); }, [lastEvent, reload]);

  const openMachine = useCallback((id, tab = 'telemetry') => { setOpenTab(tab); setOpenId(id); }, []);
  const value = useMemo(() => ({ machines, kpis, threshold, error, reload, updatedAt, openId, openTab, openMachine, closeMachine: () => setOpenId(null) }), [machines, kpis, threshold, error, reload, updatedAt, openId, openTab, openMachine]);
  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export const useFleet = () => useContext(FleetContext);
