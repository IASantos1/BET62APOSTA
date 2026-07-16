import type http from 'http';
import type pg from 'pg';
import Stripe from 'stripe';
import { randomId } from '../lib/crypto';
import { sendJson, badRequest, unauthorized } from '../lib/http';
import { requireUser } from '../lib/auth';
import { APP_TRANSACTIONS_TABLE, ensureAppTransactionsTable } from '../lib/appTables';
import { hitRateLimit } from '../lib/rateLimit';

function getRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key || !key.startsWith('sk_')) return null;
  return new Stripe(key, { apiVersion: '2025-09-30.clover' as any });
}

function ipOf(req: http.IncomingMessage): string {
  const raw = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return raw || String(req.socket.remoteAddress || '');
}

function stripeRateLimit(
  res: http.ServerResponse,
  action: string,
  keys: string[],
  limit: number,
  windowMs: number,
): boolean {
  for (const key of keys) {
    const hit = hitRateLimit(`stripe:${action}:${key}`, limit, windowMs);
    if (!hit.allowed) {
      res.setHeader('retry-after', String(Math.max(1, Math.ceil(hit.retryAfterMs / 1000))));
      sendJson(res, 429, { error: 'Muitas tentativas de pagamento. Tente novamente em instantes.' });
      return true;
    }
  }
  return false;
}

type AppStripeMethod = 'card' | 'mbway' | 'multibanco';

function normalizeDepositMethod(value: unknown): AppStripeMethod {
  const method = String(value || '').trim().toLowerCase();
  if (method === 'mbway' || method === 'mb_way') return 'mbway';
  if (method === 'multibanco') return 'multibanco';
  return 'card';
}

function stripePaymentMethodType(method: AppStripeMethod): string {
  if (method === 'mbway') return 'mb_way';
  if (method === 'multibanco') return 'multibanco';
  return 'card';
}

function paymentMethodLabel(method: AppStripeMethod): string {
  if (method === 'mbway') return 'MB WAY';
  if (method === 'multibanco') return 'Multibanco';
  return 'Cartão';
}

function buildDepositDescription(method: AppStripeMethod, amountEur: number, status: 'pending' | 'completed' | 'failed'): string {
  const label = paymentMethodLabel(method);
  if (status === 'pending') {
    return `Depósito via ${label} - aguardando confirmação - €${amountEur.toFixed(2)}`;
  }
  if (status === 'failed') {
    return `Depósito via ${label} - falhado - €${amountEur.toFixed(2)}`;
  }
  return `Depósito via ${label} Stripe - €${amountEur.toFixed(2)}`;
}

async function createPendingDepositTransaction(
  pool: pg.Pool,
  input: { userId: string; paymentIntentId: string; amountEur: number; method: AppStripeMethod },
): Promise<void> {
  await ensureAppTransactionsTable(pool);

  const existing = await pool.query(
    `SELECT id FROM ${APP_TRANSACTIONS_TABLE} WHERE external_id = $1 AND type = 'deposit' LIMIT 1`,
    [input.paymentIntentId],
  );
  if (existing.rows.length > 0) return;

  await pool.query(
    `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, external_id, created_at, updated_at)
     VALUES ($1, $2, 'deposit', $3, 'pending', $4, $5, $6, NOW(), NOW())`,
    [
      randomId(16),
      input.userId,
      input.amountEur,
      input.method,
      buildDepositDescription(input.method, input.amountEur, 'pending'),
      input.paymentIntentId,
    ],
  );
}

async function markDepositTransactionFailed(
  pool: pg.Pool,
  intent: Stripe.PaymentIntent,
): Promise<void> {
  const userId = String(intent.metadata?.user_id || '').trim();
  if (!userId) return;

  await ensureAppTransactionsTable(pool);
  const method = normalizeDepositMethod(intent.metadata?.deposit_method || intent.payment_method_types?.[0]);
  const amountEur = intent.amount / 100;
  const errorText = String(intent.last_payment_error?.message || '').trim();
  const description = errorText
    ? `${buildDepositDescription(method, amountEur, 'failed')} (${errorText})`
    : buildDepositDescription(method, amountEur, 'failed');

  await pool.query(
    `UPDATE ${APP_TRANSACTIONS_TABLE}
     SET status = 'failed',
         payment_method = COALESCE(payment_method, $2),
         description = $3,
         updated_at = NOW()
     WHERE external_id = $1
       AND type = 'deposit'
       AND status <> 'completed'`,
    [intent.id, method, description],
  );
}

