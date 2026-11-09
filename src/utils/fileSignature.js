'use strict';
const path = require('path');

// Firmas permitidas (magic bytes) y alias MIME aceptados por navegador
const ALLOWED = [
  { type: 'pdf', mime: 'application/pdf', mimes: ['application/pdf', 'application/x-pdf'], exts: ['.pdf'],
    test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { type: 'png', mime: 'image/png', mimes: ['image/png'], exts: ['.png'],
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'jpeg', mime: 'image/jpeg', mimes: ['image/jpeg', 'image/jpg', 'image/pjpeg'], exts: ['.jpg', '.jpeg'],
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

// Contenido ejecutable que se rechaza siempre, sin importar la extensión
const EXECUTABLES = [
  { name: 'Ejecutable Windows (MZ/PE)', test: (b) => b[0] === 0x4d && b[1] === 0x5a },
  { name: 'Ejecutable Linux (ELF)', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) },
  { name: 'Ejecutable macOS (Mach-O)', test: (b) => ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(b.subarray(0, 4).toString('hex')) },
  { name: 'Script con shebang', test: (b) => b[0] === 0x23 && b[1] === 0x21 },
];

function sanitizeFileName(name) {
  const base = path.basename(String(name || 'archivo')).normalize('NFC');
  return base.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 200) || 'archivo';
}

/** Verifica que el contenido real (magic bytes) coincida con extensión y MIME declarados. */
function inspectFile(buffer, originalName, declaredMime) {
  if (!buffer || buffer.length < 8) return { ok: false, reason: 'Archivo vacío o demasiado pequeño.' };

  const exe = EXECUTABLES.find((s) => s.test(buffer));
  if (exe) return { ok: false, reason: `Se detectó contenido ejecutable (${exe.name}). Archivo rechazado.`, detected: exe.name };

  const ext = path.extname(String(originalName || '')).toLowerCase();
  const sig = ALLOWED.find((s) => s.test(buffer));
  if (!sig) return { ok: false, reason: 'Tipo de archivo no permitido: la firma binaria no corresponde a PDF, PNG ni JPEG.' };
  if (!sig.exts.includes(ext)) return { ok: false, reason: `La extensión "${ext || '(ninguna)'}" no coincide con el contenido real (${sig.type.toUpperCase()}).` };
  if (declaredMime && !sig.mimes.includes(String(declaredMime).toLowerCase())) {
    return { ok: false, reason: `El tipo MIME declarado (${declaredMime}) no coincide con el contenido real (${sig.mime}).` };
  }
  if (sig.type === 'pdf' && !buffer.subarray(-1024).toString('latin1').includes('%%EOF')) {
    return { ok: false, reason: 'PDF malformado: falta el marcador de fin %%EOF.' };
  }
  return { ok: true, type: sig.type, mime: sig.mime, ext };
}

module.exports = { inspectFile, sanitizeFileName };
