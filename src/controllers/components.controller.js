'use strict';
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { audit } = require('../services/audit.service');

async function addComponent(req, res) {
  const { id: machineId } = req.v.params;
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true, code: true } });
  if (!machine) throw new AppError(404, 'Máquina no encontrada.', 'NOT_FOUND');
  const component = await prisma.component.create({ data: { ...req.body, machineId } });
  await audit(req, 'COMPONENT_ADDED', { entity: 'Component', entityId: component.id, details: { machine: machine.code, type: component.type, model: component.model } });
  res.status(201).json({ component });
}

async function updateComponent(req, res) {
  const { id } = req.v.params;
  const before = await prisma.component.findUnique({ where: { id }, include: { machine: { select: { code: true } } } });
  if (!before) throw new AppError(404, 'Componente no encontrado.', 'NOT_FOUND');
  const component = await prisma.component.update({ where: { id }, data: req.body });
  await audit(req, 'COMPONENT_UPDATED', {
    entity: 'Component', entityId: id,
    details: { machine: before.machine.code, before: { type: before.type, model: before.model, status: before.status, serialNumber: before.serialNumber }, after: req.body },
  });
  res.json({ component });
}

async function deleteComponent(req, res) {
  const { id } = req.v.params;
  const component = await prisma.component.findUnique({ where: { id }, include: { machine: { select: { code: true } } } });
  if (!component) throw new AppError(404, 'Componente no encontrado.', 'NOT_FOUND');
  await prisma.component.delete({ where: { id } });
  await audit(req, 'COMPONENT_DELETED', { entity: 'Component', entityId: id, details: { machine: component.machine.code, type: component.type, model: component.model } });
  res.json({ message: 'Componente eliminado.' });
}

module.exports = { addComponent, updateComponent, deleteComponent };
