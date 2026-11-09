'use strict';
const getIp = (req) => (req ? String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64) : null);
const getUserAgent = (req) => (req ? String(req.get?.('user-agent') || '').slice(0, 255) : null);
module.exports = { getIp, getUserAgent };
