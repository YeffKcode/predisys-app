'use strict';
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { encrypt, hashEmail } = require('../src/lib/crypto');
const { hashPassword, validatePasswordPolicy } = require('../src/lib/password');

const prisma = new PrismaClient();

const PERMISSIONS = [
  ['users.read', 'Ver usuarios'],
  ['users.write', 'Crear, editar, desbloquear usuarios y cambiar contraseñas'],
  ['roles.manage', 'Gestionar roles, permisos y asignaciones'],
  ['audit.read', 'Ver registros de auditoría'],
  ['settings.manage', 'Ajustar expiración de sesión y token'],
  ['system.debug', 'Forzar errores y leer error.log'],
  ['machines.read', 'Ver flota, KPIs y adjuntos'],
  ['machines.write', 'Crear, editar y eliminar máquinas'],
  ['components.write', 'Agregar, modificar y eliminar componentes'],
  ['telemetry.read', 'Ver telemetría y ejecutar análisis'],
  ['telemetry.write', 'Ingerir telemetría'],
  ['files.upload', 'Subir y eliminar adjuntos'],
  ['alerts.read', 'Ver alertas, verificar su integridad y recibir notificaciones'],
  ['alerts.manage', 'Reconocer, resolver, reenviar y reanclar alertas; recibir escalamientos'],
  ['faults.inject', 'Inyectar fallas de prueba para evaluar el modelo y limpiar datos sintéticos'],
  ['reports.export', 'Exportar informes PDF de flota y telemetría en CSV'],
];

const ROLES = {
  ADMIN: { description: 'Control total de la plataforma', isSystem: true, perms: PERMISSIONS.map(([k]) => k) },
  OPERATOR: { description: 'Monitoreo de la flota (solo lectura)', isSystem: true, perms: ['machines.read', 'telemetry.read', 'alerts.read', 'reports.export'] },
  TECHNICIAN: { description: 'Mantenimiento de hardware', isSystem: false, perms: ['machines.read', 'machines.write', 'components.write', 'telemetry.read', 'telemetry.write', 'files.upload', 'alerts.read', 'alerts.manage', 'faults.inject', 'reports.export'] },
  AUDITOR: { description: 'Revisión de auditoría', isSystem: false, perms: ['audit.read', 'users.read', 'machines.read', 'alerts.read', 'reports.export'] },
};

const GPU_MODELS = ['NVIDIA RTX 3080', 'NVIDIA RTX 3070', 'NVIDIA RTX 3090', 'AMD RX 6800 XT'];

async function main() {
  for (const [key, description] of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
  const perms = await prisma.permission.findMany();
  const permId = Object.fromEntries(perms.map((p) => [p.key, p.id]));

  for (const [name, cfg] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({ where: { name }, update: { description: cfg.description, isSystem: cfg.isSystem }, create: { name, description: cfg.description, isSystem: cfg.isSystem } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: cfg.perms.map((k) => ({ roleId: role.id, permissionId: permId[k] })) });
  }

  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@predisys.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Pr3d!Sys!Adm2026';
  const errors = validatePasswordPolicy(password, { username, email });
  if (errors.length) throw new Error(`SEED_ADMIN_PASSWORD no cumple la política: ${errors.join(' ')}`);

  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    await prisma.user.create({
      data: {
        username, emailHash: hashEmail(email), emailEnc: encrypt(email), fullNameEnc: encrypt('Administrador PrediSys'),
        passwordHash: await hashPassword(password),
        roles: { create: [{ roleId: adminRole.id }] },
      },
    });
    console.log(`✔ Usuario administrador creado: ${username} / ${email}`);
  } else {
    console.log(`· El usuario ${username} ya existe: su contraseña NO se modificó. Para restablecerla: npm run admin:reset`);
  }
  const admin = await prisma.user.findUnique({ where: { username } });
  await prisma.notificationPreference.upsert({
    where: { userId: admin.id }, update: {},
    create: { userId: admin.id, emailEnabled: true, smsEnabled: false, minSeverity: 'WARNING' },
  });

  for (const [key, value] of [['tokenTtlMinutes', process.env.DEFAULT_TOKEN_TTL_MINUTES || 15], ['sessionIdleMinutes', process.env.DEFAULT_SESSION_IDLE_MINUTES || 30], ['maxConcurrentSessions', process.env.DEFAULT_MAX_CONCURRENT_SESSIONS || 5]]) {
    await prisma.systemSetting.upsert({ where: { key }, update: {}, create: { key, value: String(value) } });
  }

  for (let i = 1; i <= 10; i++) {
    const code = `Rig-${String(i).padStart(2, '0')}`;
    if (await prisma.machine.findUnique({ where: { code } })) continue;
    const gpuModel = GPU_MODELS[i % GPU_MODELS.length];
    const machine = await prisma.machine.create({
      data: {
        code, name: `Rig de minería ${i}`, location: `Rack ${Math.ceil(i / 4)} - Bahía ${((i - 1) % 4) + 1}`, status: 'ONLINE',
        components: {
          create: [
            ...Array.from({ length: 6 }, (_, g) => ({ type: 'GPU', model: gpuModel, serialNumber: `GPU-${i}${g}-${1000 + i * 10 + g}`, specs: { vramGb: gpuModel.includes('3090') ? 24 : gpuModel.includes('6800') ? 16 : 10, slot: g + 1 } })),
            { type: 'PSU', model: 'Corsair HX1600i', serialNumber: `PSU-${i}-0001`, specs: { watts: 1600, efficiency: '80 Plus Platinum' } },
            { type: 'COOLING', model: 'Arctic P12 x6', serialNumber: `FAN-${i}-0001`, specs: { fans: 6, maxRpm: 4000 } },
            { type: 'MOTHERBOARD', model: 'ASUS B250 Mining Expert', serialNumber: `MB-${i}-0001`, specs: { pcieSlots: 19 } },
          ],
        },
      },
    });
    // Línea base de telemetría (5 min entre lecturas). Rig-07 muestra degradación: más RPM para la misma temperatura.
    const degrading = code === 'Rig-07';
    const now = Date.now();
    await prisma.telemetryLog.createMany({
      data: Array.from({ length: 36 }, (_, k) => {
        const drift = degrading ? k / 35 : 0;
        return {
          machineId: machine.id,
          recordedAt: new Date(now - (35 - k) * 5 * 60000),
          temperature: Number((68 + Math.random() * 4 + drift * 6).toFixed(1)),
          powerKw: Number((1.35 + Math.random() * 0.08 + drift * 0.15).toFixed(3)),
          fanRpm: Math.round(2000 + Math.random() * 150 + drift * 1000),
          hashrate: Number((580 + Math.random() * 20 - drift * 90).toFixed(1)),
        };
      }),
    });
    console.log(`✔ ${code} creado con 9 componentes y 36 lecturas`);
  }
}

main()
  .then(() => console.log('Seed completado.'))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
