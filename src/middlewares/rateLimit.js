'use strict';
const rateLimit = require('express-rate-limit');

const handler = (req, res) => res.status(429).json({
  error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Espera unos minutos e intenta de nuevo.' },
});

const loginLimiter = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, handler });
const recoveryLimiter = rateLimit({ windowMs: 15 * 60000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, handler });
const apiLimiter = rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, handler });

const exportLimiter = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, handler });
const faultLimiter = rateLimit({ windowMs: 10 * 60000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, handler });

module.exports = { loginLimiter, recoveryLimiter, apiLimiter, exportLimiter, faultLimiter };
