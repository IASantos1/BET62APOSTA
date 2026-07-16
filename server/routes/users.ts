import type http from 'http';
import type pg from 'pg';
import { randomId } from '../lib/crypto';
import { readJsonBody, sendJson, badRequest, unauthorized } from '../lib/http';
import { requireUser } from '../lib/auth';

type UploadDocumentsBody = {
  documents?: Array<{
    type?: string;
    filename?: string;
    mime_type?: string;
    size?: number;
    content_base64?: string;
  }>;
};

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

async function getTableCols(pool: pg.Pool, tableName: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = $1`,
    [String(tableName || '').toLowerCase()],
  );
  return (r.rows || []).map((x: any) => String(x.column_name || '').toLowerCase());
}

async function ensureProfilePaymentColumns(pool: pg.Pool): Promise<void> {
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS iban TEXT`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS iban_holder_name TEXT`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS nif TEXT`);
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

  if (req.method === 'GET' && path === '/api/users/iban') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureProfilePaymentColumns(pool);
    const cols = await getTableCols(pool, 'profiles').catch(() => []);
    const hasIbanCol = cols.includes('iban');
    const hasHolderCol = cols.includes('iban_holder_name');
    const hasNifCol = cols.includes('nif');
    const r = await pool.query(
      `SELECT ${hasIbanCol ? 'iban' : 'NULL AS iban'}, ${hasHolderCol ? 'iban_holder_name' : 'NULL AS iban_holder_name'}, ${hasNifCol ? 'nif' : 'NULL AS nif'}
       FROM profiles
       WHERE user_id = $1
       LIMIT 1`,
      [u.id],
    );
    const row = r.rows?.[0] || {};
    const iban = String(row.iban || '').trim();
    const holderName = String(row.iban_holder_name || '').trim();
    const nif = String(row.nif || '').trim();
    sendJson(res, 200, {
      has_iban: !!iban,
      iban_masked: iban ? `${iban.slice(0, 8)}...${iban.slice(-4)}` : '',
      holder_name: holderName,
      nif,
    });
    return true;
  }

  if (req.method === 'POST' && path === '/api/users/iban') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureProfilePaymentColumns(pool);
    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const iban = String(body.iban || '').replace(/\s+/g, '').toUpperCase().trim();
    const holderName = String(body.holder_name || body.full_name || '').trim();
    const nif = String(body.nif || '').replace(/\D+/g, '').trim();

    if (!iban || iban.length < 15) return badRequest(res, 'IBAN inválido'), true;
    if (!holderName || holderName.length < 5) return badRequest(res, 'Nome completo inválido'), true;
    if (!/^\d{9}$/.test(nif)) return badRequest(res, 'Número de contribuinte inválido'), true;

    await pool.query(
      `UPDATE profiles
       SET iban = $2, iban_holder_name = $3, nif = $4, updated_at = NOW()
       WHERE user_id = $1`,
      [u.id, iban, holderName, nif],
    );

    sendJson(res, 200, {
      ok: true,
      iban: `${iban.slice(0, 8)}...${iban.slice(-4)}`,
      iban_masked: `${iban.slice(0, 8)}...${iban.slice(-4)}`,
      holder_name: holderName,
      nif,
    });
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
      `SELECT id, doc_type, filename, mime_type, size_bytes, status, created_at
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
      created_at: x.created_at ? new Date(x.created_at).toISOString() : new Date().toISOString(),
    }));
    sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && path === '/api/users/documents') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<UploadDocumentsBody>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const docs = Array.isArray(body.documents) ? body.documents : [];
    if (docs.length === 0) return badRequest(res, 'No documents'), true;

    for (const d of docs) {
      const type = String(d?.type || '').trim();
      const filename = String(d?.filename || '').trim();
      const mimeType = String(d?.mime_type || '').trim();
      const size = Number(d?.size || 0);
      const content = String(d?.content_base64 || '').trim();
      if (!type || !filename || !mimeType || !content) continue;

      await pool.query(
        `INSERT INTO user_documents (id, user_id, doc_type, filename, mime_type, size_bytes, content_base64, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'SUBMITTED', NOW(), NOW())`,
        [randomId(16), u.id, type, filename, mimeType, Number.isFinite(size) ? size : 0, content],
      );
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
