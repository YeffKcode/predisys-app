'use strict';
const { decrypt } = require('../lib/crypto');

const userInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
};

function collectPermissions(user) {
  const set = new Set();
  for (const ur of user.roles || []) for (const rp of ur.role.permissions || []) set.add(rp.permission.key);
  return set;
}

function safeDecrypt(value) {
  try { return decrypt(value); } catch { return null; }
}

function toUserDTO(user, { withPermissions = false } = {}) {
  const now = new Date();
  const dto = {
    id: user.id,
    username: user.username,
    email: safeDecrypt(user.emailEnc),
    fullName: safeDecrypt(user.fullNameEnc),
    isActive: user.isActive,
    isLocked: Boolean(user.lockedUntil && user.lockedUntil > now),
    lockedUntil: user.lockedUntil && user.lockedUntil > now ? user.lockedUntil : null,
    failedLoginAttempts: user.failedLoginAttempts,
    lastLoginAt: user.lastLoginAt,
    passwordChangedAt: user.passwordChangedAt,
    createdAt: user.createdAt,
    roles: (user.roles || []).map((ur) => ({ id: ur.role.id, name: ur.role.name })),
  };
  if (withPermissions) dto.permissions = [...collectPermissions(user)].sort();
  return dto;
}

module.exports = { userInclude, collectPermissions, toUserDTO };
