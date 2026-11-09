const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Error ${status}`);
    this.status = status;
    this.code = body?.error?.code || 'ERROR';
    this.details = body?.error?.details;
    this.requestId = body?.error?.requestId;
  }

  /** Errores por campo devueltos por la API (validación, política de contraseña, duplicados). */
  fieldErrors() {
    const out = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details) {
        const key = d.field || '_';
        out[key] = out[key] ? `${out[key]} ${d.message}` : d.message;
      }
    }
    return out;
  }
}

const SESSION_CODES = new Set(['AUTH_REQUIRED', 'TOKEN_EXPIRED', 'TOKEN_INVALID', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'ACCOUNT_DISABLED']);
const listeners = new Set();
export function onSessionEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (evt) => listeners.forEach((fn) => fn(evt));

export const apiUrl = (path) => `${BASE}${path}`;

/**
 * fetch con cookie HTTPOnly (credentials: 'include'). Cada respuesta autenticada trae las cabeceras
 * de expiración del token y de la sesión, que alimentan el temporizador de la barra superior.
 */
export async function api(path, { method = 'GET', body, query, form, signal, quiet = false } = {}) {
  const url = new URL(apiUrl(path), window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const headers = {};
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'include', signal, cache: 'no-store' });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, { error: { code: 'NETWORK', message: 'No hay conexión con el servidor. Comprueba que la API esté en ejecución.' } });
  }

  const tokenExpiresAt = res.headers.get('X-Token-Expires-At');
  const idleExpiresAt = res.headers.get('X-Session-Idle-Expires-At');
  if (tokenExpiresAt || idleExpiresAt) emit({ type: 'activity', tokenExpiresAt, idleExpiresAt });

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && SESSION_CODES.has(err.code) && !quiet) emit({ type: 'unauthorized', code: err.code, message: err.message });
    throw err;
  }
  return data;
}

/**
 * Descarga autenticada (cookie HTTPOnly). Usa fetch en vez de un enlace directo para poder mostrar
 * los errores de la API (permisos, límite de frecuencia) en lugar de descargar un JSON de error.
 */
export async function downloadFile(path, { query, fallbackName = 'archivo' } = {}) {
  const url = new URL(apiUrl(path), window.location.origin);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK', message: 'No hay conexión con el servidor.' } });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = new ApiError(res.status, body);
    if (res.status === 401) emit({ type: 'unauthorized', code: err.code, message: err.message });
    throw err;
  }
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
  const name = (match?.[1] || fallbackName).replace(/[^\w.\-]/g, '_');
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
  return { name, size: blob.size, documentId: res.headers.get('x-document-id') };
}
