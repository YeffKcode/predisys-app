'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const logger = require('./lib/logger');
const prisma = require('./lib/prisma');
const requestId = require('./middlewares/requestId');
const sanitize = require('./middlewares/sanitize');
const { apiLimiter } = require('./middlewares/rateLimit');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const routes = require('./routes');
const alertWorker = require('./services/alertWorker');
const mlService = require('./services/ml.service');

fs.mkdirSync(env.uploadDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.trustProxy);

app.use(requestId);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
    },
  },
}));
app.use(cors({
  origin: env.clientOrigin,
  credentials: true,
  exposedHeaders: ['X-Token-Expires-At', 'X-Session-Idle-Expires-At', 'X-Request-Id'],
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(sanitize);

// Nada de la API se cachea: tras logout el botón "atrás" no muestra datos protegidos
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache'); next(); });
app.use('/api', apiLimiter, routes);

// Producción: la API sirve el frontend compilado (client/dist) en el mismo origen
const clientDist = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  logger.info(`Frontend servido desde ${clientDist}`);
}

app.use(notFound);
app.use(errorHandler);

const server = app.listen(env.port, () => {
  logger.info(`PrediSys API escuchando en http://localhost:${env.port} (${env.nodeEnv})`);
  logger.info(`Blockchain: ${env.chain.enabled ? `${env.chain.name} · ${env.chain.registryAddress}` : 'deshabilitado'} · SMS: ${env.sms.provider} · Correo: ${env.smtp.host || 'consola (dev)'}`);
  alertWorker.start();
  mlService.verifyAtStartup();
});

// Captura global de fallos fuera del ciclo de petición
process.on('unhandledRejection', (reason) => {
  logger.error(`unhandledRejection: ${reason?.message || reason}`, { stack: reason?.stack });
});
process.on('uncaughtException', (err) => {
  logger.error(`uncaughtException: ${err.message}`, { stack: err.stack });
  shutdown(1);
});

function shutdown(code = 0) {
  alertWorker.stop();
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(code);
  });
  setTimeout(() => process.exit(code), 5000).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

module.exports = app;
