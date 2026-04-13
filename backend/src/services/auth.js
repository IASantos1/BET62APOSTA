import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { getDb } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || '7f8a9b1c-2d3e-4f5g-6h7i-8j9k0l1m2n3o-secret-key-2025';
const ACCESS_EXPIRES = '15m';
const REFRESH_EXPIRES_DAYS = 30;

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
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
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
