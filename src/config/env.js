'use strict';
require('dotenv').config();

const path = require('path');

function fail(msg) {
  console.error(`[config] ${msg}`);
  process.exit(1);
}

const HEX64 = /^[0-9a-fA-F]{64}$/;
for (const key of ['DATABASE_URL', 'JWT_SECRET', 'DATA_ENCRYPTION_KEY', 'EMAIL_HASH_KEY']) {
  if (!process.env[key]) fail(`Falta la variable de entorno obligatoria ${key} (ver .env.example).`);
}
if (!HEX64.test(process.env.DATA_ENCRYPTION_KEY)) fail('DATA_ENCRYPTION_KEY debe tener exactamente 64 caracteres hexadecimales (32 bytes).');
if (process.env.JWT_SECRET.length < 32) fail('JWT_SECRET debe tener al menos 32 caracteres.');

const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

const env = {
  nodeEnv,
  isProd,
  port: int(process.env.PORT, 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  trustProxy: process.env.TRUST_PROXY === 'true' ? 1 : false,

  jwtSecret: process.env.JWT_SECRET,
  encryptionKey: Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'hex'),
  emailHashKey: process.env.EMAIL_HASH_KEY,
  bcryptRounds: Math.max(10, int(process.env.BCRYPT_ROUNDS, 12)),
  cookieName: 'predisys_token',
  cookieSecure: process.env.COOKIE_SECURE === 'true' || isProd,

  lockout: { maxAttempts: 5, minutes: int(process.env.LOCKOUT_MINUTES, 15) },
  resetCode: { ttlMinutes: 15, maxAttempts: 5 },
  absoluteSessionHours: int(process.env.ABSOLUTE_SESSION_HOURS, 12),
  defaults: {
    tokenTtlMinutes: int(process.env.DEFAULT_TOKEN_TTL_MINUTES, 15),
    sessionIdleMinutes: int(process.env.DEFAULT_SESSION_IDLE_MINUTES, 30),
    maxConcurrentSessions: int(process.env.DEFAULT_MAX_CONCURRENT_SESSIONS, 5),
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'PrediSys <no-reply@predisys.local>',
  },

  appUrl: (process.env.APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, ''),

  ml: {
    url: (process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, ''),
    token: process.env.ML_SERVICE_TOKEN || '',
    timeoutMs: int(process.env.ML_TIMEOUT_MS, 5000),
    windowSize: int(process.env.ML_WINDOW_SIZE, 12),
    alertThreshold: Number(process.env.ALERT_THRESHOLD || 0.7),
    warningThreshold: Number(process.env.WARNING_THRESHOLD || 0.4),
  },

  alerts: {
    cooldownMinutes: int(process.env.ALERT_COOLDOWN_MINUTES, 30),
    escalationMinutes: int(process.env.ALERT_ESCALATION_MINUTES, 15),
    workerIntervalSeconds: int(process.env.ALERT_WORKER_INTERVAL_SECONDS, 60),
    timezone: process.env.NOTIFY_TIMEZONE || 'America/Bogota',
    oncallEmails: list(process.env.ALERT_ONCALL_EMAILS),
    oncallPhones: list(process.env.ALERT_ONCALL_PHONES),
    maxNotificationAttempts: 3,
    maxChainAttempts: 5,
  },

  sms: {
    provider: (process.env.SMS_PROVIDER || 'console').toLowerCase(),
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: process.env.TWILIO_FROM || '',
    twilioMessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    snsSenderId: process.env.SNS_SENDER_ID || '',
  },

  chain: {
    enabled: process.env.BLOCKCHAIN_ENABLED === 'true',
    name: process.env.CHAIN_NAME || 'sepolia',
    rpcUrl: process.env.CHAIN_RPC_URL || '',
    chainId: int(process.env.CHAIN_ID, 11155111),
    privateKey: process.env.CHAIN_PRIVATE_KEY || '',
    registryAddress: process.env.ALERT_REGISTRY_ADDRESS || '',
    explorerTxUrl: process.env.CHAIN_EXPLORER_TX_URL || 'https://sepolia.etherscan.io/tx/',
    confirmations: int(process.env.CHAIN_CONFIRMATIONS, 1),
    txTimeoutMs: int(process.env.CHAIN_TX_TIMEOUT_MS, 180000),
  },

  uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
  maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 5) * 1024 * 1024,
  logDir: path.resolve('./logs'),
};

if (env.chain.enabled) {
  if (!env.chain.rpcUrl) fail('BLOCKCHAIN_ENABLED=true requiere CHAIN_RPC_URL.');
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.chain.privateKey)) fail('CHAIN_PRIVATE_KEY debe ser 0x seguido de 64 caracteres hex.');
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.chain.registryAddress)) fail('ALERT_REGISTRY_ADDRESS inválida. Despliega el contrato con: npm run chain:deploy');
  if ([1, 10, 56, 137, 8453, 42161].includes(env.chain.chainId)) fail(`CHAIN_ID ${env.chain.chainId} es una red principal; PrediSys solo opera en Testnet.`);
}
if (!['console', 'twilio', 'sns'].includes(env.sms.provider)) fail('SMS_PROVIDER debe ser console, twilio o sns.');
if (env.sms.provider === 'twilio' && (!env.sms.twilioAccountSid || !env.sms.twilioAuthToken || !(env.sms.twilioFrom || env.sms.twilioMessagingServiceSid))) {
  fail('SMS_PROVIDER=twilio requiere TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_FROM o TWILIO_MESSAGING_SERVICE_SID.');
}
if (!env.ml.token || /CAMBIAR/i.test(env.ml.token)) {
  if (isProd) fail('ML_SERVICE_TOKEN es obligatorio en producción. Ejecuta: npm run init-env');
  console.warn('[config] ML_SERVICE_TOKEN vacío o de ejemplo. Ejecuta "npm run init-env" y reinicia la API y el servicio ML.');
}
if (isProd && env.sms.provider === 'console') fail('En producción SMS_PROVIDER no puede ser console.');
if (isProd && !env.smtp.host) fail('En producción SMTP_HOST es obligatorio para enviar códigos de recuperación.');

module.exports = env;
