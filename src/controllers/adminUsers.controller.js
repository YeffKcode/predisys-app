'use strict';
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { encrypt, decrypt, maskEmail } = require('../lib/crypto');
const { hashPassword } = require('../lib/password');
const { audit } = require('../services/audit.service');
const { revokeAllForUser } = require('../services/session.service');
const { userInclude, toUserDTO } = require('../utils/userDto');
const { createUserRecord, assertPolicy } = require('./auth.controller');

async function findUserOr404(id) {
  const user = await prisma.user.findUnique({ where: { id }, include: userInclude });
  if (!user) throw new AppError(404, 'Usuario no encontrado.', 'NOT_FOUND');
  return user;
}

async function listUsers(req, res) {
  const now = new Date();
  const users = await prisma.user.findMany({
    include: { ...userInclude, _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: now } } } } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ users: users.map((u) => ({ ...toUserDTO(u, { withPermissions: true }), activeSessions: u._count.sessions })) });
}

async function createUser(req, res) {
  const user = await createUserRecord(req.body, req.user.id);
  await audit(req, 'ADMIN_USER_CREATED', { entity: 'User', entityId: user.id, details: { username: user.username, email: maskEmail(req.body.email), roles: user.roles.map((r) => r.role.name) } });
  res.status(201).json({ user: toUserDTO(user, { withPermissions: true }) });
}

async function updateUser(req, res) {
  const { id } = req.v.params;
  const target = await findUserOr404(id);
  if (id === req.user.id && req.body.isActive === false) throw new AppError(400, 'No puedes desactivar tu propia cuenta.', 'SELF_ACTION');
  const data = {};
  if (req.body.isActive !== undefined) data.isActive = req.body.isActive;
  if (req.body.fullName !== undefined) data.fullNameEnc = req.body.fullName ? encrypt(req.body.fullName) : null;
  const updated = await prisma.user.update({ where: { id }, data, include: userInclude });
  if (data.isActive === false) await revokeAllForUser(id, 'USER_DISABLED');
  await audit(req, 'ADMIN_USER_UPDATED', { entity: 'User', entityId: id, details: { username: target.username, isActive: data.isActive, fullNameChanged: req.body.fullName !== undefined } });
  res.json({ user: toUserDTO(updated, { withPermissions: true }) });
}

/** Reemplaza el conjunto completo de roles del usuario (multirrol). */
async function setUserRoles(req, res) {
  const { id } = req.v.params;
  const roleIds = [...new Set(req.body.roleIds)];
  const target = await findUserOr404(id);
  const roles = await prisma.role.findMany({ where: { id: { in: roleIds } } });
  if (roles.length !== roleIds.length) throw new AppError(400, 'Uno o más roles no existen.', 'ROLE_NOT_FOUND');
  if (id === req.user.id && req.user.roles.includes('ADMIN') && !roles.some((r) => r.name === 'ADMIN')) {
    throw new AppError(400, 'No puedes quitarte a ti mismo el rol ADMIN.', 'SELF_ACTION');
  }
  const before = target.roles.map((r) => r.role.name);
  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: id } }),
    prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId, assignedBy: req.user.id })) }),
  ]);
  const updated = await findUserOr404(id);
  await audit(req, 'USER_ROLES_UPDATED', { entity: 'User', entityId: id, details: { username: target.username, before, after: roles.map((r) => r.name) } });
  res.json({ user: toUserDTO(updated, { withPermissions: true }) });
}

/** Anulación administrativa de contraseña: la política se aplica igual (un solo carácter se rechaza). */
async function adminSetPassword(req, res) {
  const { id } = req.v.params;
  const target = await findUserOr404(id);
  try {
    assertPolicy(req.body.newPassword, { username: target.username, email: decrypt(target.emailEnc) });
  } catch (err) {
    await audit(req, 'ADMIN_PASSWORD_OVERRIDE_REJECTED', { entity: 'User', entityId: id, details: { username: target.username, reasons: err.details?.map((d) => d.message) } });
    throw err;
  }
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(req.body.newPassword), passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
  });
  const { count } = await revokeAllForUser(id, 'ADMIN_PASSWORD_OVERRIDE');
  await audit(req, 'ADMIN_PASSWORD_OVERRIDE', { entity: 'User', entityId: id, details: { username: target.username, sessionsRevoked: count } });
  res.json({ message: `Contraseña de ${target.username} actualizada. Se cerraron ${count} sesión(es) activas.` });
}

async function unlockUser(req, res) {
  const { id } = req.v.params;
  const target = await findUserOr404(id);
  await prisma.user.update({ where: { id }, data: { lockedUntil: null, failedLoginAttempts: 0 } });
  await audit(req, 'ACCOUNT_UNLOCKED', { entity: 'User', entityId: id, details: { username: target.username } });
  res.json({ message: `Cuenta ${target.username} desbloqueada.` });
}

async function revokeUserSessions(req, res) {
  const { id } = req.v.params;
  const target = await findUserOr404(id);
  const { count } = await revokeAllForUser(id, 'REVOKED_BY_ADMIN');
  await audit(req, 'ADMIN_SESSIONS_REVOKED', { entity: 'User', entityId: id, details: { username: target.username, count } });
  res.json({ message: `Se revocaron ${count} sesión(es).` });
}

module.exports = { listUsers, createUser, updateUser, setUserRoles, adminSetPassword, unlockUser, revokeUserSessions };
