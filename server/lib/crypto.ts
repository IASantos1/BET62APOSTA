import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

export function hashPassword(password: string, saltHex?: string): { hashHex: string; saltHex: string } {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return { hashHex: key.toString('hex'), saltHex: salt.toString('hex') };
}

export function verifyPassword(password: string, hashHex: string, saltHex: string): boolean {
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const key = scryptSync(password, salt, 64);
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== key.length) return false;
    return timingSafeEqual(expected, key);
  } catch {
    return false;
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getAppEncryptionKey(): Buffer {
  const secret = String(
    process.env.TOTP_ENCRYPTION_KEY ||
      process.env.AUTH_ENCRYPTION_KEY ||
      process.env.LUCIA_SECRET_KEY ||
      '',
  ).trim();
  if (!secret) {
    throw new Error('Missing TOTP_ENCRYPTION_KEY/AUTH_ENCRYPTION_KEY/LUCIA_SECRET_KEY');
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptText(value: string): string {
  const iv = randomBytes(12);
  const key = getAppEncryptionKey();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptText(value: string): string {
  const raw = String(value || '').trim();
  if (!raw.startsWith('enc:v1:')) return raw;
  const parts = raw.split(':');
  if (parts.length !== 5) throw new Error('Invalid encrypted payload');
  const iv = Buffer.from(parts[2], 'hex');
  const tag = Buffer.from(parts[3], 'hex');
  const payload = Buffer.from(parts[4], 'hex');
  const key = getAppEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
  return decrypted.toString('utf8');
}

