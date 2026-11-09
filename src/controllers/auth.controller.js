'use strict';
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { encrypt, hashEmail, maskEmail, randomNumericCode } = require('../lib/crypto');
const { hashPassword, verifyPassword, validatePasswordPolicy } = require('../lib/password');
const { sendResetCode } = require('../lib/mailer');
const { audit } = require('../services/audit.service');
const { getSettings } = require('../services/settings.service');
const { createSession, revokeSession, revokeAllForUser, clearAuthCookie } = require('../services/session.service');
const { userInclude, toUserDTO } = require('../utils/userDto');
const { getIp } = require('../utils/request');

const DEFAULT_ROLE = 'OPERATOR';
const GENERIC_RECOVERY_MSG = 'Si el correo está registrado, recibirás un código de recuperación en los próximos minutos.';

function assertPolicy(password, ctx) {
  const errors = validatePasswordPolicy(password, ctx);
  if (errors.length) throw new AppError(422, 'La contraseña no cumple la política de seguridad.', 'WEAK_PASSWORD', errors.map((message) => ({ field: 'password', message })));
}

/** Crea un usuario aplicando unicidad de correo/usuario, política de clave y cifrado. Reutilizado por admin. */
async function createUserRecord({ username, email, password, fullName, roleIds }, assignedBy) {
  assertPolicy(password, { username, email });
  const emailHash = hashEmail(email);
  const [byEmail, byUsername] = await Promise.all([
    prisma.user.findUnique({ where: { emailHash }, select: { id: true } }),
    prisma.user.findUnique({ where: { username }, select: { id: true } }),
  ]);
  if (byEmail) throw new AppError(409, 'El correo electrónico ya está registrado.', 'EMAIL_TAKEN', [{ field: 'email', message: 'Correo duplicado.' }]);
  if (byUsername) throw new AppError(409, 'El nombre de usuario ya está en uso.', 'USERNAME_TAKEN', [{ field: 'username', message: 'Usuario duplicado.' }]);

  let roles = roleIds && roleIds.length
    ? await prisma.role.findMany({ where: { id: { in: roleIds } } })
    : await prisma.role.findMany({ where: { name: DEFAULT_ROLE } });
  if (roleIds && roleIds.length && roles.length !== new Set(roleIds).size) throw new AppError(400, 'Uno o más roles no existen.', 'ROLE_NOT_FOUND');

  try {
    return await prisma.user.create({
      data: {
        username,
        emailHash,
        emailEnc: encrypt(email),
        fullNameEnc: fullName ? encrypt(fullName) : null,
        passwordHash: await hashPassword(password),
        roles: { create: roles.map((r) => ({ roleId: r.id, assignedBy: assignedBy ?? null })) },
      },
      include: userInclude,
    });
  } catch (err) {
    // Carrera entre dos registros simultáneos: la restricción UNIQUE de la BD tiene la última palabra
    if (err.code === 'P2002') {
      const target = String(err.meta?.target || '');
      if (target.includes('email')) throw new AppError(409, 'El correo electrónico ya está registrado.', 'EMAIL_TAKEN');
      throw new AppError(409, 'El nombre de usuario ya está en uso.', 'USERNAME_TAKEN');
    }
    throw err;
  }
}

async function register(req, res) {
  const user = await createUserRecord(req.body);
  await audit(req, 'USER_REGISTERED', { actorId: user.id, actorUsername: user.username, entity: 'User', entityId: user.id, details: { email: maskEmail(req.body.email) } });
  res.status(201).json({ message: 'Cuenta creada correctamente. Ya puedes iniciar sesión.', user: toUserDTO(user) });
}

