'use strict';
const { PrismaClient } = require('@prisma/client');

const prisma = global.__predisysPrisma || new PrismaClient({ log: ['warn', 'error'] });
if (process.env.NODE_ENV !== 'production') global.__predisysPrisma = prisma;

module.exports = prisma;
