import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { getDb } from '../db.js';
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const JWT_SECRET = process.env.JWT_SECRET || '7f8a9b1c-2d3e-4f5g-6h7i-8j9k0l1m2n3o-secret-key-2025';
const ACCESS_EXPIRES = '15m';
const REFRESH_EXPIRES_DAYS = 30;
const scrypt = promisify(_scrypt);

export function createAccessToken(userId, role = 'user') {
  return jwt.sign({ sub: userId, role, type: 'access' }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
}

export function createRefreshToken() {
  return randomUUID();
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'access') return null;
    return payload;
  } catch {
    return null;
  }
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const key = await scrypt(password, salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${Buffer.from(key).toString('base64')}`;
}

export async function comparePassword(password, hash) {
  if (typeof hash !== 'string' || !hash) return false;
  if (!hash.startsWith('scrypt$')) return false;
  const parts = hash.split('$');
  if (parts.length !== 6) return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] || '', 'base64');
  const expected = Buffer.from(parts[5] || '', 'base64');
  if (!salt.length || !expected.length) return false;
  const key = await scrypt(password, salt, expected.length, { N, r, p });
  return timingSafeEqual(Buffer.from(key), expected);
}

export async function saveRefreshToken(userId, token) {
  const db = await getDb();
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(randomUUID(), userId, token, expiresAt);
}

export async function revokeRefreshToken(token) {
  const db = await getDb();
  await db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(token);
}

export async function getRefreshToken(token) {
  const db = await getDb();
  return await db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0 AND expires_at > NOW()').get(token);
}
