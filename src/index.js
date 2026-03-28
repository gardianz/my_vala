import { resolve } from 'path';
import { loadRuntimeConfig } from './config.js';
import { ValaSession } from './client.js';

function now() {
  return new Date().toISOString();
}

function log(message) {
  console.log(`[${now()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => run());
  await Promise.all(runners);
  return results;
}

function findSender(sessions, transfer) {
  return sessions.find(
    (session) =>
      session.account.username === transfer.from ||
      session.account.name === transfer.from,
  );
}

function clampPositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function normalizePrecision(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.min(8, Math.floor(numeric));
}

function randomAmount(min, max, precision) {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const scale = 10 ** precision;
  const raw = Math.random() * (upper - lower) + lower;
  return (Math.round(raw * scale) / scale).toFixed(precision);
}

function randomChoice(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function pickInternalSender(activeSessions, stateByUsername, config) {
  const minAmount = Number(config.minTransferAmount);
  const maxTransfersPerAccount = clampPositiveInteger(config.maxTransfersPerAccount, 10);
  const eligible = activeSessions.filter((session) => {
    if (!session.partyId) return false;
    const state = stateByUsername.get(session.account.username);
    if (!state) return false;
    return state.balance >= minAmount && state.successCount < maxTransfersPerAccount;
  });

  if (!eligible.length) return null;

  const lowestSuccessCount = Math.min(
    ...eligible.map((session) => stateByUsername.get(session.account.username).successCount),
  );
  const prioritized = eligible.filter(
    (session) => stateByUsername.get(session.account.username).successCount === lowestSuccessCount,
  );
  return randomChoice(prioritized);
}

function pickInternalReceiver(sender, activeSessions) {
  const recipients = activeSessions.filter(
    (session) => session.account.username !== sender.account.username && session.partyId,
  );
  return randomChoice(recipients);
}

async function refreshBalance(session, config) {
  const balance = await session.getInstrumentAmount(config.instrumentId);
  session.currentBalance = balance;
  return balance;
}

async function main() {
  const rootDir = resolve(process.cwd());
  const config = loadRuntimeConfig(rootDir);

  log(`Loaded ${config.accounts.length} account(s); transfer mode=${config.transferMode}`);

  if (!config.accounts.length) {
    log('No accounts configured in vala-bot/accounts.json');
    return;
  }

  const sessions = await mapLimit(config.accounts, config.loginConcurrency, async (account) => {
    const label = account.name || account.username;
    const session = new ValaSession(account, config);
    try {
      log(`[${label}] login start`);
      const auth = await session.login((message) => log(`[${label}] ${message}`));
      log(
        `[${label}] login ok (${auth.reused ? 'session reuse' : 'fresh auth'}) -> username=${auth.username} partyId=${auth.partyId || 'unknown'}`,
      );
      return session;
    } catch (error) {
      log(`[${label}] login failed: ${error.message}`);
      return null;
    }
  });

  const activeSessions = sessions.filter(Boolean);
  if (!activeSessions.length) {
    log('No account logged in successfully');
    return;
  }

  await mapLimit(activeSessions, config.loginConcurrency, async (session) => {
    const label = session.account.name || session.account.username;
    try {
      const amuletBalance = await refreshBalance(session, config);
      log(`[${label}] balance ${config.instrumentId}=${amuletBalance}`);
    } catch (error) {
      log(`[${label}] failed to fetch ${config.instrumentId} balance: ${error.message}`);
      session.currentBalance = 0;
    }
  });

  let successCount = 0;
  let failureCount = 0;
  if (config.transferMode === 'manual') {
    const plannedTransfers = config.transfers;
    if (!plannedTransfers.length) {
      log('No transfers configured in vala-bot/transfers.json; login and balance check complete');
      return;
    }

    log(`Prepared ${plannedTransfers.length} transfer(s)`);

    for (const [index, transfer] of plannedTransfers.entries()) {
      const label = `transfer #${index + 1}`;
      const sender = findSender(activeSessions, transfer);
      if (!sender) {
        failureCount++;
        log(`${label} failed: sender "${transfer.from}" not found in logged-in accounts`);
        continue;
      }

      try {
        const beforeBalance = await refreshBalance(sender, config);
        log(
          `${label} start: ${sender.account.username} -> ${transfer.toPartyId} amount ${transfer.amount} ${config.instrumentId} (balance ${beforeBalance})`,
        );

        const result = await sender.sendTransfer({
          receiverPartyId: transfer.toPartyId,
          amount: transfer.amount,
          instrumentId: config.instrumentId,
          memo: transfer.memo,
        });

        let verification = { verified: true, reason: 'submit-only', lastBalance: beforeBalance };
        if (config.verifyAfterSubmit) {
          verification = await sender.verifyTransfer({
            beforeBalance,
            instrumentId: config.instrumentId,
            amount: transfer.amount,
            receiverPartyId: transfer.toPartyId,
            memo: transfer.memo,
            attempts: config.verificationPollAttempts,
            intervalMs: config.verificationPollIntervalMs,
          });
        }

        sender.currentBalance =
          typeof verification.lastBalance === 'number' ? verification.lastBalance : sender.currentBalance;
        successCount++;
        log(
          `${label} ok: submissionId ${result.prepared.submissionId || 'n/a'} verification=${verification.verified ? verification.reason : 'unconfirmed'}`,
        );
      } catch (error) {
        failureCount++;
        log(`${label} failed: ${error.message}`);
      }

      if (index < plannedTransfers.length - 1 && config.interTransferDelayMs > 0) {
        await sleep(config.interTransferDelayMs);
      }
    }
  } else {
    const maxTransfersPerAccount = clampPositiveInteger(config.maxTransfersPerAccount, 10);
    const precision = normalizePrecision(config.transferAmountPrecision, 2);
    const stateByUsername = new Map(
      activeSessions.map((session) => [
        session.account.username,
        {
          successCount: 0,
          balance: Number(session.currentBalance || 0),
        },
      ]),
    );
    const maxTotalTransfers = activeSessions.length * maxTransfersPerAccount;

    log(
      `Prepared dynamic internal transfers: up to ${maxTransfersPerAccount} success(es) per account, amount ${config.minTransferAmount}-${config.maxTransferAmount} ${config.instrumentId}`,
    );

    for (let index = 0; index < maxTotalTransfers; index++) {
      const label = `transfer #${index + 1}`;
      const sender = pickInternalSender(activeSessions, stateByUsername, config);
      if (!sender) {
        log('No eligible sender left for internal round-robin; stopping early');
        break;
      }

      const receiver = pickInternalReceiver(sender, activeSessions);
      if (!receiver) {
        log('No eligible receiver left for internal round-robin; stopping early');
        break;
      }

      const senderState = stateByUsername.get(sender.account.username);
      const receiverState = stateByUsername.get(receiver.account.username);
      const maxAffordableAmount = Math.min(Number(config.maxTransferAmount), Number(senderState.balance));
      if (maxAffordableAmount < Number(config.minTransferAmount)) {
        senderState.balance = maxAffordableAmount;
        log(
          `${label} skipped: ${sender.account.username} balance ${senderState.balance} is below minimum transfer amount ${config.minTransferAmount}`,
        );
        continue;
      }

      const memo = `rr-${sender.account.username}-to-${receiver.account.username}-${senderState.successCount + 1}`;

      try {
        const beforeBalance = await refreshBalance(sender, config);
        senderState.balance = beforeBalance;

        const refreshedMaxAffordableAmount = Math.min(Number(config.maxTransferAmount), Number(beforeBalance));
        if (refreshedMaxAffordableAmount < Number(config.minTransferAmount)) {
          log(
            `${label} skipped: ${sender.account.username} balance ${beforeBalance} is below minimum transfer amount ${config.minTransferAmount}`,
          );
          continue;
        }

        const finalAmount = randomAmount(config.minTransferAmount, refreshedMaxAffordableAmount, precision);
        log(
          `${label} start: ${sender.account.username} -> ${receiver.partyId} amount ${finalAmount} ${config.instrumentId} (balance ${beforeBalance})`,
        );

        const result = await sender.sendTransfer({
          receiverPartyId: receiver.partyId,
          amount: finalAmount,
          instrumentId: config.instrumentId,
          memo,
        });

        let verification = { verified: true, reason: 'submit-only', lastBalance: beforeBalance };
        if (config.verifyAfterSubmit) {
          verification = await sender.verifyTransfer({
            beforeBalance,
            instrumentId: config.instrumentId,
            amount: finalAmount,
            receiverPartyId: receiver.partyId,
            memo,
            attempts: config.verificationPollAttempts,
            intervalMs: config.verificationPollIntervalMs,
          });
        }

        senderState.successCount += 1;
        senderState.balance =
          typeof verification.lastBalance === 'number' ? verification.lastBalance : Math.max(0, beforeBalance - Number(finalAmount));

        try {
          const receiverBalance = await refreshBalance(receiver, config);
          receiverState.balance = receiverBalance;
        } catch {
          receiverState.balance += Number(finalAmount);
        }

        successCount++;
        log(
          `${label} ok: submissionId ${result.prepared.submissionId || 'n/a'} verification=${verification.verified ? verification.reason : 'unconfirmed'}`,
        );
      } catch (error) {
        failureCount++;
        try {
          senderState.balance = await refreshBalance(sender, config);
        } catch {
          // Ignore balance refresh failure after a failed transfer.
        }
        log(`${label} failed: ${error.message}`);
      }

      if (index < maxTotalTransfers - 1 && config.interTransferDelayMs > 0) {
        await sleep(config.interTransferDelayMs);
      }
    }
  }

  log(`Done: ${successCount} success, ${failureCount} failed`);
}

main().catch((error) => {
  console.error(`[${now()}] Fatal: ${error.message}`);
  process.exitCode = 1;
});
