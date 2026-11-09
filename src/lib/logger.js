'use strict';
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const env = require('../config/env');

fs.mkdirSync(env.logDir, { recursive: true });

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: env.isProd ? 'info' : 'debug',
  format: fileFormat,
  defaultMeta: { service: 'predisys-api' },
  transports: [
    new winston.transports.File({ filename: path.join(env.logDir, 'error.log'), level: 'error', maxsize: 5 * 1024 * 1024, maxFiles: 5 }),
    new winston.transports.File({ filename: path.join(env.logDir, 'combined.log'), maxsize: 10 * 1024 * 1024, maxFiles: 5 }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, stack }) => `${timestamp} ${level} ${message}${stack ? `\n${stack}` : ''}`)
      ),
    }),
  ],
  exitOnError: false,
});

logger.errorLogPath = path.join(env.logDir, 'error.log');

module.exports = logger;
