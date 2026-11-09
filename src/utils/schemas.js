'use strict';
const { z } = require('zod');

// Texto libre seguro: letras (incl. tildes), números, espacios y puntuación básica. Bloquea < > ' " ; ` { } $ \ etc.
const SAFE_TEXT = /^[\p{L}\p{N} .,:()#/_\-+°%]*$/u;
const safeText = (max) => z.string().trim().max(max).regex(SAFE_TEXT, 'Contiene caracteres no permitidos.');

const username = z.string().trim().min(3, 'Mínimo 3 caracteres.').max(40)
  .regex(/^[A-Za-z0-9._-]+$/, 'El usuario solo admite letras, números, punto, guion y guion bajo.');
const email = z.string().trim().toLowerCase().max(254)
  .regex(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/, 'Correo electrónico inválido.');
// Campo "usuario o correo" del login: rechaza ráfagas de caracteres especiales (!@#$%^&*()<>{}' …)
const identifier = z.string().trim().min(3, 'Ingresa tu usuario o correo.').max(254)
  .regex(/^[A-Za-z0-9._%+-]+(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?$/, 'El usuario o correo contiene caracteres no permitidos.');
const passwordInput = z.string().min(1, 'La contraseña es obligatoria.').max(128);
const uuid = z.string().uuid('Identificador inválido.');
const intId = z.coerce.number().int().positive();
const idList = z.array(z.number().int().positive()).max(50);

const schemas = {
  idParam: z.object({ id: uuid }),
  intIdParam: z.object({ id: intId }),
  machineIdParam: z.object({ machineId: uuid }),

  register: z.object({
    username, email, password: passwordInput,
    fullName: safeText(100).optional(),
  }),
  login: z.object({ identifier, password: passwordInput }),
  forgotPassword: z.object({ email }),
  resetPassword: z.object({
    email,
    code: z.string().trim().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.'),
    newPassword: passwordInput,
  }),
  profileCredentials: z.object({
    currentPassword: passwordInput,
    newEmail: email.optional(),
    newPassword: passwordInput.optional(),
  }).refine((d) => d.newEmail || d.newPassword, { message: 'Indica un nuevo correo o una nueva contraseña.' }),

  adminCreateUser: z.object({
    username, email, password: passwordInput,
    fullName: safeText(100).optional(),
    roleIds: idList.default([]),
  }),
  adminUpdateUser: z.object({
    isActive: z.boolean().optional(),
    fullName: safeText(100).optional(),
  }).refine((d) => Object.keys(d).length > 0, { message: 'Nada que actualizar.' }),
  adminSetPassword: z.object({ newPassword: z.string().max(128) }),
  setUserRoles: z.object({ roleIds: idList }),

  createRole: z.object({
    name: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9_ -]+$/, 'Nombre de rol inválido.')
      .transform((s) => s.toUpperCase().replace(/[ -]+/g, '_')),
    description: safeText(255).optional(),
    permissionIds: idList.default([]),
  }),
  updateRole: z.object({
    name: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9_ -]+$/, 'Nombre de rol inválido.')
      .transform((s) => s.toUpperCase().replace(/[ -]+/g, '_')).optional(),
    description: safeText(255).optional(),
  }).refine((d) => Object.keys(d).length > 0, { message: 'Nada que actualizar.' }),
  setRolePermissions: z.object({ permissionIds: idList }),
  assignRoleUsers: z.object({ userIds: z.array(uuid).min(1).max(100) }),

  updateSettings: z.object({
    tokenTtlMinutes: z.number().int().min(1).max(1440).optional(),
    sessionIdleMinutes: z.number().int().min(1).max(1440).optional(),
    maxConcurrentSessions: z.number().int().min(1).max(20).optional(),
  }).refine((d) => Object.keys(d).length > 0, { message: 'Indica al menos un parámetro.' }),

  auditQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    action: z.string().trim().regex(/^[A-Z_]+$/).max(80).optional(),
    actorId: uuid.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
  errorLogQuery: z.object({ lines: z.coerce.number().int().min(1).max(500).default(100) }),
  forceErrorQuery: z.object({ type: z.enum(['sync', 'async', 'database']).default('sync') }),

  createMachine: z.object({
    code: z.string().trim().regex(/^Rig-\d{2,3}$/, 'Formato de código: Rig-01 … Rig-999.'),
    name: safeText(80).min(1, 'El nombre es obligatorio.'),
    location: safeText(120).optional(),
    status: z.enum(['ONLINE', 'OFFLINE', 'MAINTENANCE']).default('ONLINE'),
  }),
  updateMachine: z.object({
    code: z.string().trim().regex(/^Rig-\d{2,3}$/, 'Formato de código: Rig-01 … Rig-999.').optional(),
    name: safeText(80).min(1).optional(),
    location: safeText(120).optional(),
    status: z.enum(['ONLINE', 'OFFLINE', 'MAINTENANCE']).optional(),
  }).refine((d) => Object.keys(d).length > 0, { message: 'Nada que actualizar.' }),

  createComponent: z.object({
    type: z.enum(['GPU', 'PSU', 'COOLING', 'MOTHERBOARD', 'OTHER']),
    model: safeText(100).min(1, 'El modelo es obligatorio.'),
    serialNumber: z.string().trim().max(60).regex(/^[A-Za-z0-9_-]*$/, 'Serial inválido.').optional(),
    specs: z.record(z.string().regex(/^[A-Za-z0-9_]{1,40}$/), z.union([safeText(100), z.number()]))
      .refine((o) => Object.keys(o).length <= 20, 'Máximo 20 especificaciones.').optional(),
    status: z.enum(['ACTIVE', 'DEGRADED', 'FAILED', 'REPLACED']).default('ACTIVE'),
  }),
  updateComponent: z.object({
    type: z.enum(['GPU', 'PSU', 'COOLING', 'MOTHERBOARD', 'OTHER']).optional(),
    model: safeText(100).min(1).optional(),
    serialNumber: z.string().trim().max(60).regex(/^[A-Za-z0-9_-]*$/, 'Serial inválido.').optional(),
    specs: z.record(z.string().regex(/^[A-Za-z0-9_]{1,40}$/), z.union([safeText(100), z.number()]))
      .refine((o) => Object.keys(o).length <= 20, 'Máximo 20 especificaciones.').optional(),
    status: z.enum(['ACTIVE', 'DEGRADED', 'FAILED', 'REPLACED']).optional(),
  }).refine((d) => Object.keys(d).length > 0, { message: 'Nada que actualizar.' }),

  telemetry: z.object({
    machineId: uuid,
    temperature: z.number().min(-20).max(150),
    powerKw: z.number().min(0).max(50),
    fanRpm: z.number().int().min(0).max(20000),
    hashrate: z.number().min(0).max(1e6),
    recordedAt: z.coerce.date().optional(),
  }),
  alertQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
    severity: z.enum(['WARNING', 'CRITICAL']).optional(),
    machineId: uuid.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    kind: z.enum(['ALL', 'REAL', 'TEST']).default('ALL'),
  }),
  resolveAlert: z.object({ note: safeText(500).optional() }),

  notificationPrefs: z.object({
    emailEnabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    minSeverity: z.enum(['WARNING', 'CRITICAL']).optional(),
    quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
    quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
  }).refine((d) => Object.keys(d).length > 0, { message: 'Nada que actualizar.' })
    .refine((d) => (d.quietHoursStart === undefined) === (d.quietHoursEnd === undefined), { message: 'Indica inicio y fin del horario silencioso.' }),
  phone: z.object({
    phone: z.string().trim().transform((s) => s.replace(/[\s()-]/g, ''))
      .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Usa formato internacional, ej. +573001234567.')),
  }),
  phoneCode: z.object({ code: z.string().trim().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.') }),
  testNotification: z.object({ channel: z.enum(['EMAIL', 'SMS']) }),

  faultInjection: z.object({
    faultType: z.enum(['THERMAL_PASTE', 'FAN_WEAR', 'PSU_INSTABILITY', 'GPU_DEGRADATION', 'DUST_OBSTRUCTION']),
    intensity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
    steps: z.number().int().min(6).max(40).default(20),
    notify: z.boolean().default(false),
  }),
  faultQuery: z.object({
    machineId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  csvQuery: z.object({
    hours: z.coerce.number().int().min(1).max(168).default(24),
    machineId: uuid.optional(),
    includeSynthetic: z.enum(['true', 'false']).default('false'),
  }),
  baseline: z.object({ readings: z.number().int().min(3).max(24).default(12) }),

  telemetryQuery: z.object({ limit: z.coerce.number().int().min(1).max(1000).default(100) }),
};

module.exports = schemas;
