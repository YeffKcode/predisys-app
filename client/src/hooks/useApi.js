import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

/** Carga de datos con recarga manual. `deps` cambia la consulta. */
export function useApi(path, { query, enabled = true, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const ctrl = useRef(null);
  const queryKey = JSON.stringify(query || {});

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!enabled || !path) return null;
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    if (!silent) setLoading(true);
    try {
      const res = await api(path, { query, signal: ctrl.current.signal });
      setData(res);
      setError(null);
      return res;
    } catch (err) {
      if (err.name !== 'AbortError') setError(err);
      return null;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, queryKey, enabled, ...deps]);

  useEffect(() => {
    reload();
    return () => ctrl.current?.abort();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
