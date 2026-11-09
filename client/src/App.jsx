import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/dashboard/Dashboard';
import Analytics from './pages/Analytics';
import Alerts from './pages/Alerts';
import AdminRBAC from './pages/admin/AdminRBAC';
import Profile from './pages/Profile';
import Hardware from './pages/tools/Hardware';
import Calculator from './pages/tools/Calculator';
import NotFound from './pages/NotFound';

function Home() {
  const { status, can } = useAuth();
  if (status === 'loading') return null;
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return <Navigate to={can('machines.read') ? '/dashboard' : '/profile'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<ProtectedRoute anyOf={['machines.read']}><Dashboard /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute anyOf={['telemetry.read']}><Analytics /></ProtectedRoute>} />
        <Route path="/alerts" element={<ProtectedRoute anyOf={['alerts.read']}><Alerts /></ProtectedRoute>} />
        <Route path="/alerts/:id" element={<ProtectedRoute anyOf={['alerts.read']}><Alerts /></ProtectedRoute>} />
        <Route path="/admin/rbac" element={<ProtectedRoute anyOf={['users.read', 'roles.manage', 'audit.read', 'settings.manage', 'system.debug']}><AdminRBAC /></ProtectedRoute>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/tools/hardware" element={<ProtectedRoute anyOf={['machines.read']}><Hardware /></ProtectedRoute>} />
        <Route path="/tools/gpu" element={<ProtectedRoute anyOf={['machines.read']}><Calculator key="gpu" kind="gpu" /></ProtectedRoute>} />
        <Route path="/tools/cpu" element={<ProtectedRoute anyOf={['machines.read']}><Calculator key="cpu" kind="cpu" /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
