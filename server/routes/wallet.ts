import type http from 'http';
import type pg from 'pg';
import { randomId } from '../lib/crypto';
import { readJsonBody, sendJson, badRequest, unauthorized } from '../lib/http';
import { requireUser } from '../lib/auth';
import { APP_TRANSACTIONS_TABLE, ensureAppTransactionsTable } from '../lib/appTables';

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

type Queryable = pg.Pool | pg.PoolClient;

async function getLockedBalance(client: Queryable, userId: string): Promise<number> {
  const r = await client.query(`SELECT balance FROM profiles WHERE user_id = $1 FOR UPDATE`, [userId]);
  const v = r.rows?.[0]?.balance;
  const n = v == null ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function setLockedBalance(client: Queryable, userId: string, newBalance: number): Promise<void> {
  await client.query(
    `UPDATE profiles SET balance = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, newBalance],
  );
}

async function getTransactions(pool: pg.Pool, userId: string) {
  await ensureAppTransactionsTable(pool);
  const r = await pool.query(
    `SELECT id, type, status, amount, created_at, payment_method, description, external_id
     FROM ${APP_TRANSACTIONS_TABLE}
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [userId],
  );
  return (r.rows || []).map((x: any) => ({
    id: String(x.id),
    type: String(x.type || ''),
    status: String(x.status || ''),
    amount: Number(x.amount || 0),
    currency: 'EUR',
    created_at: x.created_at ? new Date(x.created_at).toISOString() : new Date().toISOString(),
    method: x.payment_method ? String(x.payment_method) : undefined,
    metadata: x.description ? String(x.description) : undefined,
    external_id: x.external_id ? String(x.external_id) : undefined,
  }));
}

export async function handleWalletRoutes(
  pool: pg.Pool,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;

  // GET /api/wallet — return balance
  if (req.method === 'GET' && path === '/api/wallet') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const balance = await getBalance(pool, u.id);
    sendJson(res, 200, { balance, currency: 'EUR' });
    return true;
  }

  // GET /api/wallet/balances — array format (used by Header)
  if (req.method === 'GET' && path === '/api/wallet/balances') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const balance = await getBalance(pool, u.id);
    sendJson(res, 200, [{ currency: 'EUR', balance }]);
    return true;
  }

  // GET /api/wallet/transactions — list transactions
  if (req.method === 'GET' && path === '/api/wallet/transactions') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    sendJson(res, 200, await getTransactions(pool, u.id));
    return true;
  }

  // GET /api/transactions — alias used by many frontend hooks
  if (req.method === 'GET' && path === '/api/transactions') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const txs = await getTransactions(pool, u.id);
    sendJson(res, 200, { transactions: txs });
    return true;
  }

  // POST /api/transactions — create a pending transaction record
  if (req.method === 'POST' && path === '/api/transactions') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureAppTransactionsTable(pool);

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = toNumber(body.amount);
    if (!amount || amount <= 0) return badRequest(res, 'Valor inválido'), true;

    const txId = randomId(16);
    const externalId = body.external_id ? String(body.external_id) : null;

    await pool.query(
      `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, external_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [
        txId,
        u.id,
        String(body.type || 'deposit'),
        amount,
        String(body.status || 'pending'),
        String(body.payment_method || 'manual'),
        String(body.description || ''),
        externalId,
      ],
    );

    sendJson(res, 200, { ok: true, id: txId });
    return true;
  }

  // GET /api/pricing/config
  if (req.method === 'GET' && path === '/api/pricing/config') {
    sendJson(res, 200, { betDefault: 10, minDeposit: 10, maxDeposit: 10000, minWithdrawal: 20 });
    return true;
  }

  // POST /api/wallet/deposit — credit balance after payment confirmation
  if (req.method === 'POST' && path === '/api/wallet/deposit') {
    sendJson(res, 410, { error: 'Depósito manual desativado. Usa pagamentos via Stripe.' });
    return true;
  }

  // POST /api/wallet/deposit/card — Stripe/PayPal card deposit (same as above)
  if (req.method === 'POST' && path === '/api/wallet/deposit/card') {
    sendJson(res, 410, { error: 'Depósito direto por cartão desativado. Usa /api/stripe/*.' });
    return true;
  }

  // POST /api/wallet/deposit/mbway — MB WAY deposit
  if (req.method === 'POST' && path === '/api/wallet/deposit/mbway') {
    sendJson(res, 410, { error: 'Endpoint antigo MB WAY desativado. Atualiza a app e usa Stripe.' });
    return true;
  }

  // POST /api/wallet/withdraw — create withdrawal request
  if (req.method === 'POST' && path === '/api/wallet/withdraw') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureAppTransactionsTable(pool);

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = toNumber(body.amount ?? body.amount_eur);
    if (!amount || amount < 20) return badRequest(res, 'Valor mínimo de levantamento é €20'), true;

    const txId = randomId(16);
    const iban = String(body.iban || body.account_details?.iban || body.accountDetails?.iban || '').trim();
    const maskedIban = iban ? `${iban.slice(0, 8)}...${iban.slice(-4)}` : '';
    const description = String(body.description || `Levantamento para ${maskedIban || 'IBAN informado'}`);
    const paymentMethod = String(body.payment_method || 'bank_transfer');
    let newBalance = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await getLockedBalance(client, u.id);
      if (current < amount) {
        await client.query('ROLLBACK');
        return badRequest(res, 'Saldo insuficiente'), true;
      }

      await client.query(
        `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, created_at, updated_at)
         VALUES ($1, $2, 'withdrawal', $3, 'pending', $4, $5, NOW(), NOW())`,
        [txId, u.id, amount, paymentMethod, description],
      );

      newBalance = current - amount;
      await setLockedBalance(client, u.id, newBalance);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => null);
      throw e;
    } finally {
      client.release();
    }
    sendJson(res, 200, {
      success: true,
      id: txId,
      transactionId: txId,
      message: `Levantamento de €${amount.toFixed(2)} solicitado com sucesso!`,
      processingTime: '1-3 dias úteis',
      newBalance,
    });
    return true;
  }

  // POST /api/wallet/withdrawals — alias
  if (req.method === 'POST' && path === '/api/wallet/withdrawals') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureAppTransactionsTable(pool);

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const amount = toNumber(body.amount_eur ?? body.amount);
    if (!amount || amount < 20) return badRequest(res, 'Valor inválido'), true;

    const txId = randomId(16);
    const iban = String(body.iban || body.account_details?.iban || '').trim();
    const maskedIban = iban ? `${iban.slice(0, 8)}...${iban.slice(-4)}` : '';
    const description = String(body.description || `Levantamento para ${maskedIban || 'IBAN informado'}`);
    const paymentMethod = String(body.payment_method || 'bank_transfer');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await getLockedBalance(client, u.id);
      if (current < amount) {
        await client.query('ROLLBACK');
        return badRequest(res, 'Saldo insuficiente'), true;
      }

      await client.query(
        `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, created_at, updated_at)
         VALUES ($1, $2, 'withdrawal', $3, 'pending', $4, $5, NOW(), NOW())`,
        [txId, u.id, amount, paymentMethod, description],
      );

      await setLockedBalance(client, u.id, current - amount);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => null);
      throw e;
    } finally {
      client.release();
    }
    sendJson(res, 200, { success: true, id: txId });
    return true;
  }

  // POST /api/wallet/withdraw/cancel — cancel a pending withdrawal
  if (req.method === 'POST' && path === '/api/wallet/withdraw/cancel') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureAppTransactionsTable(pool);

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body?.id) return badRequest(res, 'ID em falta'), true;

    let newBalance = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `SELECT id, amount
         FROM ${APP_TRANSACTIONS_TABLE}
         WHERE id = $1 AND user_id = $2 AND type = 'withdrawal' AND status = 'pending'
         FOR UPDATE`,
        [String(body.id), u.id],
      );
      if (!r.rows[0]) {
        await client.query('ROLLBACK');
        return badRequest(res, 'Transação não encontrada ou já processada'), true;
      }

      const amount = Number(r.rows[0].amount);
      await client.query(
        `UPDATE ${APP_TRANSACTIONS_TABLE} SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [String(body.id)],
      );

      const current = await getLockedBalance(client, u.id);
      newBalance = current + amount;
      await setLockedBalance(client, u.id, newBalance);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => null);
      throw e;
    } finally {
      client.release();
    }
    sendJson(res, 200, { ok: true, newBalance });
    return true;
  }

  // POST /api/wallet/bet — place a bet, deduct from balance
  if (req.method === 'POST' && path === '/api/wallet/bet') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = toNumber(body.amount ?? body.stake);
    if (!amount || amount <= 0) return badRequest(res, 'Valor inválido'), true;

    let newBalance = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await getLockedBalance(client, u.id);
      if (current < amount) {
        await client.query('ROLLBACK');
        return badRequest(res, 'Saldo insuficiente'), true;
      }
      newBalance = current - amount;
      await setLockedBalance(client, u.id, newBalance);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => null);
      throw e;
    } finally {
      client.release();
    }
    sendJson(res, 200, { ok: true, balance: newBalance });
    return true;
  }

  // POST /api/wallet/win — credit winnings
  if (req.method === 'POST' && path === '/api/wallet/win') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    sendJson(res, 410, {
      error: 'Endpoint legado desativado. Ganhos devem ser creditados apenas pelo fluxo interno de liquidação.',
    });
    return true;
  }

  // POST /api/wallet/cashout — cashout a bet
  if (req.method === 'POST' && path === '/api/wallet/cashout') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    sendJson(res, 410, {
      error: 'Endpoint legado desativado. Usa /api/bets/:id/cashout com validação server-side.',
    });
    return true;
  }

  // POST /api/payments/mbway — initiate MB WAY payment
  if (req.method === 'POST' && path === '/api/payments/mbway') {
    sendJson(res, 410, { error: 'Endpoint antigo MB WAY desativado. Atualiza a app e usa /api/stripe/*.' });
    return true;
  }

  if ((req.method === 'POST' || req.method === 'GET') && path === '/payments/mbway') {
    sendJson(res, 410, { error: 'Endpoint antigo MB WAY desativado. Atualiza a app e usa /api/stripe/*.' });
    return true;
  }

  // POST /api/payments/multibanco/generate — generate Multibanco reference
  if (req.method === 'POST' && path === '/api/payments/multibanco/generate') {
    sendJson(res, 410, { error: 'Endpoint antigo Multibanco desativado. Atualiza a app e usa Stripe.' });
    return true;
  }

  if ((req.method === 'POST' || req.method === 'GET') && path === '/payments/multibanco/generate') {
    sendJson(res, 410, { error: 'Endpoint antigo Multibanco desativado. Atualiza a app e usa Stripe.' });
    return true;
  }

  return false;
}
