const BARS = [0.12, 0.18, 0.09, 0.22, 0.15, 0.31, 0.2, 0.45, 0.28, 0.14, 0.62, 0.38, 0.19, 0.83, 0.25, 0.11, 0.17, 0.52, 0.21, 0.13];
import { riskColor } from '../utils/format';

/** Lado izquierdo de las pantallas de acceso: una fila de racks coloreados por riesgo. */
export default function AuthShell({ children }) {
  return (
    <div className="auth">
      <section className="auth-art" aria-hidden="true">
        <div>
          <img src="/favicon.svg" width="36" height="36" alt="" />
        </div>
        <div>
          <div className="thermal-bars">
            {BARS.map((p, i) => <span key={i} style={{ height: `${20 + p * 80}%`, background: riskColor(p) }} />)}
          </div>
          <h1 style={{ marginTop: 28 }}>Anticipa la falla antes de que el hashrate llegue a cero.</h1>
          <p>PrediSys vigila temperatura, consumo, ventiladores y hashrate de cada máquina y estima su probabilidad de falla en tiempo real.</p>
        </div>
      </section>
      <section className="auth-form">{children}</section>
    </div>
  );
}
