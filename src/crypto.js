import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed.etc.sha512Sync = (...messages) => sha512(ed.etc.concatBytes(...messages));

function normalizeHex(hex) {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

export function decodeHex(hex) {
  const normalized = normalizeHex(String(hex).trim());
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`Invalid hex input: ${hex}`);
  }
  return Uint8Array.from(normalized.match(/.{1,2}/g).map((pair) => parseInt(pair, 16)));
}

export function encodeHex(bytes) {
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function encodeBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function encodeBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

export function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

export function decodeHashBytes(value) {
  const text = String(value).trim();
  if (/^[0-9a-fA-F]+$/.test(text) && text.length % 2 === 0) {
    return decodeHex(text);
  }
  return decodeBase64Url(text);
}

export async function derivePublicKeyBase64Url(privateKeyHex) {
  const privateKey = decodeHex(privateKeyHex);
  if (privateKey.length !== 32) {
    throw new Error(`Invalid private key length: expected 32 bytes, got ${privateKey.length}`);
  }
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return encodeBase64Url(publicKey);
}

export async function derivePublicKeyBase64(privateKeyHex) {
  const privateKey = decodeHex(privateKeyHex);
  if (privateKey.length !== 32) {
    throw new Error(`Invalid private key length: expected 32 bytes, got ${privateKey.length}`);
  }
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return encodeBase64(publicKey);
}

export async function signChallengeBase64Url(challengeBase64Url, privateKeyHex) {
  const privateKey = decodeHex(privateKeyHex);
  if (privateKey.length !== 32) {
    throw new Error(`Invalid private key length: expected 32 bytes, got ${privateKey.length}`);
  }
  const challengeBytes = decodeBase64Url(challengeBase64Url);
  const signature = await ed.signAsync(challengeBytes, privateKey);
  return encodeBase64Url(signature);
}

export async function signHashBase64Url(hashValue, privateKeyHex) {
  const privateKey = decodeHex(privateKeyHex);
  if (privateKey.length !== 32) {
    throw new Error(`Invalid private key length: expected 32 bytes, got ${privateKey.length}`);
  }
  const hashBytes = decodeHashBytes(hashValue);
  const signature = await ed.signAsync(hashBytes, privateKey);
  return encodeBase64Url(signature);
}

export async function signHashBase64(hashValue, privateKeyHex) {
  const privateKey = decodeHex(privateKeyHex);
  if (privateKey.length !== 32) {
    throw new Error(`Invalid private key length: expected 32 bytes, got ${privateKey.length}`);
  }
  const hashBytes = decodeHashBytes(hashValue);
  const signature = await ed.signAsync(hashBytes, privateKey);
  return encodeBase64(signature);
}
