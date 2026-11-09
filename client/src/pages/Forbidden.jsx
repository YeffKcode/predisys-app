import { Link } from 'react-router-dom';

export default function Forbidden() {
  return (
    <div className="empty" style={{ maxWidth: 520, margin: '40px auto' }}>
      <h3>No tienes permiso para ver esta sección</h3>
      <p>Pide a un administrador que asigne a tu usuario un rol con el permiso necesario.</p>
      <p style={{ marginTop: 14 }}><Link to="/profile">Ir a mi perfil</Link></p>
    </div>
  );
}
