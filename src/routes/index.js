'use strict';
const express = require('express');
const { z } = require('zod');
const h = require('../utils/asyncHandler');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');
const S = require('../utils/schemas');
const { requireAuth, authenticate } = require('../middlewares/auth');
const { requirePermission: can } = require('../middlewares/rbac');
const { loginLimiter, recoveryLimiter, exportLimiter, faultLimiter } = require('../middlewares/rateLimit');

const auth = require('../controllers/auth.controller');
const profile = require('../controllers/profile.controller');
const users = require('../controllers/adminUsers.controller');
const rbac = require('../controllers/rbac.controller');
const auditCtl = require('../controllers/audit.controller');
const settings = require('../controllers/settings.controller');
const system = require('../controllers/system.controller');
const machines = require('../controllers/machines.controller');
const components = require('../controllers/components.controller');
const telemetry = require('../controllers/telemetry.controller');
const attachments = require('../controllers/attachments.controller');
const alertsCtl = require('../controllers/alerts.controller');
const notif = require('../controllers/notifications.controller');
const faultsCtl = require('../controllers/faults.controller');
const reportsCtl = require('../controllers/reports.controller');
const mlCtl = require('../controllers/ml.controller');
const notifStatus = require('../controllers/notificationStatus.controller');

const router = express.Router();
const P = (schema) => validate(schema, 'params');
const Q = (schema) => validate(schema, 'query');
const B = (schema) => validate(schema, 'body');

// ── Público ──
router.get('/health', h(system.health));
router.post('/auth/register', recoveryLimiter, B(S.register), h(auth.register));
router.post('/auth/login', loginLimiter, B(S.login), h(auth.login));
router.post('/auth/forgot-password', recoveryLimiter, B(S.forgotPassword), h(auth.forgotPassword));
router.post('/auth/reset-password', recoveryLimiter, B(S.resetPassword), h(auth.resetPassword));

// ── Sesión ──
router.get('/auth/session-status', authenticate({ touch: false }), h(auth.sessionStatus));
router.use(requireAuth); // todo lo de abajo exige sesión válida

router.get('/auth/me', h(auth.me));
router.post('/auth/logout', h(auth.logout));
router.post('/auth/logout-all', h(auth.logoutAll));
router.get('/auth/sessions', h(auth.listSessions));
router.delete('/auth/sessions/:id', P(S.idParam), h(auth.revokeOwnSession));

// ── Perfil ──
router.get('/profile', h(profile.getProfile));
router.patch('/profile/credentials', B(S.profileCredentials), h(profile.updateCredentials));

// ── Preferencias de notificación (correo / SMS) ──
router.get('/profile/notifications', h(notif.get));
router.put('/profile/notifications', B(S.notificationPrefs), h(notif.update));
router.post('/profile/notifications/phone', recoveryLimiter, B(S.phone), h(notif.requestPhoneCode));
router.post('/profile/notifications/phone/verify', recoveryLimiter, B(S.phoneCode), h(notif.verifyPhone));
router.delete('/profile/notifications/phone', h(notif.removePhone));
router.post('/profile/notifications/test', recoveryLimiter, B(S.testNotification), h(notif.test));

// ── Alertas ──
router.get('/alerts', can('alerts.read'), Q(S.alertQuery), h(alertsCtl.list));
router.get('/alerts/summary', can('alerts.read'), h(alertsCtl.summary));
router.get('/alerts/stream', can('alerts.read'), alertsCtl.stream);
router.get('/alerts/:id', can('alerts.read'), P(S.idParam), h(alertsCtl.get));
router.get('/alerts/:id/verify', can('alerts.read'), P(S.idParam), h(alertsCtl.verify));
router.post('/alerts/:id/acknowledge', can('alerts.manage'), P(S.idParam), h(alertsCtl.acknowledge));
router.post('/alerts/:id/resolve', can('alerts.manage'), P(S.idParam), B(S.resolveAlert), h(alertsCtl.resolve));
router.post('/alerts/:id/anchor', can('alerts.manage'), P(S.idParam), h(alertsCtl.retryAnchor));
router.post('/alerts/:id/notify', can('alerts.manage'), P(S.idParam), h(alertsCtl.resend));
router.get('/admin/notifications/status', can('settings.manage'), h(notifStatus.status));
router.get('/admin/blockchain/status', can('settings.manage'), h(alertsCtl.chainStatus));

// ── Administración de usuarios ──
router.get('/admin/users', can('users.read'), h(users.listUsers));
router.post('/admin/users', can('users.write'), B(S.adminCreateUser), h(users.createUser));
router.patch('/admin/users/:id', can('users.write'), P(S.idParam), B(S.adminUpdateUser), h(users.updateUser));
router.put('/admin/users/:id/roles', can('roles.manage'), P(S.idParam), B(S.setUserRoles), h(users.setUserRoles));
router.put('/admin/users/:id/password', can('users.write'), P(S.idParam), B(S.adminSetPassword), h(users.adminSetPassword));
router.post('/admin/users/:id/unlock', can('users.write'), P(S.idParam), h(users.unlockUser));
router.delete('/admin/users/:id/sessions', can('users.write'), P(S.idParam), h(users.revokeUserSessions));

