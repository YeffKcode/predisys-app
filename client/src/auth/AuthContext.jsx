import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, onSessionEvent } from '../api/client';

const AuthContext = createContext(null);
const CHANNEL = 'predisys-auth';
const STORAGE_KEY = 'predisys-auth-event'; // respaldo para navegadores sin BroadcastChannel (solo guarda un evento, nunca datos)

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);
  const [expiry, setExpiry] = useState({ tokenExpiresAt: null, idleExpiresAt: null });
  const [endReason, setEndReason] = useState(null);
  const channelRef = useRef(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const broadcast = useCallback((type) => {
    channelRef.current?.postMessage({ type, at: Date.now() });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ type, at: Date.now() })); } catch { /* modo privado */ }
  }, []);

  const endSession = useCallback((reason, { notifyOthers = true } = {}) => {
    if (statusRef.current === 'anonymous') return;
    setUser(null);
    setExpiry({ tokenExpiresAt: null, idleExpiresAt: null });
    setEndReason(reason);
    setStatus('anonymous');
    if (notifyOthers) broadcast('logout');
  }, [broadcast]);

  const loadMe = useCallback(async () => {
    try {
      const res = await api('/auth/me', { quiet: true });
      setUser(res.user);
      setStatus('authenticated');
      setEndReason(null);
      return res.user;
    } catch {
      setUser(null);
      setStatus('anonymous');
      return null;
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  // Sincronización entre pestañas: cerrar sesión en una cierra todas
  useEffect(() => {
    const onMsg = (msg) => {
      if (msg?.type === 'logout') endSession('LOGOUT_OTHER_TAB', { notifyOthers: false });
      if (msg?.type === 'login' && statusRef.current !== 'authenticated') loadMe();
    };
    if ('BroadcastChannel' in window) {
      channelRef.current = new BroadcastChannel(CHANNEL);
      channelRef.current.onmessage = (e) => onMsg(e.data);
    }
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try { onMsg(JSON.parse(e.newValue)); } catch { /* ignorar */ }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      channelRef.current?.close();
      window.removeEventListener('storage', onStorage);
    };
  }, [endSession, loadMe]);

  // Cabeceras de expiración y 401 de cualquier petición
  useEffect(() => onSessionEvent((evt) => {
    if (evt.type === 'activity') setExpiry((prev) => ({ tokenExpiresAt: evt.tokenExpiresAt || prev.tokenExpiresAt, idleExpiresAt: evt.idleExpiresAt || prev.idleExpiresAt }));
    if (evt.type === 'unauthorized') endSession(evt.code);
  }), [endSession]);

  // Verificación periódica sin extender la sesión; también al volver a la pestaña o con el botón "atrás"
  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    const check = () => api('/auth/session-status').then((s) => setExpiry({ tokenExpiresAt: s.tokenExpiresAt, idleExpiresAt: s.idleExpiresAt })).catch(() => {});
    check();
    const id = setInterval(check, 30000);
    const onVisible = () => document.visibilityState === 'visible' && check();
    const onPageShow = (e) => e.persisted && check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [status]);

  const login = useCallback(async (identifier, password) => {
    const res = await api('/auth/login', { method: 'POST', body: { identifier, password } });
    setUser(res.user);
    setEndReason(null);
    setStatus('authenticated');
    broadcast('login');
    return res;
  }, [broadcast]);

  const logout = useCallback(async ({ everywhere = false } = {}) => {
    try { await api(everywhere ? '/auth/logout-all' : '/auth/logout', { method: 'POST', quiet: true }); } catch { /* la sesión puede haber expirado ya */ }
    endSession('LOGOUT');
  }, [endSession]);

  const extend = useCallback(() => api('/auth/me').then((r) => setUser(r.user)), []);

  const value = useMemo(() => ({
    status, user, expiry, endReason,
    login, logout, extend, endSession, refreshUser: loadMe,
    can: (...keys) => Boolean(user && keys.every((k) => user.permissions?.includes(k))),
    canAny: (...keys) => Boolean(user && keys.some((k) => user.permissions?.includes(k))),
  }), [status, user, expiry, endReason, login, logout, extend, endSession, loadMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
