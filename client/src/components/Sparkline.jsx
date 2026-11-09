/** Mini gráfica SVG de la tendencia de probabilidad de falla. */
export default function Sparkline({ values, color, width = 40, height = 16 }) {
  const pts = (values || []).filter((v) => v != null);
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...pts, 0.05);
  const min = Math.min(...pts, 0);
  const span = max - min || 1;
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * width},${height - 1 - ((v - min) / span) * (height - 2)}`).join(' ');
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
