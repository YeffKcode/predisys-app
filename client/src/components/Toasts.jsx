import { createContext, useCallback, useContext, useState } from 'react';
import { X } from 'lucide-react';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setItems((list) => [...list.slice(-4), { id, tone: 'info', ...toast }]);
    setTimeout(() => dismiss(id), toast.duration || (toast.tone === 'error' || toast.tone === 'critical' ? 9000 : 5000));
  }, [dismiss]);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <div>
              <strong>{t.title}</strong>
              {t.message && <p>{t.message}</p>}
              {t.action && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { t.action.onClick(); dismiss(t.id); }}>{t.action.label}</button>}
            </div>
            <button className="btn ghost sm icon" aria-label="Cerrar aviso" onClick={() => dismiss(t.id)}><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
