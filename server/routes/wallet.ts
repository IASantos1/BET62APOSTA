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

const MIN_DEPOSIT_EUR = 20;
const MIN_WITHDRAWAL_EUR = 20;
const MAX_WITHDRAWAL_DAILY_EUR = 300;
const MAX_WITHDRAWAL_MONTHLY_EUR = 10_000;

async function ensureProfilePaymentColumns(pool: pg.Pool): Promise<void> {
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS iban TEXT`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS iban_holder_name TEXT`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS nif TEXT`);
}

async function getWithdrawalProfile(pool: pg.Pool, userId: string) {
  await ensureProfilePaymentColumns(pool);
  const r = await pool.query(
    `SELECT full_name, nif, iban, iban_holder_name, kyc_verified
     FROM profiles
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  return r.rows?.[0] || null;
}

async function getWithdrawalSums(pool: pg.Pool, userId: string): Promise<{ daily: number; monthly: number }> {
  await ensureAppTransactionsTable(pool);
  const r = await pool.query(
    `SELECT
       COALESCE(SUM(CASE
         WHEN type = 'withdrawal'
          AND status IN ('pending', 'requested', 'authorized', 'completed', 'paid')
          AND created_at >= date_trunc('day', NOW())
         THEN amount ELSE 0 END), 0) AS daily,
       COALESCE(SUM(CASE
         WHEN type = 'withdrawal'
          AND status IN ('pending', 'requested', 'authorized', 'completed', 'paid')
          AND created_at >= date_trunc('month', NOW())
         THEN amount ELSE 0 END), 0) AS monthly
     FROM ${APP_TRANSACTIONS_TABLE}
     WHERE user_id = $1`,
    [userId],
  );
  return {
    daily: Number(r.rows?.[0]?.daily || 0) || 0,
    monthly: Number(r.rows?.[0]?.monthly || 0) || 0,
  };
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

async function handleWithdrawalRequest(
  pool: pg.Pool,
  userId: string,
  kycVerifiedFromSession: boolean | undefined,
  body: any,
) {
  await ensureAppTransactionsTable(pool);
  await ensureProfilePaymentColumns(pool);

  const amount = toNumber(body.amount ?? body.amount_eur);
  if (!amount || amount < MIN_WITHDRAWAL_EUR) return { ok: false as const, error: 'Valor mínimo de levantamento é €20' };

  const current = await getBalance(pool, userId);
  if (current < amount) return { ok: false as const, error: 'Saldo insuficiente' };

  const profile = await getWithdrawalProfile(pool, userId);
  const fullName = String(body.full_name || profile?.full_name || '').trim();
  const nif = String(body.nif || profile?.nif || '').replace(/\D+/g, '').trim();
  const ibanInput = String(body.iban || body.account_details?.iban || body.accountDetails?.iban || profile?.iban || '').replace(/\s+/g, '').toUpperCase().trim();
  const holderName = String(body.holder_name || profile?.iban_holder_name || fullName).trim();
  const kycVerified = Boolean(profile?.kyc_verified || kycVerifiedFromSession);
  const docs = await pool.query(
    `SELECT doc_type, status
     FROM user_documents
     WHERE user_id = $1
       AND doc_type IN ('id_card', 'iban_proof', 'bank_statement')`,
    [userId],
  );
  const verifiedTypes = new Set(
    (docs.rows || [])
      .filter((x: any) => String(x.status || '').toLowerCase() === 'verified')
      .map((x: any) => String(x.doc_type || '').trim())
  );

  if (!kycVerified) return { ok: false as const, error: 'A conta precisa de verificação KYC para levantar.' };
  if (!fullName || fullName.length < 5) return { ok: false as const, error: 'Nome completo inválido.' };
  if (!/^\d{9}$/.test(nif)) return { ok: false as const, error: 'Número de contribuinte inválido.' };
  if (!ibanInput || ibanInput.length < 15) return { ok: false as const, error: 'IBAN inválido.' };
  if (!holderName || holderName.length < 5) return { ok: false as const, error: 'Nome do titular inválido.' };
  if (!verifiedTypes.has('id_card') || (!verifiedTypes.has('iban_proof') && !verifiedTypes.has('bank_statement'))) {
    return { ok: false as const, error: 'É necessário ter documento de identificação e comprovativo bancário verificados.' };
  }

  const sums = await getWithdrawalSums(pool, userId);
  if (sums.daily + amount > MAX_WITHDRAWAL_DAILY_EUR) {
    return { ok: false as const, error: 'Limite diário de levantamento excedido. Máximo por dia: €300.' };
  }
  if (sums.monthly + amount > MAX_WITHDRAWAL_MONTHLY_EUR) {
    return { ok: false as const, error: 'Limite mensal de levantamento excedido. Máximo por mês: €10.000.' };
  }

  const txId = randomId(16);
  const maskedIban = `${ibanInput.slice(0, 8)}...${ibanInput.slice(-4)}`;
  const description = String(body.description || `Levantamento para ${maskedIban}`);
  const paymentMethod = String(body.payment_method || 'bank_transfer');
  const automatic = amount <= MAX_WITHDRAWAL_DAILY_EUR;
  const status = automatic ? 'authorized' : 'pending';

  await pool.query(
    `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, created_at, updated_at)
     VALUES ($1, $2, 'withdrawal', $3, $4, $5, $6, NOW(), NOW())`,
    [txId, userId, amount, status, paymentMethod, `${description} · ${holderName} · NIF ${nif}`],
  );

  await pool.query(
    `UPDATE profiles
     SET iban = $2, iban_holder_name = $3, nif = $4, updated_at = NOW()
     WHERE user_id = $1`,
    [userId, ibanInput, holderName, nif],
  );

  await setBalance(pool, userId, current - amount);
  return {
    ok: true as const,
    data: {
      success: true,
      id: txId,
      transactionId: txId,
      iban: maskedIban,
      message: automatic
        ? `Levantamento automático de €${amount.toFixed(2)} autorizado com sucesso!`
        : `Levantamento de €${amount.toFixed(2)} solicitado com sucesso!`,
      processingTime: automatic ? 'Automático' : '1-3 dias úteis',
      status,
      newBalance: current - amount,
    },
  };
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
    sendJson(res, 200, {
      betDefault: 10,
      minDeposit: MIN_DEPOSIT_EUR,
      maxDeposit: 10000,
      minWithdrawal: MIN_WITHDRAWAL_EUR,
      maxWithdrawalDaily: MAX_WITHDRAWAL_DAILY_EUR,
      maxWithdrawalMonthly: MAX_WITHDRAWAL_MONTHLY_EUR,
    });
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
    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const result = await handleWithdrawalRequest(pool, u.id, u.kyc_verified, body);
    if (!result.ok) return badRequest(res, result.error), true;
    sendJson(res, 200, result.data);
    return true;
  }

  // POST /api/wallet/withdrawals — alias
  if (req.method === 'POST' && path === '/api/wallet/withdrawals') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const result = await handleWithdrawalRequest(pool, u.id, u.kyc_verified, body);
    if (!result.ok) return badRequest(res, result.error), true;
    sendJson(res, 200, result.data);
    return true;
  }

  // POST /api/wallet/withdraw/cancel — cancel a pending withdrawal
  if (req.method === 'POST' && path === '/api/wallet/withdraw/cancel') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureAppTransactionsTable(pool);

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body?.id) return badRequest(res, 'ID em falta'), true;

    const r = await pool.query(
      `SELECT id, amount FROM ${APP_TRANSACTIONS_TABLE} WHERE id = $1 AND user_id = $2 AND type = 'withdrawal' AND status = 'pending' LIMIT 1`,
      [String(body.id), u.id],
    );
    if (!r.rows[0]) return badRequest(res, 'Transação não encontrada ou já processada'), true;

    const amount = Number(r.rows[0].amount);
    await pool.query(
      `UPDATE ${APP_TRANSACTIONS_TABLE} SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [String(body.id)],
    );

    const current = await getBalance(pool, u.id);
    await setBalance(pool, u.id, current + amount);
    sendJson(res, 200, { ok: true, newBalance: current + amount });
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

    const current = await getBalance(pool, u.id);
    if (current < amount) return badRequest(res, 'Saldo insuficiente'), true;

    await setBalance(pool, u.id, current - amount);
    sendJson(res, 200, { ok: true, balance: current - amount });
    return true;
  }

  // POST /api/wallet/win — credit winnings
  if (req.method === 'POST' && path === '/api/wallet/win') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = toNumber(body.amount);
    if (!amount || amount <= 0) return badRequest(res, 'Valor inválido'), true;

    const current = await getBalance(pool, u.id);
    const newBalance = current + amount;
    await setBalance(pool, u.id, newBalance);
    sendJson(res, 200, { ok: true, balance: newBalance });
    return true;
  }

  // POST /api/wallet/cashout — cashout a bet
  if (req.method === 'POST' && path === '/api/wallet/cashout') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = toNumber(body.amount);
    if (!amount || amount <= 0) return badRequest(res, 'Valor inválido'), true;

    const current = await getBalance(pool, u.id);
    await setBalance(pool, u.id, current + amount);
    sendJson(res, 200, { ok: true, balance: current + amount });
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
