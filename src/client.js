import {
  derivePublicKeyBase64,
  derivePublicKeyBase64Url,
  signChallengeBase64Url,
  signHashBase64,
} from './crypto.js';
import { HttpClient } from './http.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractBalances(payload) {
  if (!payload || typeof payload !== 'object') return {};
  if (payload.balances && typeof payload.balances === 'object') return payload.balances;
  if (payload.balance && typeof payload.balance === 'object') return payload.balance;
  return payload;
}

function extractNumeric(record, keys) {
  for (const key of keys) {
    const raw = record?.[key];
    if (raw == null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function extractInstrumentAmount(payload, instrumentId) {
  const balances = extractBalances(payload);
  if (
    balances &&
    typeof balances === 'object' &&
    balances.effective_unlocked_qty != null &&
    balances.effective_locked_qty != null
  ) {
    return (
      extractNumeric(balances, ['effective_unlocked_qty', 'effectiveUnlockedQty', 'unlocked', 'balance']) +
      extractNumeric(balances, ['effective_locked_qty', 'effectiveLockedQty', 'locked'])
    );
  }
  const instrument = balances?.[instrumentId] || balances?.Amulet || balances?.CC || balances?.['CC (Amulet)'];
  if (!instrument || typeof instrument !== 'object') return 0;
  const unlocked = extractNumeric(instrument, ['effective_unlocked_qty', 'effectiveUnlockedQty', 'unlocked', 'balance']);
  const locked = extractNumeric(instrument, ['effective_locked_qty', 'effectiveLockedQty', 'locked']);
  return unlocked + locked;
}

function extractCookieValue(cookieHeader, name) {
  if (!cookieHeader || !name) return '';
  for (const part of String(cookieHeader).split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const cookieName = trimmed.slice(0, separator).trim();
    if (cookieName !== name) continue;
    return trimmed.slice(separator + 1).trim();
  }
  return '';
}

export class ValaSession {
  constructor(account, options) {
    this.account = account;
    this.http = new HttpClient({
      baseUrl: options.baseUrl,
      timeoutMs: options.requestTimeoutMs,
    });
    this.partyId = account.partyId || null;
    this.publicKey = null;
    this.transferPublicKey = null;
    this.cookieHeader = account.cookieHeader || '';
    this.sessionToken = account.sessionToken || extractCookieValue(this.cookieHeader, 'sessionToken') || null;
    if (this.cookieHeader) {
      this.http.setCookieHeader(this.cookieHeader);
    }
    if (this.sessionToken) {
      this.http.setCookie('sessionToken', this.sessionToken);
    }
  }

  async tryReuseSession(logger = () => {}) {
    if (!this.sessionToken && !this.cookieHeader) return null;

    logger(`trying existing ${this.sessionToken ? 'sessionToken' : 'cookie header'}`);
    this.publicKey = await derivePublicKeyBase64Url(this.account.privateKey);
    this.transferPublicKey = await derivePublicKeyBase64(this.account.privateKey);

    const me = await this.http.request('/api/auth/me');
    if (!me?.success) {
      throw new Error(`Stored session rejected for ${this.account.username}`);
    }

    this.partyId = this.partyId || me.partyId || null;
    return {
      username: me.username || this.account.username,
      partyId: this.partyId,
      publicKey: this.publicKey,
      transferPublicKey: this.transferPublicKey,
      sessionToken: this.sessionToken,
      reused: true,
    };
  }

  async login(logger = () => {}) {
    if (this.sessionToken || this.cookieHeader) {
      try {
        const reused = await this.tryReuseSession(logger);
        if (reused) {
          logger(`existing ${this.sessionToken ? 'sessionToken' : 'cookie header'} accepted`);
          return reused;
        }
      } catch (error) {
        logger(`existing ${this.sessionToken ? 'sessionToken' : 'cookie header'} invalid: ${error.message}`);
      }
    }

    logger('falling back to private-key verification flow');
    logger('requesting private-key challenge');
    const challengeResponse = await this.http.request('/api/auth/verify-private-key', {
      method: 'POST',
      body: { username: this.account.username },
    });

    if (!challengeResponse?.success || !challengeResponse?.challenge) {
      throw new Error(`Challenge not returned for ${this.account.username}`);
    }

    logger('challenge received, signing with private key');
    const signature = await signChallengeBase64Url(challengeResponse.challenge, this.account.privateKey);
    logger('submitting signed challenge');
    const loginResponse = await this.http.request('/api/auth/verify-private-key', {
      method: 'POST',
      body: {
        username: this.account.username,
        signature,
        challenge: challengeResponse.challenge,
      },
    });

    if (!loginResponse?.success) {
      throw new Error(`Login failed for ${this.account.username}`);
    }

    this.partyId = loginResponse.partyId || null;
    this.sessionToken = loginResponse.sessionToken || null;
    this.publicKey = await derivePublicKeyBase64Url(this.account.privateKey);
    this.transferPublicKey = await derivePublicKeyBase64(this.account.privateKey);

    try {
      logger('binding wallet public key');
      await this.http.request('/api/auth/bind-wallet-public-key', {
        method: 'POST',
        body: { publicKey: this.publicKey },
      });
    } catch (error) {
      // Non-fatal; the dashboard also treats this as best-effort.
      logger(`wallet public key bind skipped: ${error.message}`);
    }

    logger('verifying active session');
    const me = await this.http.request('/api/auth/me');
    if (!me?.success) {
      throw new Error(`Session check failed for ${this.account.username}`);
    }
    this.partyId = this.partyId || me.partyId || null;

    return {
      username: me.username || this.account.username,
      partyId: this.partyId,
      publicKey: this.publicKey,
      transferPublicKey: this.transferPublicKey,
      sessionToken: this.sessionToken,
      reused: false,
    };
  }

  async getBalance() {
    return this.http.request('/api/balance');
  }

  async getInstrumentAmount(instrumentId) {
    const balance = await this.http.request(`/api/balance?instrumentIds=${encodeURIComponent(instrumentId)}`);
    return extractInstrumentAmount(balance, instrumentId);
  }

  async listHistory() {
    return this.http.request('/api/history/list');
  }

  async listPending(includeCompleted = false) {
    const suffix = includeCompleted ? '?includeCompleted=true' : '';
    return this.http.request(`/api/transfers/pending${suffix}`);
  }

  async createTransfer({ receiverPartyId, amount, instrumentId, memo }) {
    return this.http.request('/api/transfers/create', {
      method: 'POST',
      body: {
        receiverPartyId,
        amount,
        instrumentId,
        ...(memo ? { memo } : {}),
      },
    });
  }

  async prepareTransfer(command, disclosedContracts) {
    return this.http.request('/api/transfers/prepare', {
      method: 'POST',
      body: {
        command,
        disclosedContracts,
      },
    });
  }

  async submitTransfer(signedSubmission) {
    return this.http.request('/api/transfers/submit', {
      method: 'POST',
      body: {
        signedSubmission,
        memo: signedSubmission.memo,
      },
    });
  }

  async sendTransfer({ receiverPartyId, amount, instrumentId, memo }) {
    const created = await this.createTransfer({ receiverPartyId, amount, instrumentId, memo });
    if (!created?.command || !created?.disclosedContracts) {
      throw new Error(`Invalid create transfer response for ${this.account.username}`);
    }

    const prepared = await this.prepareTransfer(created.command, created.disclosedContracts);
    if (!prepared?.preparedTransactionHash || !prepared?.preparedTransaction) {
      throw new Error(`Invalid prepare transfer response for ${this.account.username}`);
    }

    const signature = await signHashBase64(prepared.preparedTransactionHash, this.account.privateKey);
    const signedSubmission = {
      preparedTransaction: prepared.preparedTransaction,
      preparedTransactionHash: prepared.preparedTransactionHash,
      signature,
      publicKey: this.transferPublicKey,
      submissionId: prepared.submissionId,
      hashingSchemeVersion: prepared.hashingSchemeVersion,
      hashingDetails: prepared.hashingDetails,
      ...(memo ? { memo } : {}),
    };

    const submitted = await this.submitTransfer(signedSubmission);
    return {
      created,
      prepared,
      submitted,
      signedSubmission,
    };
  }

  async verifyTransfer({ beforeBalance, instrumentId, amount, receiverPartyId, memo, attempts, intervalMs }) {
    const expectedDelta = Number(amount);
    let lastBalance = beforeBalance;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      await sleep(intervalMs);
      try {
        lastBalance = await this.getInstrumentAmount(instrumentId);
      } catch {
        // Keep going; history may still confirm the transfer.
      }

      try {
        const history = await this.listHistory();
        const serialized = JSON.stringify(history);
        const memoSeen = memo ? serialized.includes(memo) : true;
        const partySeen = serialized.includes(receiverPartyId);
        const amountSeen = serialized.includes(String(amount));
        if (partySeen && memoSeen && amountSeen) {
          return { verified: true, reason: 'history-match', lastBalance };
        }
      } catch {
        // History is best-effort.
      }

      if (beforeBalance - lastBalance >= expectedDelta) {
        return { verified: true, reason: 'balance-drop', lastBalance };
      }
    }

    return { verified: false, reason: 'not-confirmed', lastBalance };
  }
}
