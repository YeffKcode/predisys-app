import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Error de interfaz', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-load" style={{ padding: 32 }}>
        <div style={{ maxWidth: 460 }}>
          <h1>La pantalla dejó de responder</h1>
          <p className="muted" style={{ margin: '10px 0 18px' }}>Ocurrió un error inesperado en la interfaz. Tus datos están a salvo en el servidor. Recarga la página para continuar.</p>
          <button className="btn primary" onClick={() => window.location.reload()}>Recargar página</button>
        </div>
      </div>
    );
  }
}
