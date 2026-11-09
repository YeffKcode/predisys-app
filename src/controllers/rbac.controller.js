'use strict';
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { audit } = require('../services/audit.service');

const roleInclude = {
  permissions: { include: { permission: true } },
  users: { include: { user: { select: { id: true, username: true } } } },
};

const toRoleDTO = (r) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  isSystem: r.isSystem,
  permissions: r.permissions.map((rp) => ({ id: rp.permission.id, key: rp.permission.key })),
  users: r.users.map((ur) => ({ id: ur.user.id, username: ur.user.username })),
  createdAt: r.createdAt,
});

async function findRoleOr404(id) {
  const role = await prisma.role.findUnique({ where: { id }, include: roleInclude });
  if (!role) throw new AppError(404, 'Rol no encontrado.', 'NOT_FOUND');
  return role;
}

async function assertPermissionsExist(ids) {
  const unique = [...new Set(ids)];
  const count = await prisma.permission.count({ where: { id: { in: unique } } });
  if (count !== unique.length) throw new AppError(400, 'Uno o más permisos no existen.', 'PERMISSION_NOT_FOUND');
  return unique;
}

async function listPermissions(req, res) {
  res.json({ permissions: await prisma.permission.findMany({ orderBy: { key: 'asc' } }) });
}

async function listRoles(req, res) {
  const roles = await prisma.role.findMany({ include: roleInclude, orderBy: { id: 'asc' } });
  res.json({ roles: roles.map(toRoleDTO) });
}

async function createRole(req, res) {
  const { name, description, permissionIds } = req.body;
  if (await prisma.role.findUnique({ where: { name } })) throw new AppError(409, `El rol ${name} ya existe.`, 'ROLE_EXISTS');
  const ids = await assertPermissionsExist(permissionIds);
  const role = await prisma.role.create({
    data: { name, description, permissions: { create: ids.map((permissionId) => ({ permissionId })) } },
    include: roleInclude,
  });
  await audit(req, 'ROLE_CREATED', { entity: 'Role', entityId: role.id, details: { name, permissions: role.permissions.map((p) => p.permission.key) } });
  res.status(201).json({ role: toRoleDTO(role) });
}

async function updateRole(req, res) {
  const { id } = req.v.params;
  const role = await findRoleOr404(id);
  if (role.isSystem && req.body.name && req.body.name !== role.name) throw new AppError(400, 'Los roles del sistema no se pueden renombrar.', 'SYSTEM_ROLE');
  const updated = await prisma.role.update({ where: { id }, data: req.body, include: roleInclude });
  await audit(req, 'ROLE_UPDATED', { entity: 'Role', entityId: id, details: { before: { name: role.name, description: role.description }, after: req.body } });
  res.json({ role: toRoleDTO(updated) });
}

/** Reemplaza la totalidad de permisos del rol. */
async function setRolePermissions(req, res) {
  const { id } = req.v.params;
  const role = await findRoleOr404(id);
  if (role.name === 'ADMIN') throw new AppError(400, 'Los permisos del rol ADMIN están protegidos.', 'SYSTEM_ROLE');
  const ids = await assertPermissionsExist(req.body.permissionIds);
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: id } }),
    prisma.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: id, permissionId })) }),
  ]);
  const updated = await findRoleOr404(id);
  await audit(req, 'ROLE_PERMISSIONS_UPDATED', {
    entity: 'Role', entityId: id,
    details: { role: role.name, before: role.permissions.map((p) => p.permission.key), after: updated.permissions.map((p) => p.permission.key) },
  });
  res.json({ role: toRoleDTO(updated) });
}

/** Asigna el rol a varios usuarios a la vez (sin quitarles sus otros roles). */
async function assignRoleToUsers(req, res) {
  const { id } = req.v.params;
  const role = await findRoleOr404(id);
  const userIds = [...new Set(req.body.userIds)];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } });
  if (users.length !== userIds.length) throw new AppError(400, 'Uno o más usuarios no existen.', 'USER_NOT_FOUND');
  await prisma.userRole.createMany({ data: userIds.map((userId) => ({ userId, roleId: id, assignedBy: req.user.id })), skipDuplicates: true });
  const updated = await findRoleOr404(id);
  await audit(req, 'ROLE_ASSIGNED_TO_USERS', { entity: 'Role', entityId: id, details: { role: role.name, users: users.map((u) => u.username) } });
  res.json({ role: toRoleDTO(updated) });
}

async function removeRoleFromUser(req, res) {
  const id = Number(req.params.id);
  const { userId } = req.params;
  const role = await findRoleOr404(id);
  if (role.name === 'ADMIN' && userId === req.user.id) throw new AppError(400, 'No puedes quitarte a ti mismo el rol ADMIN.', 'SELF_ACTION');
  const { count } = await prisma.userRole.deleteMany({ where: { roleId: id, userId } });
  if (!count) throw new AppError(404, 'El usuario no tiene este rol.', 'NOT_FOUND');
  await audit(req, 'ROLE_REMOVED_FROM_USER', { entity: 'Role', entityId: id, details: { role: role.name, userId } });
  res.json({ role: toRoleDTO(await findRoleOr404(id)) });
}

async function deleteRole(req, res) {
  const { id } = req.v.params;
  const role = await findRoleOr404(id);
  if (role.isSystem) throw new AppError(400, 'Los roles del sistema no se pueden eliminar.', 'SYSTEM_ROLE');
  await prisma.role.delete({ where: { id } });
  await audit(req, 'ROLE_DELETED', { entity: 'Role', entityId: id, details: { name: role.name, affectedUsers: role.users.map((u) => u.user.username) } });
  res.json({ message: `Rol ${role.name} eliminado.` });
}

module.exports = { listPermissions, listRoles, createRole, updateRole, setRolePermissions, assignRoleToUsers, removeRoleFromUser, deleteRole };
