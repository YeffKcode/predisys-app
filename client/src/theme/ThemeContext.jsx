import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext({ theme: 'dark', toggle: () => {} });
const KEY = 'predisys-theme'; // solo la preferencia visual; nunca datos sensibles

const PALETTES = {
  dark: { grid: '#1c2635', axis: '#8a97aa', tooltipBg: '#141d2a', tooltipBorder: '#2a3648', text: '#e7edf5', green: '#34d399', yellow: '#fbbf24', red: '#f87171', blue: '#60a5fa', purple: '#a78bfa', cyan: '#22d3ee', pink: '#f472b6', faint: '#566275', track: '#1c2635' },
  light: { grid: '#e2e8f0', axis: '#526077', tooltipBg: '#ffffff', tooltipBorder: '#cbd5e1', text: '#0f172a', green: '#059669', yellow: '#d97706', red: '#dc2626', blue: '#2563eb', purple: '#7c3aed', cyan: '#0891b2', pink: '#db2777', faint: '#8492a6', track: '#e2e8f0' },
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#eef2f7' : '#0a0f17');
    try { localStorage.setItem(KEY, theme); } catch { /* modo privado */ }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo(() => ({ theme, toggle, palette: PALETTES[theme] }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
export const usePalette = () => useContext(ThemeContext).palette;

export function tooltipStyle(pal) {
  return { contentStyle: { background: pal.tooltipBg, border: `1px solid ${pal.tooltipBorder}`, borderRadius: 8, fontSize: 12, color: pal.text }, labelStyle: { color: pal.axis }, itemStyle: { color: pal.text } };
}
