import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function optionalNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function loadRuntimeConfig(rootDir = process.cwd()) {
  const configPath = resolve(rootDir, 'config.json');
  const accountsPath = resolve(rootDir, 'accounts.json');
  const transfersPath = resolve(rootDir, 'transfers.json');

  for (const requiredPath of [configPath, accountsPath, transfersPath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Missing required file: ${requiredPath}`);
    }
  }

  const config = readJson(configPath);
  const accounts = assertArray(readJson(accountsPath), 'accounts.json').map((account, index) => ({
    name: typeof account.name === 'string' && account.name.trim() ? account.name.trim() : `wallet-${index + 1}`,
    username: assertString(account.username, `accounts[${index}].username`),
    privateKey: assertString(account.privateKey, `accounts[${index}].privateKey`),
    partyId: optionalString(account.partyId),
    sessionToken: optionalString(account.sessionToken),
    cookieHeader: optionalString(account.cookieHeader),
  }));
  const transfers = assertArray(readJson(transfersPath), 'transfers.json').map((transfer, index) => ({
    from: assertString(transfer.from, `transfers[${index}].from`),
    toPartyId: assertString(transfer.toPartyId, `transfers[${index}].toPartyId`),
    amount: assertString(String(transfer.amount), `transfers[${index}].amount`),
    memo: typeof transfer.memo === 'string' && transfer.memo.trim() ? transfer.memo.trim() : '',
  }));

  return {
    baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl.trim() : 'https://vala-wallet.cc',
    instrumentId: typeof config.instrumentId === 'string' && config.instrumentId.trim() ? config.instrumentId.trim() : 'Amulet',
    requestTimeoutMs: Number.isFinite(config.requestTimeoutMs) ? Number(config.requestTimeoutMs) : 30000,
    loginConcurrency: Number.isFinite(config.loginConcurrency) ? Number(config.loginConcurrency) : 3,
    transferMode:
      typeof config.transferMode === 'string' && config.transferMode.trim()
        ? config.transferMode.trim()
        : 'internal-round-robin',
    maxTransfersPerAccount: optionalNumber(config.maxTransfersPerAccount, 10),
    minTransferAmount: optionalNumber(config.minTransferAmount, 0.3),
    maxTransferAmount: optionalNumber(config.maxTransferAmount, 2),
    transferAmountPrecision: optionalNumber(config.transferAmountPrecision, 2),
    verifyAfterSubmit: config.verifyAfterSubmit !== false,
    verificationPollIntervalMs: Number.isFinite(config.verificationPollIntervalMs) ? Number(config.verificationPollIntervalMs) : 3000,
    verificationPollAttempts: Number.isFinite(config.verificationPollAttempts) ? Number(config.verificationPollAttempts) : 8,
    interTransferDelayMs: Number.isFinite(config.interTransferDelayMs) ? Number(config.interTransferDelayMs) : 1000,
    accounts,
    transfers,
  };
}
