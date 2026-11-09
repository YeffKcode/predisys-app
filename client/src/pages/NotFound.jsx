import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="center-load">
      <div className="empty" style={{ maxWidth: 460 }}>
        <h3>Esta página no existe</h3>
        <p>Revisa la dirección o vuelve al panel de la flota.</p>
        <p style={{ marginTop: 14 }}><Link to="/dashboard">Ir a la flota</Link></p>
      </div>
    </div>
  );
}
