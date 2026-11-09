'use strict';
const ml = require('../services/ml.service');

async function model(req, res) {
  const info = await ml.modelInfo();
  res.json({ model: info, tokenFingerprint: ml.tokenFingerprint() });
}

module.exports = { model };
