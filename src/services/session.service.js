'use strict';
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const env = require('../config/env');
const { getSettings } = require('./settings.service');
const { getIp, getUserAgent } = require('../utils/request');

const JWT_OPTS = { algorithm: 'HS256', issuer: 'predisys', audience: 'predisys-web' };

const cookieOptions = () => ({ httpOnly: true, secure: env.cookieSecure, sameSite: 'strict', path: '/' });

function signToken(userId, sessionId, ttlMinutes) {
  return jwt.sign({ sub: userId, sid: sessionId }, env.jwtSecret, { ...JWT_OPTS, expiresIn: ttlMinutes * 60 });
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret, { algorithms: [JWT_OPTS.algorithm], issuer: JWT_OPTS.issuer, audience: JWT_OPTS.audience });
}

function setSessionHeaders(res, settings, lastActivityAt = new Date()) {
  res.setHeader('X-Token-Expires-At', new Date(Date.now() + settings.tokenTtlMinutes * 60000).toISOString());
  res.setHeader('X-Session-Idle-Expires-At', new Date(lastActivityAt.getTime() + settings.sessionIdleMinutes * 60000).toISOString());
}

function setAuthCookie(res, token, settings) {
  res.cookie(env.cookieName, token, { ...cookieOptions(), maxAge: settings.tokenTtlMinutes * 60000 });
  setSessionHeaders(res, settings);
}

function clearAuthCookie(res) {
  res.clearCookie(env.cookieName, cookieOptions());
}

/** Crea una sesión independiente; si se supera el máximo de concurrentes, revoca las más antiguas. */
async function createSession(user, req, res) {
  const settings = await getSettings();
  const now = new Date();
  const active = await prisma.session.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const excess = active.length - settings.maxConcurrentSessions + 1;
  if (excess > 0) {
    await prisma.session.updateMany({
      where: { id: { in: active.slice(0, excess).map((s) => s.id) } },
      data: { revokedAt: now, revokedReason: 'CONCURRENCY_LIMIT' },
    });
  }
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      ip: getIp(req),
      userAgent: getUserAgent(req),
      expiresAt: new Date(now.getTime() + env.absoluteSessionHours * 3600000),
    },
  });
  setAuthCookie(res, signToken(user.id, session.id, settings.tokenTtlMinutes), settings);
  return { session, settings, revokedForConcurrency: Math.max(0, excess) };
}

const revokeSession = (id, reason) =>
  prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });

const revokeAllForUser = (userId, reason, exceptSessionId) =>
  prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });

module.exports = {
  signToken, verifyToken, setAuthCookie, clearAuthCookie, setSessionHeaders,
  createSession, revokeSession, revokeAllForUser,
};