// ── RBAC ──
router.get('/admin/permissions', can('roles.manage'), h(rbac.listPermissions));
router.get('/admin/roles', can('roles.manage'), h(rbac.listRoles));
router.post('/admin/roles', can('roles.manage'), B(S.createRole), h(rbac.createRole));
router.patch('/admin/roles/:id', can('roles.manage'), P(S.intIdParam), B(S.updateRole), h(rbac.updateRole));
router.put('/admin/roles/:id/permissions', can('roles.manage'), P(S.intIdParam), B(S.setRolePermissions), h(rbac.setRolePermissions));
router.post('/admin/roles/:id/users', can('roles.manage'), P(S.intIdParam), B(S.assignRoleUsers), h(rbac.assignRoleToUsers));
router.delete('/admin/roles/:id/users/:userId', can('roles.manage'),
  P(z.object({ id: z.coerce.number().int().positive(), userId: z.string().uuid() })), h(rbac.removeRoleFromUser));
router.delete('/admin/roles/:id', can('roles.manage'), P(S.intIdParam), h(rbac.deleteRole));

// ── Auditoría ──
router.get('/audit', can('audit.read'), Q(S.auditQuery), h(auditCtl.listAuditLogs));
router.get('/audit/stream', can('audit.read'), auditCtl.streamAuditLogs);

// ── Configuración y sistema ──
router.get('/admin/settings', can('settings.manage'), h(settings.get));
router.put('/admin/settings', can('settings.manage'), B(S.updateSettings), h(settings.update));
router.post('/admin/system/force-error', can('system.debug'), Q(S.forceErrorQuery), h(system.forceError));
router.get('/admin/system/error-logs', can('system.debug'), Q(S.errorLogQuery), h(system.readErrorLog));

// ── Flota ──
router.get('/machines', can('machines.read'), h(machines.listMachines));
router.get('/machines/kpis', can('machines.read'), h(machines.fleetKpis));
router.get('/machines/:id', can('machines.read'), P(S.idParam), h(machines.getMachine));
router.post('/machines', can('machines.write'), B(S.createMachine), h(machines.createMachine));
router.patch('/machines/:id', can('machines.write'), P(S.idParam), B(S.updateMachine), h(machines.updateMachine));
router.delete('/machines/:id', can('machines.write'), P(S.idParam), h(machines.deleteMachine));
router.post('/machines/:id/analyze', can('telemetry.read'), P(S.idParam), h(machines.analyzeMachine));
router.post('/machines/:id/components', can('components.write'), P(S.idParam), B(S.createComponent), h(components.addComponent));
router.patch('/components/:id', can('components.write'), P(S.idParam), B(S.updateComponent), h(components.updateComponent));
router.delete('/components/:id', can('components.write'), P(S.idParam), h(components.deleteComponent));

// ── Laboratorio de fallas de prueba ──
router.post('/machines/:id/fault-injections', can('faults.inject'), faultLimiter, P(S.idParam), B(S.faultInjection), h(faultsCtl.inject));
router.post('/machines/:id/baseline', can('telemetry.write'), faultLimiter, P(S.idParam), B(S.baseline), h(faultsCtl.baseline));
router.delete('/machines/:id/test-data', can('faults.inject'), P(S.idParam), h(faultsCtl.clear));
router.get('/fault-injections', can('telemetry.read'), Q(S.faultQuery), h(faultsCtl.list));
router.get('/fault-injections/:id', can('telemetry.read'), P(S.idParam), h(faultsCtl.get));

// ── Informes ──
router.get('/reports/fleet.pdf', can('reports.export'), exportLimiter, h(reportsCtl.fleetPdf));
router.get('/reports/telemetry.csv', can('reports.export'), exportLimiter, Q(S.csvQuery), h(reportsCtl.telemetryCsv));

// ── Modelo ML ──
router.get('/ml/model', can('telemetry.read'), h(mlCtl.model));

// ── Telemetría ──
router.post('/telemetry', can('telemetry.write'), B(S.telemetry), h(telemetry.ingest));
router.get('/telemetry/:machineId', can('telemetry.read'), P(S.machineIdParam), Q(S.telemetryQuery), h(telemetry.history));

// ── Adjuntos ──
router.get('/machines/:id/attachments', can('machines.read'), P(S.idParam), h(attachments.list));
router.post('/machines/:id/attachments', can('files.upload'), P(S.idParam), upload.single('file'), h(attachments.upload));
router.get('/attachments/:id', can('machines.read'), P(S.idParam), h(attachments.download));
router.delete('/attachments/:id', can('files.upload'), P(S.idParam), h(attachments.remove));

module.exports = router;
