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

function normalizeIban(value: string): string {
  return String(value || '').replace(/\s+/g, '').trim().toUpperCase();
}

function maskIban(value: string): string {
  const iban = normalizeIban(value);
  if (!iban) return '';
  if (iban.length <= 12) return iban;
  return `${iban.slice(0, 8)}...${iban.slice(-4)}`;
}

function isValidIbanShape(value: string): boolean {
  const iban = normalizeIban(value);
  return /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban);
}

function isAllowedExtension(filename: string, mimeType: string): boolean {
  const ext = fileExtensionOf(filename);
  const allowed = KYC_ALLOWED_EXTENSIONS_BY_MIME[mimeType] || [];
  return allowed.includes(ext);
}

function makeReferralCode(seed: string): string {
  return String(seed || '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 10);
}

async function ensureUserReferralCode(pool: pg.Pool, userId: string, emailHint?: string): Promise<string> {
  const existing = await pool.query(
    `SELECT referral_code, email
     FROM profiles
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  const current = String(existing.rows?.[0]?.referral_code || '').trim().toUpperCase();
  if (current) return current;

  const email = String(emailHint || existing.rows?.[0]?.email || '').trim().toLowerCase();
  const base = makeReferralCode(email.split('@')[0] || userId || 'BET62');
  let candidate = base || makeReferralCode(userId);
  let suffix = 62;

  while (true) {
    const hit = await pool.query(
      `SELECT 1
       FROM profiles
       WHERE referral_code = $1
         AND user_id <> $2
       LIMIT 1`,
      [candidate, userId],
    );
    if (hit.rows.length === 0) break;
    candidate = `${base.slice(0, 6) || 'BET'}${suffix}`;
    suffix += 1;
  }

  await pool.query(
    `UPDATE profiles
     SET referral_code = $2, updated_at = NOW()
     WHERE user_id = $1`,
    [userId, candidate],
  );
  return candidate;
}

async function createUserNotification(
  pool: pg.Pool,
  userId: string,
  input: {
    kind?: string;
    title: string;
    body: string;
    cta_label?: string;
    cta_target?: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO user_notifications (
       id, user_id, kind, title, body, cta_label, cta_target, is_read, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), NOW())`,
    [
      randomId(16),
      userId,
      String(input.kind || 'system'),
      String(input.title || ''),
      String(input.body || ''),
      input.cta_label ? String(input.cta_label) : null,
      input.cta_target ? String(input.cta_target) : null,
    ],
  );
}

async function seedDefaultNotifications(pool: pg.Pool, userId: string): Promise<void> {
  const count = await pool.query(`SELECT COUNT(*)::int AS count FROM user_notifications WHERE user_id = $1`, [userId]);
  if (Number(count.rows?.[0]?.count || 0) > 0) return;

  await createUserNotification(pool, userId, {
    kind: 'news',
    title: 'Novidades BET62',
    body: 'O Ao Vivo foi atualizado para priorizar ligas maiores e melhorar a estabilidade das odds.',
    cta_label: 'Ver Ao Vivo',
    cta_target: '/live',
  });
  await createUserNotification(pool, userId, {
    kind: 'promo',
    title: 'Convida um amigo',
    body: 'Partilhe o seu código pessoal e ganhe 5€ em freebets quando o amigo se registar com ele.',
    cta_label: 'Abrir convite',
    cta_target: '/profile?tab=Convida%20um%20amigo',
  });
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

  if (req.method === 'GET' && path === '/api/users/notifications') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await seedDefaultNotifications(pool, u.id);
    const r = await pool.query(
      `SELECT id, kind, title, body, cta_label, cta_target, is_read, created_at
       FROM user_notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [u.id],
    );
    const notifications = (r.rows || []).map((row: any) => ({
      id: String(row.id || ''),
      kind: String(row.kind || 'system'),
      title: String(row.title || ''),
      body: String(row.body || ''),
      cta_label: row.cta_label ? String(row.cta_label) : undefined,
      cta_target: row.cta_target ? String(row.cta_target) : undefined,
      is_read: Boolean(row.is_read),
      created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    }));
    const unread = notifications.filter((item: any) => !item.is_read).length;
    sendJson(res, 200, { unread, notifications });
    return true;
  }

  if (req.method === 'POST' && path === '/api/users/notifications/read-all') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await pool.query(
      `UPDATE user_notifications
       SET is_read = TRUE, updated_at = NOW()
       WHERE user_id = $1 AND is_read = FALSE`,
      [u.id],
    );
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && path.startsWith('/api/users/notifications/') && path.endsWith('/read')) {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const id = path.split('/')[4] || '';
    if (!id) return badRequest(res, 'Notificação inválida'), true;
    await pool.query(
      `UPDATE user_notifications
       SET is_read = TRUE, updated_at = NOW()
       WHERE user_id = $1 AND id = $2`,
      [u.id, id],
    );
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'GET' && path === '/api/users/referral') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const code = await ensureUserReferralCode(pool, u.id);
    const stats = await pool.query(
      `SELECT
         COUNT(*)::int AS invited_count,
         COUNT(*) FILTER (WHERE status = 'rewarded')::int AS rewarded_count,
         COALESCE(SUM(reward_amount) FILTER (WHERE status = 'rewarded'), 0)::numeric AS total_reward
       FROM user_referrals
       WHERE referrer_user_id = $1`,
      [u.id],
    );
    const invites = await pool.query(
      `SELECT id, referred_email, status, reward_amount, created_at
       FROM user_referrals
       WHERE referrer_user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [u.id],
    );
    sendJson(res, 200, {
      code,
      reward_eur: 5,
      link: `https://bet62.com/register?ref=${encodeURIComponent(code)}`,
      invited_count: Number(stats.rows?.[0]?.invited_count || 0),
      rewarded_count: Number(stats.rows?.[0]?.rewarded_count || 0),
      total_reward_eur: Number(stats.rows?.[0]?.total_reward || 0),
      invites: (invites.rows || []).map((row: any) => ({
        id: String(row.id || ''),
        email: String(row.referred_email || ''),
        status: String(row.status || 'pending'),
        reward_amount: Number(row.reward_amount || 0),
        created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      })),
    });
    return true;
  }

  if (req.method === 'POST' && path === '/api/users/referral/invite') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const body = await readJsonBody<{ email?: string; name?: string }>(req, 8 * 1024).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const email = String(body.email || '').trim().toLowerCase();
    const friendName = String(body.name || '').trim();
    if (!email || !email.includes('@')) return badRequest(res, 'Email inválido'), true;
    const ownProfile = await pool.query(`SELECT email FROM profiles WHERE user_id = $1 LIMIT 1`, [u.id]);
    const ownEmail = String(ownProfile.rows?.[0]?.email || '').trim().toLowerCase();
    if (ownEmail && ownEmail === email) return badRequest(res, 'Não pode convidar o seu próprio email'), true;

    const code = await ensureUserReferralCode(pool, u.id, ownEmail);
    const existing = await pool.query(
      `SELECT id, status
       FROM user_referrals
       WHERE referrer_user_id = $1
         AND LOWER(COALESCE(referred_email, '')) = $2
       LIMIT 1`,
      [u.id, email],
    );
    if (existing.rows.length > 0) return badRequest(res, 'Este convite já foi enviado'), true;

    const maybeFriend = await pool.query(
      `SELECT user_id
       FROM profiles
       WHERE LOWER(COALESCE(email, '')) = $1
       LIMIT 1`,
      [email],
    );

    const referralId = randomId(16);
    const friendUserId = String(maybeFriend.rows?.[0]?.user_id || '').trim() || null;
    const rewardStatus = friendUserId ? 'rewarded' : 'pending';
    await pool.query(
      `INSERT INTO user_referrals (
         id, referrer_user_id, referred_user_id, referred_email, referral_code, reward_amount, status, rewarded_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 5, $6, ${friendUserId ? 'NOW()' : 'NULL'}, NOW(), NOW())`,
      [referralId, u.id, friendUserId, email, code, rewardStatus],
    );

    if (friendUserId) {
      await pool.query(
        `UPDATE profiles
         SET free_bet_balance = COALESCE(free_bet_balance, 0) + 5,
             updated_at = NOW()
         WHERE user_id = $1`,
        [u.id],
      );
      await createUserNotification(pool, u.id, {
        kind: 'promo',
        title: 'Convite validado',
        body: `Recebeu 5€ em freebets por convidar ${friendName || email}.`,
        cta_label: 'Ver conta',
        cta_target: '/profile',
      });
      await createUserNotification(pool, friendUserId, {
        kind: 'promo',
        title: 'Chegou um convite',
        body: 'Um amigo convidou-o para a BET62. Já pode usar as novidades e promoções disponíveis.',
        cta_label: 'Abrir perfil',
        cta_target: '/profile',
      });
    } else {
      await createUserNotification(pool, u.id, {
        kind: 'promo',
        title: 'Convite enviado',
        body: `O convite para ${friendName || email} ficou registado com sucesso.`,
        cta_label: 'Ver convite',
        cta_target: '/profile?tab=Convida%20um%20amigo',
      });
    }

    sendJson(res, 200, { ok: true, code, reward_eur: friendUserId ? 5 : 0, status: rewardStatus });
    return true;
  }

  if (req.method === 'GET' && path === '/api/users/is-operator') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    if (u.role === 'admin') {
      sendJson(res, 200, { operator: true });
      return true;
    }

    const r = await pool.query(`SELECT to_jsonb(p) AS profile FROM profiles p WHERE p.user_id = $1 LIMIT 1`, [u.id]);
    const profile = (r.rows?.[0]?.profile && typeof r.rows[0].profile === 'object') ? r.rows[0].profile : {};
    const operator = Boolean((profile as any).is_operator);
    sendJson(res, 200, { operator });
    return true;
  }

  if (req.method === 'GET' && path === '/api/users/iban') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const r = await pool.query(
      `SELECT verified_iban, iban_holder_name
       FROM profiles
       WHERE user_id = $1
       LIMIT 1`,
      [u.id],
    );
    const row = r.rows?.[0] || {};
    const iban = normalizeIban(String(row.verified_iban || ''));
    sendJson(res, 200, {
      has_iban: Boolean(iban),
      iban_masked: maskIban(iban),
      holder_name: String(row.iban_holder_name || ''),
    });
    return true;
  }

  if (req.method === 'POST' && path === '/api/users/iban') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const body = await readJsonBody<{ iban?: string; holder_name?: string }>(req, 8 * 1024).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const iban = normalizeIban(String(body.iban || ''));
    const holderName = String(body.holder_name || '').trim();
    if (!isValidIbanShape(iban)) return badRequest(res, 'IBAN inválido'), true;
    if (!holderName) return badRequest(res, 'Nome do titular em falta'), true;

    await pool.query(
      `UPDATE profiles
       SET verified_iban = $2,
           iban_holder_name = $3,
           updated_at = NOW()
       WHERE user_id = $1`,
      [u.id, iban, holderName],
    );

    sendJson(res, 200, {
      ok: true,
      iban: maskIban(iban),
      holder_name: holderName,
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
