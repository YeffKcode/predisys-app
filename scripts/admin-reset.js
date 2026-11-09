'use strict';
/**
 * Diagnóstico y restablecimiento de la cuenta de administrador desde la terminal del servidor.
 * No pasa por la pantalla de login, así que no consume intentos ni depende del bloqueo.
 *
 *   npm run admin:diagnose            # solo revisa: existe, bloqueo, roles, si la clave del .env coincide
 *   npm run admin:reset               # pide la nueva contraseña (oculta, dos veces) y desbloquea
 *   npm run admin:reset -- --from-env # usa SEED_ADMIN_PASSWORD del .env
 *   npm run admin:reset -- --username=otro
 *
 * Requiere acceso a la terminal y al .env del servidor: quien lo ejecuta ya tiene acceso total a la BD.
 * Cada restablecimiento queda en AuditLogs (actor "cli").
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { PrismaClient } = require('@prisma/client');
const { hashEmail, decrypt } = require('../src/lib/crypto');
const { hashPassword, verifyPassword, validatePasswordPolicy } = require('../src/lib/password');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const mode = args.diagnose ? 'diagnose' : 'reset';
const username = String(args.username || process.env.SEED_ADMIN_USERNAME || 'admin');
const prisma = new PrismaClient();
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => console.log(`  ✘ ${m}`);
const info = (m) => console.log(`  · ${m}`);

/** Detecta valores del .env recortados por un # sin comillas. */
function checkRawEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return bad('No existe .env en la raíz del proyecto.');
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => /^\s*SEED_ADMIN_PASSWORD\s*=/.test(l));
  if (!line) return info('SEED_ADMIN_PASSWORD no está en .env (el seed usa su valor por defecto).');
  const raw = line.split('=').slice(1).join('=').trim();
  const unquoted = !/^["']/.test(raw);
  if (unquoted && raw.includes('#')) {
    bad(`SEED_ADMIN_PASSWORD contiene "#" sin comillas: se lee como "${raw.split('#')[0].trim()}". Escríbela entre comillas dobles.`);
  } else {
    ok(`SEED_ADMIN_PASSWORD se lee completa (${(process.env.SEED_ADMIN_PASSWORD || '').length} caracteres).`);
  }
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); }; // no hace eco de lo tecleado
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function diagnose(user) {
  console.log(`\nDiagnóstico de "${username}"`);
  checkRawEnv();
  if (!user) {
    bad(`El usuario "${username}" no existe. Ejecuta "npm run db:seed" para crearlo.`);
    return;
  }
  ok('El usuario existe.');
  user.isActive ? ok('Cuenta activa.') : bad('Cuenta desactivada.');
  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) bad(`Cuenta BLOQUEADA hasta ${user.lockedUntil.toLocaleString('es-CO')}.`);
  else ok('Cuenta sin bloqueo.');
  info(`Intentos fallidos consecutivos: ${user.failedLoginAttempts} de 5.`);
  const roles = user.roles.map((r) => r.role.name);
  roles.includes('ADMIN') ? ok(`Roles: ${roles.join(', ')}.`) : bad(`No tiene el rol ADMIN (roles: ${roles.join(', ') || 'ninguno'}).`);

  const envPass = process.env.SEED_ADMIN_PASSWORD;
  if (envPass) {
    (await verifyPassword(envPass, user.passwordHash))
      ? ok('La contraseña de SEED_ADMIN_PASSWORD coincide con la guardada.')
      : bad('La contraseña de SEED_ADMIN_PASSWORD NO coincide con la guardada (el usuario se creó con otra; el seed no lo modifica).');
  }
  const email = process.env.SEED_ADMIN_EMAIL;
  if (email) {
    user.emailHash === hashEmail(email)
      ? ok('El correo del .env coincide (el login por correo funcionará).')
      : bad('El correo del .env no coincide con el guardado, o EMAIL_HASH_KEY cambió. Inicia sesión con el nombre de usuario.');
  }
  try { decrypt(user.emailEnc); ok('DATA_ENCRYPTION_KEY descifra los datos guardados.'); } catch { bad('DATA_ENCRYPTION_KEY no descifra los datos: la clave cambió después de crear el usuario.'); }
}

async function reset(user) {
  if (!user) throw new Error(`El usuario "${username}" no existe. Ejecuta "npm run db:seed".`);
  let password;
  if (args['from-env']) {
    password = process.env.SEED_ADMIN_PASSWORD;
    if (!password) throw new Error('SEED_ADMIN_PASSWORD está vacía en .env.');
  } else {
    if (!process.stdin.isTTY) throw new Error('Ejecuta el script en una terminal interactiva o usa --from-env.');
    password = await askHidden('Nueva contraseña: ');
    if (password !== (await askHidden('Repítela: '))) throw new Error('Las contraseñas no coinciden.');
  }
  let email = null;
  try { email = decrypt(user.emailEnc); } catch { /* clave cambiada: la política se valida sin el correo */ }
  const errors = validatePasswordPolicy(password, { username: user.username, email });
  if (errors.length) throw new Error(`La contraseña no cumple la política:\n    - ${errors.join('\n    - ')}`);

  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  const ops = [
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null, isActive: true },
    }),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'CLI_RESET' } }),
    prisma.auditLog.create({
      data: { actorId: null, actorUsername: 'cli', action: 'ADMIN_PASSWORD_RESET_CLI', entity: 'User', entityId: user.id, ip: 'localhost', details: { username: user.username, source: args['from-env'] ? 'env' : 'prompt' } },
    }),
  ];
  if (adminRole && !user.roles.some((r) => r.role.name === 'ADMIN')) {
    ops.push(prisma.userRole.create({ data: { userId: user.id, roleId: adminRole.id } }));
  }
  await prisma.$transaction(ops);
  console.log(`\n✔ Contraseña de "${user.username}" restablecida, cuenta desbloqueada y sesiones anteriores cerradas.`);
  console.log(`  Inicia sesión con el usuario "${user.username}" (no hace falta el correo).`);
}

(async () => {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { roles: { include: { role: true } } },
  });
  if (mode === 'diagnose') await diagnose(user);
  else await reset(user);
})()
  .catch((err) => { console.error(`\n✘ ${err.message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
