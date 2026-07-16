import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const LOCAL_KYC_DISK = 'local';

function safeSegment(value: string, fallback: string): string {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return normalized || fallback;
}

export function getKycStorageRoot(): string {
  const configured = String(process.env.KYC_STORAGE_DIR || '').trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), 'storage', 'kyc');
}

export async function storeKycDocument(input: {
  userId: string;
  docId: string;
  filename: string;
  bytes: Buffer;
}): Promise<{ disk: string; storagePath: string; sha256: string; sizeBytes: number }> {
  const now = new Date();
  const root = getKycStorageRoot();
  const userDir = safeSegment(input.userId, 'user');
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = path.extname(String(input.filename || '')).toLowerCase();
  const base = path.basename(String(input.filename || ''), ext);
  const finalName = `${safeSegment(input.docId, 'doc')}-${safeSegment(base, 'document')}${ext}`;
  const dir = path.join(root, userDir, year, month);
  const finalPath = path.join(dir, finalName);
  const tempPath = `${finalPath}.tmp-${Date.now()}`;

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tempPath, input.bytes);
  await fs.rename(tempPath, finalPath);

  return {
    disk: LOCAL_KYC_DISK,
    storagePath: path.relative(root, finalPath).split(path.sep).join('/'),
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
    sizeBytes: input.bytes.length,
  };
}
