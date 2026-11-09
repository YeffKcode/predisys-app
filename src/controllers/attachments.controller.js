'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { sha256 } = require('../lib/crypto');
const { inspectFile, sanitizeFileName } = require('../utils/fileSignature');
const { audit } = require('../services/audit.service');

async function upload(req, res) {
  const { id: machineId } = req.v.params;
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true, code: true } });
  if (!machine) throw new AppError(404, 'Máquina no encontrada.', 'NOT_FOUND');
  if (!req.file) throw new AppError(400, 'Adjunta un archivo en el campo "file".', 'FILE_REQUIRED');

  const originalName = sanitizeFileName(req.file.originalname);
  const result = inspectFile(req.file.buffer, originalName, req.file.mimetype);
  if (!result.ok) {
    await audit(req, 'FILE_REJECTED', {
      entity: 'Machine', entityId: machineId,
      details: { fileName: originalName, declaredMime: req.file.mimetype, size: req.file.size, reason: result.reason, sha256: sha256(req.file.buffer) },
    });
    throw new AppError(415, result.reason, 'FILE_REJECTED');
  }

  const storedName = `${crypto.randomUUID()}${result.ext}`;
  await fs.promises.writeFile(path.join(env.uploadDir, storedName), req.file.buffer, { flag: 'wx', mode: 0o640 });
  const attachment = await prisma.attachment.create({
    data: {
      machineId, uploadedById: req.user.id, originalName, storedName,
      mimeType: result.mime, sizeBytes: req.file.size, sha256: sha256(req.file.buffer),
    },
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true },
  });
  await audit(req, 'FILE_UPLOADED', { entity: 'Attachment', entityId: attachment.id, details: { machine: machine.code, fileName: originalName, mime: result.mime, size: req.file.size } });
  res.status(201).json({ attachment });
}

async function list(req, res) {
  const attachments = await prisma.attachment.findMany({
    where: { machineId: req.v.params.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true, uploadedBy: { select: { username: true } } },
  });
  res.json({ attachments });
}

async function download(req, res) {
  const attachment = await prisma.attachment.findUnique({ where: { id: req.v.params.id } });
  if (!attachment) throw new AppError(404, 'Adjunto no encontrado.', 'NOT_FOUND');
  const filePath = path.join(env.uploadDir, attachment.storedName);
  if (!fs.existsSync(filePath)) throw new AppError(404, 'El archivo ya no existe en el almacenamiento.', 'FILE_MISSING');
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(filePath, attachment.originalName);
}

async function remove(req, res) {
  const attachment = await prisma.attachment.findUnique({ where: { id: req.v.params.id } });
  if (!attachment) throw new AppError(404, 'Adjunto no encontrado.', 'NOT_FOUND');
  await prisma.attachment.delete({ where: { id: attachment.id } });
  await fs.promises.unlink(path.join(env.uploadDir, attachment.storedName)).catch(() => {});
  await audit(req, 'FILE_DELETED', { entity: 'Attachment', entityId: attachment.id, details: { fileName: attachment.originalName } });
  res.json({ message: 'Adjunto eliminado.' });
}

module.exports = { upload, list, download, remove };
