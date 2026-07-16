import type http from 'http';
import type pg from 'pg';
import { randomId } from '../lib/crypto';
import { readJsonBody, sendJson, badRequest, unauthorized, payloadTooLarge } from '../lib/http';
import { requireUser } from '../lib/auth';
import { storeKycDocument } from '../lib/kycStorage';

type SelfExcludeBody = {
  self_exclude?: boolean;
  until?: string | null;
};

function toBooleanInt(v: any): number {
  if (v === true) return 1;
  if (v === false) return 0;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return 1;
  if (s === '0' || s === 'false' || s === 'no') return 0;
  return 0;
}

const KYC_ALLOWED_TYPES = new Set([
  'identity_front',
  'identity_back',
  'passport',
  'selfie',
  'proof_of_address',
  'id_card',
  'iban_proof',
  'bank_statement',
]);
const KYC_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const KYC_MAX_FILE_BYTES = 8 * 1024 * 1024;
const KYC_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const KYC_ALLOWED_EXTENSIONS_BY_MIME: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
};

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function fileExtensionOf(filename: string): string {
  const clean = String(filename || '').trim().toLowerCase();
  const idx = clean.lastIndexOf('.');
  return idx >= 0 ? clean.slice(idx) : '';
}

function decodeUrlValue(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isAllowedExtension(filename: string, mimeType: string): boolean {
  const ext = fileExtensionOf(filename);
  const allowed = KYC_ALLOWED_EXTENSIONS_BY_MIME[mimeType] || [];
  return allowed.includes(ext);
}

async function readBinaryBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (maxBytes > 0 && total > maxBytes) throw new Error('Payload too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function handleUsersRoutes(
  pool: pg.Pool,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;

  if (req.method === 'GET' && path === '/api/users/profile') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const r = await pool.query(`SELECT to_jsonb(p) AS profile FROM profiles p WHERE p.user_id = $1 LIMIT 1`, [u.id]);
    const profile = (r.rows?.[0]?.profile && typeof r.rows[0].profile === 'object') ? r.rows[0].profile : {};

    const selfExclude = toBooleanInt((profile as any).self_exclude);
    const selfExcludeUntilRaw = (profile as any).self_exclude_until;
    const selfExcludeUntil = selfExcludeUntilRaw ? String(selfExcludeUntilRaw) : null;

    sendJson(res, 200, {
      ...(profile as any),
      self_exclude: selfExclude,
      self_exclude_until: selfExcludeUntil,
    });
    return true;
  }

  if (req.method === 'GET' && path === '/api/users/is-operator') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const r = await pool.query(`SELECT to_jsonb(p) AS profile FROM profiles p WHERE p.user_id = $1 LIMIT 1`, [u.id]);
    const profile = (r.rows?.[0]?.profile && typeof r.rows[0].profile === 'object') ? r.rows[0].profile : {};
    const operator = Boolean((profile as any).is_operator);
    sendJson(res, 200, { operator });
    return true;
  }

  if ((req.method === 'POST' || req.method === 'GET') && path === '/api/users/heartbeat') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const now = Date.now();
    await pool.query(
      `INSERT INTO user_presence (user_id, last_seen, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET last_seen = EXCLUDED.last_seen, updated_at = NOW()`,
      [u.id, now],
    );
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && path === '/api/users/self-exclude') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const body = await readJsonBody<SelfExcludeBody>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const enabled = Boolean(body.self_exclude);
    const untilStr = body.until ? String(body.until) : null;
    const until = untilStr ? new Date(untilStr) : null;
    const untilIso = until && Number.isFinite(until.getTime()) ? until.toISOString() : null;

    await pool.query(
      `UPDATE profiles
       SET self_exclude = $2, self_exclude_until = $3, updated_at = NOW()
       WHERE user_id = $1`,
      [u.id, enabled, enabled ? untilIso : null],
    );
    await pool.query(
      `INSERT INTO user_self_exclude_history (id, user_id, action, until, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomId(16), u.id, enabled ? 'enable' : 'disable', enabled ? untilIso : null],
    );

    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'GET' && path === '/api/users/self-exclude/history') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const r = await pool.query(
      `SELECT action, until, created_at
       FROM user_self_exclude_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [u.id],
    );
    const out = (r.rows || []).map((x: any) => ({
      action: String(x.action || ''),
      until: x.until ? new Date(x.until).toISOString() : undefined,
      created_at: x.created_at ? new Date(x.created_at).toISOString() : new Date().toISOString(),
    }));
    sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'GET' && path === '/api/users/documents') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const r = await pool.query(
      `SELECT id, doc_type, filename, mime_type, size_bytes, status, storage_path, created_at
       FROM user_documents
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [u.id],
    );
    const out = (r.rows || []).map((x: any) => ({
      id: String(x.id),
      type: String(x.doc_type || ''),
      filename: String(x.filename || ''),
      mime_type: String(x.mime_type || ''),
      size: Number(x.size_bytes || 0),
      status: String(x.status || 'SUBMITTED'),
      stored: Boolean(x.storage_path),
      created_at: x.created_at ? new Date(x.created_at).toISOString() : new Date().toISOString(),
    }));
    sendJson(res, 200, out);
    return true;
  }

  if (
    req.method === 'POST' &&
    (path === '/api/users/documents' || path === '/api/users/documents/upload')
  ) {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const contentTypeHeader = String(req.headers['content-type'] || '').trim().toLowerCase();
    if (!contentTypeHeader || contentTypeHeader.includes('application/json')) {
      return badRequest(res, 'Envio JSON/base64 desativado. Envie o ficheiro binário diretamente.'), true;
    }

    const type = String(url.searchParams.get('type') || firstHeaderValue(req.headers['x-document-type'])).trim();
    const filename = decodeUrlValue(
      String(url.searchParams.get('filename') || firstHeaderValue(req.headers['x-file-name'])).trim(),
    );
    const mimeType = contentTypeHeader.split(';')[0]?.trim().toLowerCase() || '';

    if (!type || !filename || !mimeType) return badRequest(res, 'Documento inválido'), true;
    if (!KYC_ALLOWED_TYPES.has(type)) return badRequest(res, `Tipo de documento não permitido: ${type}`), true;
    if (!KYC_ALLOWED_MIME.has(mimeType)) return badRequest(res, `Mime type não permitido: ${mimeType}`), true;
    if (!isAllowedExtension(filename, mimeType)) {
      return badRequest(res, `Extensão não permitida: ${fileExtensionOf(filename) || 'desconhecida'}`), true;
    }

    const binary = await readBinaryBody(req, KYC_MAX_FILE_BYTES).catch((e: any) => {
      if (String(e?.message || e) === 'Payload too large') return 'too_large' as any;
      return null;
    });
    if (binary === 'too_large') {
      return payloadTooLarge(res, `Cada documento pode ter no máximo ${Math.floor(KYC_MAX_FILE_BYTES / (1024 * 1024))}MB`), true;
    }
    if (!binary || binary.length === 0) return badRequest(res, 'Documento sem conteúdo válido'), true;
    if (binary.length > KYC_MAX_TOTAL_BYTES) {
      return payloadTooLarge(res, `O envio total de documentos pode ter no máximo ${Math.floor(KYC_MAX_TOTAL_BYTES / (1024 * 1024))}MB`), true;
    }

    const docId = randomId(16);
    const stored = await storeKycDocument({
      userId: String(u.id),
      docId,
      filename,
      bytes: binary,
    });

    await pool.query(
      `INSERT INTO user_documents (
         id,
         user_id,
         doc_type,
         filename,
         mime_type,
         size_bytes,
         content_base64,
         status,
         storage_disk,
         storage_path,
         storage_sha256,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, NULL, 'SUBMITTED', $7, $8, $9, NOW(), NOW())`,
      [docId, u.id, type, filename, mimeType, stored.sizeBytes, stored.disk, stored.storagePath, stored.sha256],
    );

    sendJson(res, 200, { ok: true, inserted: 1, id: docId });
    return true;
  }

  return false;
}
