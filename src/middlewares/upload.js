'use strict';
const multer = require('multer');
const env = require('../config/env');

// Memoria: el archivo se inspecciona (magic bytes) ANTES de tocar el disco
module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1, fields: 5 },
});
