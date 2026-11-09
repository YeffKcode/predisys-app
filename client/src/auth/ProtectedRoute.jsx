import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import Forbidden from '../pages/Forbidden';

/** Sin sesión → /login con la ruta original en ?next=. Con sesión pero sin permiso → 403. */
export default function ProtectedRoute({ children, anyOf }) {
  const { status, endReason, canAny } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <div className="center-load"><span className="spinner" aria-label="Cargando" /></div>;
  if (status !== 'authenticated') {
    const next = encodeURIComponent(location.pathname + location.search);
    const reason = endReason ? `&reason=${endReason}` : '';
    return <Navigate to={`/login?next=${next}${reason}`} replace />;
  }
  if (anyOf && !canAny(...anyOf)) return <Forbidden />;
  return children;
}
