'use strict';
const AppError = require('../utils/AppError');

/** Valida req[source] con un esquema zod. El resultado queda en req.v[source] (y reemplaza req.body). */
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.') || source, message: i.message }));
    return next(new AppError(400, details[0]?.message || 'Datos de entrada inválidos.', 'VALIDATION_ERROR', details));
  }
  req.v = req.v || {};
  req.v[source] = result.data;
  if (source === 'body') req.body = result.data;
  next();
};

module.exports = validate;