async function finalizeDepositTransaction(
  pool: pg.Pool,
  intent: Stripe.PaymentIntent,
): Promise<{ balance: number | null; alreadyCredited: boolean; transactionId: string | null }> {
  const userId = String(intent.metadata?.user_id || '').trim();
  if (!userId) {
    return { balance: null, alreadyCredited: false, transactionId: null };
  }

  const method = normalizeDepositMethod(intent.metadata?.deposit_method || intent.payment_method_types?.[0]);
  const amountEur = intent.amount / 100;
  const description = buildDepositDescription(method, amountEur, 'completed');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [intent.id]);

    const existing = await client.query(
      `SELECT id, status FROM ${APP_TRANSACTIONS_TABLE} WHERE external_id = $1 AND type = 'deposit' LIMIT 1`,
      [intent.id],
    );
    if (String(existing.rows[0]?.status || '') === 'completed') {
      const balanceRow = await client.query(`SELECT balance FROM profiles WHERE user_id = $1 LIMIT 1`, [userId]);
      const balance = Number(balanceRow.rows[0]?.balance ?? 0);
      await client.query('COMMIT');
      return {
        balance: Number.isFinite(balance) ? balance : 0,
        alreadyCredited: true,
        transactionId: String(existing.rows[0]?.id || ''),
      };
    }

    const balanceRow = await client.query(`SELECT balance FROM profiles WHERE user_id = $1 LIMIT 1`, [userId]);
    if (balanceRow.rows.length === 0) {
      throw new Error(`Perfil não encontrado para user ${userId}`);
    }
    const currentBalance = Number(balanceRow.rows[0]?.balance ?? 0);
    const newBalance = currentBalance + amountEur;

    await client.query(`UPDATE profiles SET balance = $2, updated_at = NOW() WHERE user_id = $1`, [userId, newBalance]);

    let txId = String(existing.rows[0]?.id || '');
    if (txId) {
      await client.query(
        `UPDATE ${APP_TRANSACTIONS_TABLE}
         SET status = 'completed',
             payment_method = $2,
             description = $3,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [txId, method, description],
      );
    } else {
      txId = randomId(16);
      await client.query(
        `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, external_id, completed_at, created_at, updated_at)
         VALUES ($1, $2, 'deposit', $3, 'completed', $4, $5, $6, NOW(), NOW(), NOW())`,
        [txId, userId, amountEur, method, description, intent.id],
      );
    }

    await client.query('COMMIT');
    return { balance: newBalance, alreadyCredited: false, transactionId: txId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function buildIntentStatusPayload(
  intent: Stripe.PaymentIntent,
  extra?: { balance?: number | null; alreadyCredited?: boolean; transactionId?: string | null },
) {
  const method = normalizeDepositMethod(intent.metadata?.deposit_method || intent.payment_method_types?.[0]);
  const multibancoDetails: any = (intent.next_action as any)?.multibanco_display_details || null;

  return {
    paymentIntentId: intent.id,
    method,
    status: intent.status,
    amount: intent.amount / 100,
    error: String(intent.last_payment_error?.message || ''),
    alreadyCredited: Boolean(extra?.alreadyCredited),
    balance: typeof extra?.balance === 'number' ? extra.balance : undefined,
    transactionId: extra?.transactionId || undefined,
    voucher: multibancoDetails
      ? {
          entity: String(multibancoDetails.entity || ''),
          reference: String(multibancoDetails.reference || ''),
          expiresAt: Number(multibancoDetails.expires_at || 0) || null,
          hostedVoucherUrl: String(multibancoDetails.hosted_voucher_url || ''),
        }
      : null,
  };
}

export async function handleStripeRoutes(
  pool: pg.Pool,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;

  // GET /api/stripe/config — returns the publishable key (safe to expose)
  if (req.method === 'GET' && path === '/api/stripe/config') {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
    if (!publishableKey) {
      sendJson(res, 200, { available: false });
    } else {
      sendJson(res, 200, { available: true, publishableKey });
    }
    return true;
  }

  // POST /api/stripe/create-payment-intent — creates a PaymentIntent
  if (req.method === 'POST' && path === '/api/stripe/create-payment-intent') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    if (
      stripeRateLimit(
        res,
        'create-intent',
        [`ip:${ipOf(req)}`, `user:${String(u.id)}`],
        8,
        10 * 60_000,
      )
    ) return true;

    const stripe = getStripe();
    if (!stripe) {
      sendJson(res, 503, { error: 'Pagamentos Stripe não disponíveis de momento.' });
      return true;
    }

    let body: any;
    try {
      const raw = await getRawBody(req);
      body = JSON.parse(raw.toString());
    } catch {
      return badRequest(res, 'Invalid JSON'), true;
    }

    const amount = Math.round(Number(body?.amount) * 100); // cents
    const paymentMethod = normalizeDepositMethod(body?.paymentMethod);
    if (!amount || amount < 1000) { // min €10
      return badRequest(res, 'Valor mínimo €10'), true;
    }
    if (amount > 1_000_000) { // max €10,000
      return badRequest(res, 'Valor máximo €10,000'), true;
    }

    try {
      const methodType = stripePaymentMethodType(paymentMethod);
      const requestIp = ipOf(req);
      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
      const intent = await stripe.paymentIntents.create(
        {
          amount,
          currency: 'eur',
          metadata: {
            user_id: String(u.id),
            user_email: String((u as any).email || ''),
            deposit_method: paymentMethod,
            request_ip: requestIp.slice(0, 64),
            user_agent: String(req.headers['user-agent'] || '').slice(0, 120),
          },
          description: `BET62 depósito — ${(u as any).username || u.id}`,
          ...(paymentMethod === 'card'
            ? { automatic_payment_methods: { enabled: true } }
            : { payment_method_types: [methodType] }),
        },
        idempotencyKey ? { idempotencyKey: `deposit:${u.id}:${idempotencyKey.slice(0, 120)}` } : undefined,
      );

      if (paymentMethod !== 'card') {
        await createPendingDepositTransaction(pool, {
          userId: String(u.id),
          paymentIntentId: intent.id,
          amountEur: amount / 100,
          method: paymentMethod,
        });
      }

      sendJson(res, 200, {
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        paymentMethod,
      });
    } catch (e: any) {
      console.error('[stripe] create-payment-intent error:', e?.message);
      sendJson(res, 500, { error: 'Erro ao iniciar pagamento. Tenta novamente.' });
    }
    return true;
  }

  // GET /api/stripe/payment-intent-status — return current status and voucher details when applicable
  if (req.method === 'GET' && path === '/api/stripe/payment-intent-status') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    if (
      stripeRateLimit(
        res,
        'status',
        [`ip:${ipOf(req)}`, `user:${String(u.id)}`],
        40,
        5 * 60_000,
      )
    ) return true;

    const stripe = getStripe();
    if (!stripe) {
      sendJson(res, 503, { error: 'Stripe não configurado.' });
      return true;
    }

    const paymentIntentId = String(url.searchParams.get('paymentIntentId') || '').trim();
    if (!paymentIntentId) return badRequest(res, 'paymentIntentId obrigatório'), true;

    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (intent.metadata?.user_id && intent.metadata.user_id !== String(u.id)) {
        sendJson(res, 403, { error: 'Pagamento não pertence a esta conta.' });
        return true;
      }

      if (intent.status === 'succeeded') {
        const result = await finalizeDepositTransaction(pool, intent);
        sendJson(res, 200, buildIntentStatusPayload(intent, result));
        return true;
      }

      if (intent.status === 'requires_payment_method' || intent.status === 'canceled') {
        await markDepositTransactionFailed(pool, intent);
      }

      sendJson(res, 200, buildIntentStatusPayload(intent));
    } catch (e: any) {
      console.error('[stripe] payment-intent-status error:', e?.message);
      sendJson(res, 500, { error: 'Erro ao consultar pagamento.' });
    }
    return true;
  }

  // POST /api/stripe/confirm — called by frontend after stripe.confirmCardPayment succeeds
  if (req.method === 'POST' && path === '/api/stripe/confirm') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureAppTransactionsTable(pool);
    if (
      stripeRateLimit(
        res,
        'confirm',
        [`ip:${ipOf(req)}`, `user:${String(u.id)}`],
        20,
        5 * 60_000,
      )
    ) return true;

    const stripe = getStripe();
    if (!stripe) {
      sendJson(res, 503, { error: 'Stripe não configurado.' });
      return true;
    }

    let body: any;
    try {
      const raw = await getRawBody(req);
      body = JSON.parse(raw.toString());
    } catch {
      return badRequest(res, 'Invalid JSON'), true;
    }

    const paymentIntentId = String(body?.paymentIntentId || '').trim();
    if (!paymentIntentId) return badRequest(res, 'paymentIntentId obrigatório'), true;

    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (intent.status !== 'succeeded') {
        sendJson(res, 400, { error: `Pagamento com estado '${intent.status}'. Ainda não foi confirmado.`, status: intent.status });
        return true;
      }
      // Verify this payment belongs to this user
      if (intent.metadata?.user_id && intent.metadata.user_id !== String(u.id)) {
        sendJson(res, 403, { error: 'Pagamento não pertence a esta conta.' });
        return true;
      }

      const result = await finalizeDepositTransaction(pool, intent);
      sendJson(res, 200, { ok: true, balance: result.balance, id: result.transactionId, alreadyCredited: result.alreadyCredited });
    } catch (e: any) {
      console.error('[stripe] confirm error:', e?.message);
      sendJson(res, 500, { error: 'Erro ao confirmar pagamento.' });
    }
    return true;
  }

  // POST /api/stripe/webhook — Stripe webhook
  if (req.method === 'POST' && path === '/api/stripe/webhook') {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    await ensureAppTransactionsTable(pool);

    if (!stripe || !webhookSecret) {
      res.statusCode = 400;
      res.end('Webhook not configured');
      return true;
    }

    let rawBody: Buffer;
    try {
      rawBody = await getRawBody(req);
    } catch {
      res.statusCode = 400;
      res.end('Bad body');
      return true;
    }

    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (e: any) {
      console.error('[stripe] webhook signature error:', e?.message);
      res.statusCode = 400;
      res.end(`Webhook error: ${e?.message}`);
      return true;
    }

    if (event.type === 'payment_intent.requires_action') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const userId = String(intent.metadata?.user_id || '').trim();
      if (userId) {
        await createPendingDepositTransaction(pool, {
          userId,
          paymentIntentId: intent.id,
          amountEur: intent.amount / 100,
          method: normalizeDepositMethod(intent.metadata?.deposit_method || intent.payment_method_types?.[0]),
        });
      }
    }

    if (event.type === 'payment_intent.processing') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const userId = String(intent.metadata?.user_id || '').trim();
      if (userId) {
        await createPendingDepositTransaction(pool, {
          userId,
          paymentIntentId: intent.id,
          amountEur: intent.amount / 100,
          method: normalizeDepositMethod(intent.metadata?.deposit_method || intent.payment_method_types?.[0]),
        });
      }
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const result = await finalizeDepositTransaction(pool, intent);
      if (result.balance != null) {
        console.log(`[stripe] webhook credited €${(intent.amount / 100).toFixed(2)} to user ${intent.metadata?.user_id}`);
      }
    }

    if (event.type === 'payment_intent.payment_failed' || event.type === 'payment_intent.canceled') {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markDepositTransactionFailed(pool, intent);
    }

    res.statusCode = 200;
    res.end('ok');
    return true;
  }

  return false;
}
