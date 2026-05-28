import type http from 'http';
import type pg from 'pg';
import { randomId } from '../lib/crypto';
import { readJsonBody, sendJson, badRequest, unauthorized } from '../lib/http';
import { requireUser } from '../lib/auth';

type WithdrawalBody = {
  amount_eur?: number;
  iban?: string;
  holder_name?: string;
  nif?: string;
  two_factor_code?: string;
};

function toNumber(v: any): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function getBalance(pool: pg.Pool, userId: string): Promise<number> {
  const r = await pool.query(`SELECT balance FROM profiles WHERE user_id = $1 LIMIT 1`, [userId]);
  const v = r.rows?.[0]?.balance;
  const n = v == null ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function setBalance(pool: pg.Pool, userId: string, newBalance: number): Promise<void> {
  await pool.query(
    `UPDATE profiles SET balance = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, newBalance],
  );
}

export async function handleWalletRoutes(
  pool: pg.Pool,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;

  if (req.method === 'GET' && path === '/api/wallet/balances') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const balance = await getBalance(pool, u.id);
    sendJson(res, 200, [{ currency: 'EUR', balance }]);
    return true;
  }

  if (req.method === 'GET' && path === '/api/wallet/transactions') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const r = await pool.query(
      `SELECT id, type, status, amount, created_at, payment_method, description
       FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [u.id],
    );

    const out = (r.rows || []).map((x: any) => ({
      id: String(x.id),
      type: String(x.type || ''),
      status: String(x.status || ''),
      amount: Number(x.amount || 0),
      currency: 'EUR',
      created_at: x.created_at ? new Date(x.created_at).toISOString() : new Date().toISOString(),
      method: x.payment_method ? String(x.payment_method) : undefined,
      metadata: x.description ? String(x.description) : undefined,
    }));

    sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && path === '/api/wallet/withdrawals') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<WithdrawalBody>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const amount = toNumber(body.amount_eur);
    if (!amount || amount < 20) return badRequest(res, 'Valor inválido'), true;

    const current = await getBalance(pool, u.id);
    if (current < amount) return badRequest(res, 'Saldo insuficiente'), true;

    const txId = randomId(16);
    const meta = JSON.stringify({
      iban: String(body.iban || ''),
      holder_name: String(body.holder_name || ''),
      nif: String(body.nif || ''),
    });

    await pool.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, description, created_at, updated_at)
       VALUES ($1, $2, 'withdrawal', $3, 'pending', 'iban', $4, NOW(), NOW())`,
      [txId, u.id, amount, meta],
    );

    await setBalance(pool, u.id, current - amount);
    sendJson(res, 200, { success: true, id: txId });
    return true;
  }

  return false;
}

