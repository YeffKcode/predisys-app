'use strict';
const { Prisma } = require('@prisma/client');
const multer = require('multer');
const logger = require('../lib/logger');
const env = require('../config/env');

function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Ocurrió un error interno. Se registró en el log de errores.';
  let details;

  if (err.name === 'AppError') {
    ({ status, code, message, details } = err);
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE'
      ? `El archivo supera el máximo de ${Math.round(env.maxUploadBytes / 1048576)} MB.`
      : `Error en la carga del archivo: ${err.message}`;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') { status = 409; code = 'DUPLICATE'; message = 'Ya existe un registro con ese valor único.'; details = { fields: err.meta?.target }; }
    else if (err.code === 'P2025') { status = 404; code = 'NOT_FOUND'; message = 'El recurso no existe.'; }
    else if (err.code === 'P2003') { status = 409; code = 'FK_CONSTRAINT'; message = 'El recurso está referenciado por otros datos.'; }
  } else if (err.type === 'entity.parse.failed') {
    status = 400; code = 'INVALID_JSON'; message = 'El cuerpo de la solicitud no es JSON válido.';
  } else if (err.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'La solicitud es demasiado grande.';
  }

  if (status >= 500) {
    logger.error(err.message, {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id ?? null,
      ip: req.ip,
      stack: err.stack,
    });
  } else {
    logger.debug(`${status} ${code} ${req.method} ${req.originalUrl}: ${message}`);
  }

  if (res.headersSent) return res.end();
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: req.id } });
}

module.exports = { notFound, errorHandler };
