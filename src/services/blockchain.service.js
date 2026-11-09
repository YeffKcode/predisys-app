'use strict';
const path = require('path');
const { ethers } = require('ethers');
const env = require('../config/env');
const AppError = require('../utils/AppError');

const ABI = require(path.resolve(__dirname, '../../blockchain/abi.json'));

let provider;
let wallet;
let contract;

const isEnabled = () => env.chain.enabled;

function client() {
  if (!isEnabled()) throw new AppError(503, 'El registro en blockchain está deshabilitado (BLOCKCHAIN_ENABLED=false).', 'CHAIN_DISABLED');
  if (!contract) {
    provider = new ethers.JsonRpcProvider(env.chain.rpcUrl, env.chain.chainId, { staticNetwork: true });
    provider.pollingInterval = 1500;
    wallet = new ethers.Wallet(env.chain.privateKey, provider);
    contract = new ethers.Contract(env.chain.registryAddress, ABI, wallet);
  }
  return { provider, wallet, contract };
}

/** El UUID de la alerta se convierte en bytes32 con keccak256 (determinista y verificable por terceros). */
const alertKey = (alertId) => ethers.id(String(alertId));
const toBytes32 = (sha256Hex) => `0x${sha256Hex}`;
const explorerUrl = (txHash) => (txHash && env.chain.explorerTxUrl ? `${env.chain.explorerTxUrl}${txHash}` : null);

function describeError(err) {
  const decoded = err?.revert?.name || err?.info?.error?.message || err?.shortMessage || err?.message || String(err);
  return String(decoded).slice(0, 250);
}

// Un solo firmante: las transacciones se envían en serie para no reutilizar nonces
let queue = Promise.resolve();
function serialize(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** Envía la transacción y devuelve inmediatamente su hash (la confirmación se espera aparte). */
const sendAnchor = (args) => serialize(() => sendAnchorNow(args));
async function sendAnchorNow({ alertId, recordHash, machineCode, failureProbability, alertTimestamp }) {
  const { contract: c } = client();
  const tx = await c.anchor(
    alertKey(alertId),
    toBytes32(recordHash),
    String(machineCode).slice(0, 32),
    Math.max(0, Math.min(10000, Math.round(failureProbability * 10000))),
    BigInt(Math.floor(new Date(alertTimestamp).getTime() / 1000)),
  );
  return { txHash: tx.hash };
}

/** Espera el recibo; null si se agota el tiempo. Lanza si la transacción revirtió. */
async function waitForReceipt(txHash, timeoutMs = env.chain.txTimeoutMs) {
  const { provider: p } = client();
  const receipt = await p.waitForTransaction(txHash, env.chain.confirmations, timeoutMs).catch((err) => {
    if (err.code === 'TIMEOUT') return null;
    throw err;
  });
  if (!receipt) return null;
  if (receipt.status !== 1) throw new Error('La transacción fue revertida por el contrato');
  return { blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() };
}

async function getReceiptIfMined(txHash) {
  const { provider: p } = client();
  const receipt = await p.getTransactionReceipt(txHash);
  if (!receipt) return null;
  return { blockNumber: receipt.blockNumber, status: receipt.status };
}

/** Lee el registro on-chain. null si la alerta no está anclada. */
async function getRecord(alertId) {
  const { contract: c } = client();
  const r = await c.getRecord(alertKey(alertId));
  if (r.anchoredAt === 0n) return null;
  return {
    recordHash: r.recordHash.slice(2),
    alertTimestamp: new Date(Number(r.alertTimestamp) * 1000),
    anchoredAt: new Date(Number(r.anchoredAt) * 1000),
    failureProbability: Number(r.probabilityBps) / 10000,
    machineCode: r.machineCode,
    submitter: r.submitter,
  };
}

async function status() {
  if (!isEnabled()) return { enabled: false };
  const { provider: p, wallet: w, contract: c } = client();
  const [block, balance, total, canWrite] = await Promise.all([
    p.getBlockNumber(), p.getBalance(w.address), c.totalRecords(), c.writers(w.address),
  ]);
  return {
    enabled: true,
    network: env.chain.name,
    chainId: env.chain.chainId,
    contract: env.chain.registryAddress,
    signer: w.address,
    signerIsWriter: canWrite,
    balance: ethers.formatEther(balance),
    latestBlock: block,
    totalRecords: Number(total),
  };
}

module.exports = { isEnabled, sendAnchor, waitForReceipt, getReceiptIfMined, getRecord, status, explorerUrl, describeError, alertKey };
