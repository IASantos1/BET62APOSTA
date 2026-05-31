import type http from 'http';
import type pg from 'pg';
import { randomId } from '../lib/crypto';
import { readJsonBody, sendJson, badRequest, unauthorized } from '../lib/http';
import { requireUser } from '../lib/auth';

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

async function getTransactions(pool: pg.Pool, userId: string) {
  const r = await pool.query(
    `SELECT id, type, status, amount, created_at, payment_method, description, external_id
     FROM transactions
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

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = toNumber(body.amount);
    if (!amount || amount <= 0) return badRequest(res, 'Valor inválido'), true;

    const txId = randomId(16);
    const externalId = body.external_id ? String(body.external_id) : null;
    const accountDetails = body.account_details ? JSON.stringify(body.account_details) : null;

    await pool.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, description, external_id, created_at, updated_at)
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
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = toNumber(body.amount);
    if (!amount || amount < 1) return badRequest(res, 'Valor inválido'), true;

    const current = await getBalance(pool, u.id);
    const newBalance = current + amount;
    await setBalance(pool, u.id, newBalance);

    const txId = randomId(16);
    await pool.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, description, external_id, created_at, updated_at)
       VALUES ($1, $2, 'deposit', $3, 'completed', $4, $5, $6, NOW(), NOW())`,
      [
        txId,
        u.id,
        amount,
        String(body.payment_method || 'manual'),
        String(body.description || 'Depósito'),
        body.external_id ? String(body.external_id) : null,
      ],
    );

    sendJson(res, 200, { ok: true, balance: newBalance, id: txId });
    return true;
  }

  // POST /api/wallet/deposit/card — Stripe/PayPal card deposit (same as above)
  if (req.method === 'POST' && path === '/api/wallet/deposit/card') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const amount = toNumber(body.amount);
    if (!amount || amount < 10) return badRequest(res, 'Valor mínimo €10'), true;

    const current = await getBalance(pool, u.id);
    const newBalance = current + amount;
    await setBalance(pool, u.id, newBalance);

    const txId = randomId(16);
    await pool.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, description, created_at, updated_at)
       VALUES ($1, $2, 'deposit', $3, 'completed', 'card', $4, NOW(), NOW())`,
      [txId, u.id, amount, `Depósito via Cartão - €${amount.toFixed(2)}`],
    );

    sendJson(res, 200, { ok: true, balance: newBalance, id: txId });
    return true;
  }

  // POST /api/wallet/deposit/mbway — MB WAY deposit
  if (req.method === 'POST' && path === '/api/wallet/deposit/mbway') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const amount = toNumber(body.amount);
    if (!amount || amount < 10) return badRequest(res, 'Valor mínimo €10'), true;

    const txId = randomId(16);
    await pool.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, description, created_at, updated_at)
       VALUES ($1, $2, 'deposit', $3, 'pending', 'mbway', $4, NOW(), NOW())`,
      [txId, u.id, amount, `Depósito via MB WAY - €${amount.toFixed(2)}`],
    );

    sendJson(res, 200, {
      ok: true,
      id: txId,
      message: 'Pedido MB WAY enviado. Confirme no telemóvel.',
    });
    return true;
  }

  // POST /api/wallet/withdraw — create withdrawal request
  if (req.method === 'POST' && path === '/api/wallet/withdraw') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = toNumber(body.amount ?? body.amount_eur);
    if (!amount || amount < 20) return badRequest(res, 'Valor mínimo de levantamento é €20'), true;

    const current = await getBalance(pool, u.id);
    if (current < amount) return badRequest(res, 'Saldo insuficiente'), true;

    const txId = randomId(16);
    const meta = JSON.stringify({
      iban: String(body.iban || body.accountDetails?.iban || ''),
      holder_name: String(body.holder_name || body.accountDetails?.accountHolder || ''),
      nif: String(body.nif || ''),
    });

    await pool.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, description, created_at, updated_at)
       VALUES ($1, $2, 'withdrawal', $3, 'pending', 'iban', $4, NOW(), NOW())`,
      [txId, u.id, amount, meta],
    );

    await setBalance(pool, u.id, current - amount);
    sendJson(res, 200, {
      success: true,
      id: txId,
      transactionId: txId,
      message: `Levantamento de €${amount.toFixed(2)} solicitado com sucesso!`,
      processingTime: '1-3 dias úteis',
      newBalance: current - amount,
    });
    return true;
  }

  // POST /api/wallet/withdrawals — alias
  if (req.method === 'POST' && path === '/api/wallet/withdrawals') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const amount = toNumber(body.amount_eur ?? body.amount);
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

  // POST /api/wallet/withdraw/cancel — cancel a pending withdrawal
  if (req.method === 'POST' && path === '/api/wallet/withdraw/cancel') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body?.id) return badRequest(res, 'ID em falta'), true;

    const r = await pool.query(
      `SELECT id, amount FROM transactions WHERE id = $1 AND user_id = $2 AND type = 'withdrawal' AND status = 'pending' LIMIT 1`,
      [String(body.id), u.id],
    );
    if (!r.rows[0]) return badRequest(res, 'Transação não encontrada ou já processada'), true;

    const amount = Number(r.rows[0].amount);
    await pool.query(
      `UPDATE transactions SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
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
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = toNumber(body.amount);
    if (!amount || amount < 10) return badRequest(res, 'Valor mínimo €10'), true;

    const txId = randomId(16);
    await pool.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, description, created_at, updated_at)
       VALUES ($1, $2, 'deposit', $3, 'pending', 'mbway', $4, NOW(), NOW())`,
      [txId, u.id, amount, `Depósito MB WAY - €${amount.toFixed(2)}`],
    );

    sendJson(res, 200, {
      ok: true,
      id: txId,
      status: 'pending',
      message: 'Pagamento MB WAY iniciado. Confirme no telemóvel.',
    });
    return true;
  }

  // POST /api/payments/multibanco/generate — generate Multibanco reference
  if (req.method === 'POST' && path === '/api/payments/multibanco/generate') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = toNumber(body.amount);
    if (!amount || amount < 10) return badRequest(res, 'Valor mínimo €10'), true;

    const entity = '11249';
    const reference = `${Math.floor(Math.random() * 900000000 + 100000000)}`;

    const txId = randomId(16);
    await pool.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, description, created_at, updated_at)
       VALUES ($1, $2, 'deposit', $3, 'pending', 'multibanco', $4, NOW(), NOW())`,
      [txId, u.id, amount, `Referência Multibanco: ${entity} / ${reference}`],
    );

    sendJson(res, 200, {
      ok: true,
      entity,
      reference,
      amount,
      expires_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    });
    return true;
  }

  // POST /api/wallet/paypal/create-order — create PayPal order
  if (req.method === 'POST' && path === '/api/wallet/paypal/create-order') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = toNumber(body.amount);
    if (!amount || amount < 10 || amount > 10000) {
      return badRequest(res, amount < 10 ? 'Valor mínimo é €10' : 'Valor máximo é €10.000'), true;
    }

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      sendJson(res, 503, { ok: false, error: 'Serviço PayPal não configurado.', code: 'SERVICE_NOT_CONFIGURED' });
      return true;
    }

    const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${authString}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });

    if (!tokenRes.ok) {
      sendJson(res, 500, { ok: false, error: 'Erro de autenticação PayPal', code: 'PAYPAL_AUTH_ERROR' });
      return true;
    }

    const { access_token } = await tokenRes.json() as any;
    const orderRes = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'EUR', value: amount.toFixed(2) }, description: `Depósito BET62 - €${amount.toFixed(2)}` }],
      }),
    });

    if (!orderRes.ok) {
      sendJson(res, 500, { ok: false, error: 'Erro ao criar pagamento PayPal', code: 'PAYPAL_ORDER_ERROR' });
      return true;
    }

    const orderData = await orderRes.json() as any;
    const txId = randomId(16);
    await pool.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, description, external_id, created_at, updated_at)
       VALUES ($1, $2, 'deposit', $3, 'pending', 'paypal', $4, $5, NOW(), NOW())`,
      [txId, u.id, amount, `Depósito PayPal - €${amount.toFixed(2)}`, orderData.id],
    );

    sendJson(res, 200, { ok: true, order_id: orderData.id, transaction_id: txId });
    return true;
  }

  // POST /api/wallet/paypal/capture-order — capture PayPal payment
  if (req.method === 'POST' && path === '/api/wallet/paypal/capture-order') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body?.order_id) return badRequest(res, 'Order ID em falta'), true;

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      sendJson(res, 503, { ok: false, error: 'Serviço PayPal não configurado.' });
      return true;
    }

    const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${authString}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });

    if (!tokenRes.ok) {
      sendJson(res, 500, { ok: false, error: 'Erro de autenticação PayPal', code: 'PAYPAL_AUTH_ERROR' });
      return true;
    }

    const { access_token } = await tokenRes.json() as any;
    const captureRes = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${body.order_id}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    });

    const captureData = await captureRes.json() as any;
    if (!captureRes.ok || captureData.status !== 'COMPLETED') {
      sendJson(res, 400, { ok: false, error: 'Pagamento não completado', code: 'CAPTURE_FAILED' });
      return true;
    }

    const capturedAmount = parseFloat(
      captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || '0',
    );

    await pool.query(
      `UPDATE transactions SET status = 'completed', updated_at = NOW() WHERE external_id = $1 AND user_id = $2`,
      [body.order_id, u.id],
    );

    const current = await getBalance(pool, u.id);
    const newBalance = current + capturedAmount;
    await setBalance(pool, u.id, newBalance);

    sendJson(res, 200, {
      ok: true,
      status: 'COMPLETED',
      amount: capturedAmount,
      capture_id: captureData.id,
      payer_email: captureData.payer?.email_address,
      balance: newBalance,
    });
    return true;
  }

  return false;
}
