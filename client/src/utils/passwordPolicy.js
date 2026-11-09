// Espejo de src/lib/password.js del backend: guía al usuario mientras escribe. La validación real es la del servidor.
function hasSequentialDigits(v) {
  for (let i = 0; i + 3 < v.length; i++) {
    const c = v.slice(i, i + 4);
    if (!/^\d{4}$/.test(c)) continue;
    const d = [...c].map(Number);
    if (d.every((n, k) => k === 0 || n === d[k - 1] + 1) || d.every((n, k) => k === 0 || n === d[k - 1] - 1)) return true;
  }
  return false;
}

export function passwordRules(pw = '', { username, email } = {}) {
  const lower = pw.toLowerCase();
  const local = email ? String(email).split('@')[0].toLowerCase() : '';
  return [
    { label: 'Al menos 10 caracteres', ok: pw.length >= 10 },
    { label: 'Una minúscula y una mayúscula', ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: 'Al menos un número', ok: /\d/.test(pw) },
    { label: 'Al menos un carácter especial', ok: /[^A-Za-z0-9]/.test(pw) },
    { label: 'Sin secuencias numéricas como 1234', ok: pw.length > 0 && !hasSequentialDigits(pw) },
    { label: 'Sin 4 caracteres repetidos seguidos ni espacios', ok: pw.length > 0 && !/(.)\1{3,}/.test(pw) && !/\s/.test(pw) },
    { label: 'Sin tu usuario ni tu correo', ok: pw.length > 0 && !(username && username.length >= 3 && lower.includes(username.toLowerCase())) && !(local.length >= 3 && lower.includes(local)) },
  ];
}

export const passwordOk = (pw, ctx) => passwordRules(pw, ctx).every((r) => r.ok);