async function login(req, res) {
  const { identifier, password } = req.body;
  const isEmail = identifier.includes('@');
  const user = await prisma.user.findUnique({
    where: isEmail ? { emailHash: hashEmail(identifier) } : { username: identifier },
    include: userInclude,
  });

  if (!user) {
    await verifyPassword(password, null); // igualar tiempo de respuesta
    await audit(req, 'LOGIN_FAILED', { actorId: null, actorUsername: null, details: { identifier: isEmail ? maskEmail(identifier) : identifier, reason: 'UNKNOWN_USER' } });
    throw new AppError(401, 'Usuario o contraseña incorrectos.', 'INVALID_CREDENTIALS');
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.ceil((user.lockedUntil - now) / 60000);
    await audit(req, 'LOGIN_BLOCKED', { actorId: user.id, actorUsername: user.username, entity: 'User', entityId: user.id, details: { lockedUntil: user.lockedUntil } });
    throw new AppError(423, `La cuenta está bloqueada por intentos fallidos. Intenta en ${minutes} minuto(s) o contacta al administrador.`, 'ACCOUNT_LOCKED', { lockedUntil: user.lockedUntil });
  }
  if (!user.isActive) {
    await audit(req, 'LOGIN_FAILED', { actorId: user.id, actorUsername: user.username, details: { reason: 'ACCOUNT_DISABLED' } });
    throw new AppError(403, 'La cuenta está desactivada. Contacta al administrador.', 'ACCOUNT_DISABLED');
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (updated.failedLoginAttempts >= env.lockout.maxAttempts) {
      const lockedUntil = new Date(Date.now() + env.lockout.minutes * 60000);
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil, failedLoginAttempts: 0 } });
      await revokeAllForUser(user.id, 'ACCOUNT_LOCKED');
      await audit(req, 'ACCOUNT_LOCKED', { actorId: user.id, actorUsername: user.username, entity: 'User', entityId: user.id, details: { attempts: env.lockout.maxAttempts, lockedUntil } });
      throw new AppError(423, `Cuenta bloqueada tras ${env.lockout.maxAttempts} intentos fallidos consecutivos. Intenta en ${env.lockout.minutes} minutos.`, 'ACCOUNT_LOCKED', { lockedUntil });
    }
    const remaining = env.lockout.maxAttempts - updated.failedLoginAttempts;
    await audit(req, 'LOGIN_FAILED', { actorId: user.id, actorUsername: user.username, entity: 'User', entityId: user.id, details: { reason: 'BAD_PASSWORD', attempt: updated.failedLoginAttempts } });
    throw new AppError(401, `Usuario o contraseña incorrectos. Intentos restantes antes del bloqueo: ${remaining}.`, 'INVALID_CREDENTIALS', { remainingAttempts: remaining });
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now } });
  const { session, settings, revokedForConcurrency } = await createSession(user, req, res);
  await audit(req, 'LOGIN_SUCCESS', { actorId: user.id, actorUsername: user.username, entity: 'Session', entityId: session.id, details: { revokedForConcurrency } });

  res.json({
    message: 'Inicio de sesión exitoso.',
    user: toUserDTO(user, { withPermissions: true }),
    session: { id: session.id, tokenTtlMinutes: settings.tokenTtlMinutes, sessionIdleMinutes: settings.sessionIdleMinutes },
  });
}

async function logout(req, res) {
  await revokeSession(req.authSession.id, 'LOGOUT');
  clearAuthCookie(res);
  await audit(req, 'LOGOUT', { entity: 'Session', entityId: req.authSession.id });
  res.json({ message: 'Sesión cerrada.' });
}

async function logoutAll(req, res) {
  const { count } = await revokeAllForUser(req.user.id, 'LOGOUT_ALL');
  clearAuthCookie(res);
  await audit(req, 'LOGOUT_ALL', { entity: 'User', entityId: req.user.id, details: { revoked: count } });
  res.json({ message: `Se cerraron ${count} sesión(es).` });
}

async function me(req, res) {
  const settings = await getSettings();
  res.json({
    user: toUserDTO(req.user.raw, { withPermissions: true }),
    session: { id: req.authSession.id, createdAt: req.authSession.createdAt, tokenTtlMinutes: settings.tokenTtlMinutes, sessionIdleMinutes: settings.sessionIdleMinutes },
  });
}

