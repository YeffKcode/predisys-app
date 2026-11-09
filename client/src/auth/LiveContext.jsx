import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import { useToast } from '../components/Toasts';
import { useEventSource } from '../hooks/useEventSource';
import { pct } from '../utils/format';

const LiveContext = createContext({ summary: null, lastEvent: null, connected: false });

/** Alertas en tiempo real para toda la app: contador, avisos en pantalla y notificaciones del navegador. */
export function LiveProvider({ children }) {
  const { status, can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const enabled = status === 'authenticated' && can('alerts.read');
  const [summary, setSummary] = useState(null);
  const [lastEvent, setLastEvent] = useState(null);

  const loadSummary = useCallback(() => {
    if (enabled) api('/alerts/summary').then(setSummary).catch(() => {});
  }, [enabled]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const connected = useEventSource('/alerts/stream', 'alert', (evt) => {
    setLastEvent({ ...evt, receivedAt: Date.now() });
    loadSummary();
    const a = evt.alert;
    if (evt.type === 'created' && a) {
      const title = `Alerta ${a.severity === 'CRITICAL' ? 'crítica' : 'de advertencia'} en ${a.machineCode}`;
      const message = `${pct(a.failureProbability)} de probabilidad de falla · ${a.diagnosis || 'sin diagnóstico'}`;
      toast({ tone: a.severity === 'CRITICAL' ? 'critical' : 'warning', title, message, action: { label: 'Ver alerta', onClick: () => navigate(`/alerts/${a.id}`) } });
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        const n = new Notification(title, { body: message, tag: a.id, icon: '/favicon.svg' });
        n.onclick = () => { window.focus(); navigate(`/alerts/${a.id}`); };
      }
    }
    if (evt.type === 'anchored' && a) toast({ tone: 'success', title: `Alerta de ${a.machineCode} registrada en Testnet`, message: `Bloque ${a.chain?.blockNumber ?? '—'}` });
    if (evt.type === 'escalated' && a) toast({ tone: 'critical', title: `Alerta de ${a.machineCode} escalada`, message: 'Lleva tiempo sin ser reconocida.' });
  }, enabled);

  return <LiveContext.Provider value={{ summary, lastEvent, connected, reloadSummary: loadSummary }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
