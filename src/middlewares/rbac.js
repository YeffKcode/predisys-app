'use strict';
const AppError = require('../utils/AppError');
const { audit } = require('../services/audit.service');

/** Exige que el usuario tenga TODOS los permisos indicados. */
const requirePermission = (...keys) => async (req, res, next) => {
  const missing = keys.filter((k) => !req.user?.permissions?.has(k));
  if (missing.length === 0) return next();
  await audit(req, 'ACCESS_DENIED', { entity: 'Route', entityId: `${req.method} ${req.originalUrl}`.slice(0, 64), details: { missing } });
  next(new AppError(403, 'No tienes permisos para realizar esta acción.', 'FORBIDDEN', { missing }));
};

module.exports = { requirePermission };