/** No extiende la sesión: el frontend lo consulta para mostrar la cuenta regresiva. */
async function sessionStatus(req, res) {
  const settings = await getSettings();
  res.json({
    active: true,
    tokenExpiresAt: new Date(req.authSession.tokenExp * 1000),
    idleExpiresAt: new Date(req.authSession.lastActivityAt.getTime() + settings.sessionIdleMinutes * 60000),
    settings,
  });
}

async function listSessions(req, res) {
  const sessions = await prisma.session.findMany({
    where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastActivityAt: 'desc' },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastActivityAt: true, expiresAt: true },
  });
  res.json({ sessions: sessions.map((s) => ({ ...s, current: s.id === req.authSession.id })) });
}

async function revokeOwnSession(req, res) {
  const { id } = req.v.params;
  const session = await prisma.session.findFirst({ where: { id, userId: req.user.id, revokedAt: null } });
  if (!session) throw new AppError(404, 'Sesión no encontrada.', 'NOT_FOUND');
  await revokeSession(id, 'REVOKED_BY_USER');
  if (id === req.authSession.id) clearAuthCookie(res);
  await audit(req, 'SESSION_REVOKED', { entity: 'Session', entityId: id });
  res.json({ message: 'Sesión revocada.' });
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  const user = await prisma.user.findUnique({ where: { emailHash: hashEmail(email) } });
  if (user && user.isActive) {
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    const code = randomNumericCode(6);
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt: new Date(Date.now() + env.resetCode.ttlMinutes * 60000),
        ip: getIp(req),
      },
    });
    await sendResetCode(email, code, env.resetCode.ttlMinutes);
    await audit(req, 'PASSWORD_RESET_REQUESTED', { actorId: user.id, actorUsername: user.username, entity: 'User', entityId: user.id });
  } else {
    await audit(req, 'PASSWORD_RESET_REQUESTED', { actorId: null, actorUsername: null, details: { email: maskEmail(email), matched: false } });
  }
  // Respuesta idéntica exista o no la cuenta (anti-enumeración)
  res.json({ message: GENERIC_RECOVERY_MSG });
}

async function resetPassword(req, res) {
  const { email, code, newPassword } = req.body;
  const invalid = new AppError(400, 'El código es inválido o expiró. Solicita uno nuevo.', 'INVALID_RESET_CODE');
  const user = await prisma.user.findUnique({ where: { emailHash: hashEmail(email) } });
  if (!user) throw invalid;

  const token = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!token) throw invalid;
  if (token.attempts >= env.resetCode.maxAttempts) {
    await prisma.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
    throw invalid;
  }
  if (!(await bcrypt.compare(code, token.codeHash))) {
    await prisma.passwordResetToken.update({ where: { id: token.id }, data: { attempts: { increment: 1 } } });
    await audit(req, 'PASSWORD_RESET_FAILED', { actorId: user.id, actorUsername: user.username, entity: 'User', entityId: user.id });
    throw invalid;
  }

  assertPolicy(newPassword, { username: user.username, email });
  if (await verifyPassword(newPassword, user.passwordHash)) throw new AppError(422, 'La nueva contraseña debe ser diferente a la actual.', 'PASSWORD_REUSED');

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    }),
    prisma.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllForUser(user.id, 'PASSWORD_RESET');
  await audit(req, 'PASSWORD_RESET_COMPLETED', { actorId: user.id, actorUsername: user.username, entity: 'User', entityId: user.id });
  res.json({ message: 'Contraseña restablecida. Inicia sesión con tu nueva contraseña.' });
}

module.exports = {
  register, login, logout, logoutAll, me, sessionStatus, listSessions, revokeOwnSession,
  forgotPassword, resetPassword, createUserRecord, assertPolicy,
};
