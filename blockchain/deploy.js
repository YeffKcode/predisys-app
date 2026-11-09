'use strict';
/**
 * Compila AlertRegistry.sol con solc y lo despliega en la Testnet configurada (Sepolia por defecto).
 *   npm run chain:deploy
 * Requiere en .env: CHAIN_RPC_URL, CHAIN_ID, CHAIN_PRIVATE_KEY (wallet SOLO de pruebas con ETH de faucet).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const solc = require('solc');
const { ethers } = require('ethers');

function compile() {
  const source = fs.readFileSync(path.join(__dirname, 'AlertRegistry.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'AlertRegistry.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  const c = output.contracts['AlertRegistry.sol'].AlertRegistry;
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
}

async function main() {
  const { CHAIN_RPC_URL, CHAIN_ID, CHAIN_PRIVATE_KEY, CHAIN_NAME = 'sepolia', CHAIN_EXPLORER_TX_URL = '' } = process.env;
  if (!CHAIN_RPC_URL || !CHAIN_PRIVATE_KEY) throw new Error('Configura CHAIN_RPC_URL y CHAIN_PRIVATE_KEY en .env');
  const { abi, bytecode } = compile();
  fs.writeFileSync(path.join(__dirname, 'AlertRegistry.compiled.json'), JSON.stringify({ abi, bytecode }, null, 2));
  console.log(`✔ Compilado (${(bytecode.length - 2) / 2} bytes)`);

  const provider = new ethers.JsonRpcProvider(CHAIN_RPC_URL, CHAIN_ID ? Number(CHAIN_ID) : undefined);
  const wallet = new ethers.Wallet(CHAIN_PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  if ([1n, 137n, 56n, 10n, 42161n, 8453n].includes(network.chainId)) throw new Error(`chainId ${network.chainId} es una red principal (Mainnet). PrediSys solo despliega en Testnet.`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Red: ${CHAIN_NAME} (chainId ${network.chainId}) · Cuenta: ${wallet.address} · Saldo: ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) throw new Error('La cuenta no tiene saldo. Obtén ETH de prueba en un faucet de la Testnet.');

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  const tx = contract.deploymentTransaction();
  console.log(`Transacción de despliegue: ${tx.hash}`);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const receipt = await tx.wait();

  const deployment = { network: CHAIN_NAME, chainId: Number(network.chainId), address, txHash: tx.hash, blockNumber: receipt.blockNumber, deployer: wallet.address, deployedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(__dirname, 'deployment.json'), JSON.stringify(deployment, null, 2));
  console.log(`✔ AlertRegistry desplegado en ${address} (bloque ${receipt.blockNumber})`);
  if (CHAIN_EXPLORER_TX_URL) console.log(`  ${CHAIN_EXPLORER_TX_URL}${tx.hash}`);
  console.log(`\nAgrega a .env:\n  ALERT_REGISTRY_ADDRESS=${address}\n  BLOCKCHAIN_ENABLED=true`);
}

if (require.main === module) main().catch((e) => { console.error(`✘ ${e.shortMessage || e.message}`); process.exit(1); });
module.exports = { compile };
