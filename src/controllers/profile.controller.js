'use strict';
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { encrypt, decrypt, hashEmail, maskEmail } = require('../lib/crypto');
const { hashPassword, verifyPassword } = require('../lib/password');
const { audit } = require('../services/audit.service');
const { revokeAllForUser } = require('../services/session.service');
const { userInclude, toUserDTO } = require('../utils/userDto');
const { assertPolicy } = require('./auth.controller');

async function getProfile(req, res) {
  res.json({ user: toUserDTO(req.user.raw, { withPermissions: true }) });
}

/** Autogestión de correo y/o contraseña. Exige la contraseña actual. */
async function updateCredentials(req, res) {
  const { currentPassword, newEmail, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    await audit(req, 'PROFILE_UPDATE_FAILED', { entity: 'User', entityId: user.id, details: { reason: 'BAD_CURRENT_PASSWORD' } });
    throw new AppError(401, 'La contraseña actual es incorrecta.', 'INVALID_CURRENT_PASSWORD', [{ field: 'currentPassword', message: 'Incorrecta.' }]);
  }

  const data = {};
  const changes = [];
  const currentEmail = decrypt(user.emailEnc);

  if (newEmail && newEmail !== currentEmail) {
    const emailHash = hashEmail(newEmail);
    const taken = await prisma.user.findUnique({ where: { emailHash }, select: { id: true } });
    if (taken) throw new AppError(409, 'El correo electrónico ya está registrado.', 'EMAIL_TAKEN', [{ field: 'newEmail', message: 'Correo duplicado.' }]);
    data.emailHash = emailHash;
    data.emailEnc = encrypt(newEmail);
    changes.push('email');
  }
  if (newPassword) {
    assertPolicy(newPassword, { username: user.username, email: newEmail || currentEmail });
    if (await verifyPassword(newPassword, user.passwordHash)) throw new AppError(422, 'La nueva contraseña debe ser diferente a la actual.', 'PASSWORD_REUSED');
    data.passwordHash = await hashPassword(newPassword);
    data.passwordChangedAt = new Date();
    changes.push('password');
  }
  if (!changes.length) throw new AppError(400, 'No hay cambios para guardar.', 'NO_CHANGES');

  const updated = await prisma.user.update({ where: { id: user.id }, data, include: userInclude });
  let revoked = 0;
  if (changes.includes('password')) ({ count: revoked } = await revokeAllForUser(user.id, 'PASSWORD_CHANGED', req.authSession.id));

  await audit(req, 'PROFILE_CREDENTIALS_UPDATED', {
    entity: 'User', entityId: user.id,
    details: { changes, ...(changes.includes('email') ? { from: maskEmail(currentEmail), to: maskEmail(newEmail) } : {}), otherSessionsRevoked: revoked },
  });
  res.json({ message: 'Credenciales actualizadas.', changes, user: toUserDTO(updated, { withPermissions: true }) });
}

module.exports = { getProfile, updateCredentials };
