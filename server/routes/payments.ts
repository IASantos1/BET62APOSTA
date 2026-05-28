import type http from 'http';
import type pg from 'pg';
import { readJsonBody, sendJson, badRequest, unauthorized } from '../lib/http';
import { requireUser } from '../lib/auth';
import { randomId } from '../lib/crypto';

async function getPayPalAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenResponse = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authString}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!tokenResponse.ok) {
    throw new Error('PayPal authentication failed');
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

type PayPalCreateBody = { amount?: number };
type PayPalCaptureBody = { order_id?: string };
type DepositBody = { amount?: number; payment_method?: string; description?: string; external_id?: string; stripe_session_id?: string };

async function getBalance(pool: pg.Pool, userId: string): Promise<number> {
  const r = await pool.query(`SELECT balance FROM profiles WHERE user_id = $1 LIMIT 1`, [userId]);
  const v = r.rows?.[0]?.balance;
  const n = v == null ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function addToBalance(pool: pg.Pool, userId: string, amount: number): Promise<number> {
  const current = await getBalance(pool, userId);
  const newBalance = current + amount;
  await pool.query(
    `UPDATE profiles SET balance = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, newBalance],
  );
  return newBalance;
}

export async function handlePaymentRoutes(
  pool: pg.Pool,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;

  if (req.method === 'POST' && path === '/api/paypal/create-order') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const paypalClientId = process.env.PAYPAL_CLIENT_ID;
    const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!paypalClientId || !paypalClientSecret) {
      sendJson(res, 503, { ok: false, error: 'Serviço PayPal não configurado', code: 'SERVICE_NOT_CONFIGURED' });
      return true;
    }

    const body = await readJsonBody<PayPalCreateBody>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 10 || amount > 10000) {
      sendJson(res, 400, { ok: false, error: amount < 10 ? 'Valor mínimo é €10' : 'Valor máximo é €10.000', code: 'INVALID_AMOUNT' });
      return true;
    }

    try {
      const accessToken = await getPayPalAccessToken(paypalClientId, paypalClientSecret);

      const orderResponse = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            amount: { currency_code: 'EUR', value: amount.toFixed(2) },
            description: `Depósito BetPT - €${amount.toFixed(2)}`,
          }],
        }),
      });

      if (!orderResponse.ok) {
        sendJson(res, 500, { ok: false, error: 'Erro ao criar pagamento PayPal', code: 'PAYPAL_ORDER_ERROR' });
        return true;
      }

      const orderData = await orderResponse.json();
      const txId = randomId(16);

      await pool.query(
        `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, description, external_id, created_at, updated_at)
         VALUES ($1, $2, 'deposit', $3, 'pending', 'paypal', $4, $5, NOW(), NOW())`,
        [txId, u.id, amount, `Depósito PayPal - €${amount.toFixed(2)}`, orderData.id],
      );

      sendJson(res, 200, { ok: true, order_id: orderData.id, transaction_id: txId });
    } catch (error: any) {
      sendJson(res, 500, { ok: false, error: 'Erro interno do servidor', details: error?.message });
    }
    return true;
  }

  if (req.method === 'POST' && path === '/api/paypal/capture-order') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const paypalClientId = process.env.PAYPAL_CLIENT_ID;
    const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!paypalClientId || !paypalClientSecret) {
      sendJson(res, 503, { error: 'Serviço PayPal não configurado', code: 'SERVICE_NOT_CONFIGURED' });
      return true;
    }

    const body = await readJsonBody<PayPalCaptureBody>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const orderId = String(body.order_id || '').trim();
    if (!orderId) {
      sendJson(res, 400, { error: 'Order ID em falta', code: 'MISSING_ORDER_ID' });
      return true;
    }

    try {
      const accessToken = await getPayPalAccessToken(paypalClientId, paypalClientSecret);

      const captureResponse = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });

      const captureData = await captureResponse.json();

      if (!captureResponse.ok || captureData.status !== 'COMPLETED') {
        sendJson(res, 400, { error: 'Pagamento não foi completado', code: 'CAPTURE_FAILED', details: captureData });
        return true;
      }

      const capturedAmount = parseFloat(
        captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || '0',
      );

      await pool.query(
        `UPDATE transactions SET status = 'completed', updated_at = NOW() WHERE user_id = $1 AND external_id = $2`,
        [u.id, orderId],
      );

      const newBalance = await addToBalance(pool, u.id, capturedAmount);

      sendJson(res, 200, {
        ok: true,
        status: 'COMPLETED',
        amount: capturedAmount,
        newBalance,
        capture_id: captureData.id,
        payer_email: captureData.payer?.email_address,
      });
    } catch (error: any) {
      sendJson(res, 500, { error: 'Erro interno', code: 'INTERNAL_ERROR', details: error?.message });
    }
    return true;
  }

  if (req.method === 'POST' && path === '/api/wallet/deposit') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const body = await readJsonBody<DepositBody>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return true;
    }

    const txId = randomId(16);
    await pool.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, description, external_id, stripe_session_id, completed_at, created_at, updated_at)
       VALUES ($1, $2, 'deposit', $3, 'completed', $4, $5, $6, $7, NOW(), NOW(), NOW())`,
      [txId, u.id, amount, body.payment_method || 'manual', body.description || 'Depósito', body.external_id || null, body.stripe_session_id || null],
    );

    const newBalance = await addToBalance(pool, u.id, amount);
    sendJson(res, 200, { success: true, balance: newBalance, transaction_id: txId });
    return true;
  }

  return false;
}
