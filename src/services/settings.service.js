'use strict';
const prisma = require('../lib/prisma');
const env = require('../config/env');

const DEFAULTS = { ...env.defaults };
const CACHE_MS = 5000;
let cache = null;
let cachedAt = 0;

async function getSettings() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: Object.keys(DEFAULTS) } } });
  const settings = { ...DEFAULTS };
  for (const row of rows) {
    const n = Number(row.value);
    if (Number.isFinite(n)) settings[row.key] = n;
  }
  cache = settings;
  cachedAt = Date.now();
  return settings;
}

async function updateSettings(patch, userId) {
  const entries = Object.entries(patch).filter(([k, v]) => k in DEFAULTS && v !== undefined);
  await prisma.$transaction(entries.map(([key, value]) => prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: String(value), updatedBy: userId },
    update: { value: String(value), updatedBy: userId },
  })));
  cache = null;
  return getSettings();
}

module.exports = { getSettings, updateSettings, DEFAULTS };
