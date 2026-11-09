'use strict';
const prisma = require('../lib/prisma');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { getSettings } = require('../services/settings.service');
const { verifyToken, signToken, setAuthCookie, clearAuthCookie, setSessionHeaders, revokeSession } = require('../services/session.service');
const { userInclude, collectPermissions } = require('../utils/userDto');

const TOUCH_THROTTLE_MS = 15000;

/**
 * Autenticación por cookie HTTPOnly + sesión de servidor.
 *  - touch=true  : la petición cuenta como actividad (renueva JWT y lastActivityAt).
 *  - touch=false : consulta de estado; no extiende la sesión (para polling del frontend).
 */
function authenticate({ touch = true } = {}) {
  return async (req, res, next) => {
    try {
      const token = req.cookies?.[env.cookieName];
      if (!token) throw new AppError(401, 'Debes iniciar sesión para acceder a este recurso.', 'AUTH_REQUIRED');

      let payload;
      try {
        payload = verifyToken(token);
      } catch (err) {
        clearAuthCookie(res);
        if (err.name === 'TokenExpiredError') throw new AppError(401, 'Tu token expiró por inactividad. Inicia sesión de nuevo.', 'TOKEN_EXPIRED');
        throw new AppError(401, 'Token de sesión inválido.', 'TOKEN_INVALID');
      }

      const session = await prisma.session.findUnique({
        where: { id: payload.sid },
        include: { user: { include: userInclude } },
      });
      if (!session || session.userId !== payload.sub || session.revokedAt) {
        clearAuthCookie(res);
        throw new AppError(401, 'La sesión fue cerrada o revocada.', 'SESSION_REVOKED');
      }

      const now = Date.now();
      const settings = await getSettings();
      if (session.expiresAt.getTime() <= now) {
        await revokeSession(session.id, 'ABSOLUTE_EXPIRY');
        clearAuthCookie(res);
        throw new AppError(401, 'La sesión alcanzó su duración máxima.', 'SESSION_EXPIRED');
      }
      if (now - session.lastActivityAt.getTime() > settings.sessionIdleMinutes * 60000) {
        await revokeSession(session.id, 'IDLE_TIMEOUT');
        clearAuthCookie(res);
        throw new AppError(401, 'La sesión expiró por inactividad.', 'SESSION_EXPIRED');
      }
      const { user } = session;
      if (!user.isActive) {
        await revokeSession(session.id, 'USER_DISABLED');
        clearAuthCookie(res);
        throw new AppError(403, 'La cuenta está desactivada.', 'ACCOUNT_DISABLED');
      }

      if (touch) {
        let lastActivityAt = session.lastActivityAt;
        if (now - lastActivityAt.getTime() > TOUCH_THROTTLE_MS) {
          lastActivityAt = new Date(now);
          await prisma.session.update({ where: { id: session.id }, data: { lastActivityAt } });
        }
        // Expiración deslizante: cada petición activa reemite el JWT con el TTL vigente
        setAuthCookie(res, signToken(user.id, session.id, settings.tokenTtlMinutes), settings);
        setSessionHeaders(res, settings, lastActivityAt);
      } else {
        res.setHeader('X-Token-Expires-At', new Date(payload.exp * 1000).toISOString());
        res.setHeader('X-Session-Idle-Expires-At', new Date(session.lastActivityAt.getTime() + settings.sessionIdleMinutes * 60000).toISOString());
      }

      req.user = {
        id: user.id,
        username: user.username,
        roles: user.roles.map((ur) => ur.role.name),
        permissions: collectPermissions(user),
        raw: user,
      };
      req.authSession = { id: session.id, createdAt: session.createdAt, lastActivityAt: session.lastActivityAt, tokenExp: payload.exp };
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { authenticate, requireAuth: authenticate() };
