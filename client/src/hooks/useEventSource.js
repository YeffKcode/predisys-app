import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../api/client';

/** Suscripción SSE con reconexión. Devuelve si la conexión está activa. */
export function useEventSource(path, eventName, onMessage, enabled = true) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let es;
    let retry;
    let closed = false;
    const connect = () => {
      es = new EventSource(apiUrl(path), { withCredentials: true });
      es.addEventListener('ready', () => setConnected(true));
      es.addEventListener(eventName, (e) => {
        try { handler.current(JSON.parse(e.data)); } catch { /* mensaje inválido */ }
      });
      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!closed) retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      es?.close();
      setConnected(false);
    };
  }, [path, eventName, enabled]);

  return connected;
}
