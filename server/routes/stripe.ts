import type http from 'http';
import type pg from 'pg';
import Stripe from 'stripe';
import { randomId } from '../lib/crypto';
import { sendJson, badRequest, unauthorized } from '../lib/http';
import { requireUser } from '../lib/auth';
import { APP_TRANSACTIONS_TABLE, ensureAppTransactionsTable } from '../lib/appTables';

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
  return new Stripe(key, { apiVersion: '2024-06-20' as any });
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

    const stripe = getStripe();
    if (!stripe) {
      sendJson(res, 503, { error: 'Pagamento por cartão não disponível de momento.' });
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
    if (!amount || amount < 1000) { // min €10
      return badRequest(res, 'Valor mínimo €10'), true;
    }
    if (amount > 1_000_000) { // max €10,000
      return badRequest(res, 'Valor máximo €10,000'), true;
    }

    try {
      const intent = await stripe.paymentIntents.create({
        amount,
        currency: 'eur',
        metadata: { user_id: String(u.id), user_email: String((u as any).email || '') },
        description: `BET62 depósito — ${(u as any).username || u.id}`,
        automatic_payment_methods: { enabled: true },
      });
      sendJson(res, 200, { clientSecret: intent.client_secret, paymentIntentId: intent.id });
    } catch (e: any) {
      console.error('[stripe] create-payment-intent error:', e?.message);
      sendJson(res, 500, { error: 'Erro ao iniciar pagamento. Tenta novamente.' });
    }
    return true;
  }

  // POST /api/stripe/confirm — called by frontend after stripe.confirmCardPayment succeeds
  if (req.method === 'POST' && path === '/api/stripe/confirm') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureAppTransactionsTable(pool);

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

    // Idempotency check — don't double-credit if already processed
    const existing = await pool.query(
      `SELECT id FROM ${APP_TRANSACTIONS_TABLE} WHERE external_id = $1 AND type = 'deposit' LIMIT 1`,
      [paymentIntentId],
    );
    if (existing.rows.length > 0) {
      const balRow = await pool.query(`SELECT balance FROM profiles WHERE user_id = $1`, [u.id]);
      const balance = Number(balRow.rows[0]?.balance ?? 0);
      sendJson(res, 200, { ok: true, balance, alreadyCredited: true });
      return true;
    }

    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (intent.status !== 'succeeded') {
        sendJson(res, 400, { error: `Pagamento com estado '${intent.status}'. Ainda não foi confirmado.` });
        return true;
      }
      // Verify this payment belongs to this user
      if (intent.metadata?.user_id && intent.metadata.user_id !== String(u.id)) {
        sendJson(res, 403, { error: 'Pagamento não pertence a esta conta.' });
        return true;
      }

      const amountEur = intent.amount / 100;

      // Credit balance
      const balRow = await pool.query(`SELECT balance FROM profiles WHERE user_id = $1`, [u.id]);
      const current = Number(balRow.rows[0]?.balance ?? 0);
      const newBalance = current + amountEur;
      await pool.query(`UPDATE profiles SET balance = $2, updated_at = NOW() WHERE user_id = $1`, [u.id, newBalance]);

      const txId = randomId(16);
      await pool.query(
        `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, external_id, completed_at, created_at, updated_at)
         VALUES ($1, $2, 'deposit', $3, 'completed', 'card', $4, $5, NOW(), NOW(), NOW())`,
        [txId, u.id, amountEur, `Depósito via Cartão Stripe — €${amountEur.toFixed(2)}`, paymentIntentId],
      );

      sendJson(res, 200, { ok: true, balance: newBalance, id: txId });
    } catch (e: any) {
      console.error('[stripe] confirm error:', e?.message);
      sendJson(res, 500, { error: 'Erro ao confirmar pagamento.' });
    }
    return true;
  }

  // POST /api/stripe/webhook — Stripe webhook (payment_intent.succeeded)
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

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const userId = intent.metadata?.user_id;
      if (!userId) {
        res.statusCode = 200;
        res.end('ok (no user_id)');
        return true;
      }

      // Idempotency check
      const existing = await pool.query(
        `SELECT id FROM ${APP_TRANSACTIONS_TABLE} WHERE external_id = $1 AND type = 'deposit' LIMIT 1`,
        [intent.id],
      );
      if (existing.rows.length === 0) {
        await ensureAppTransactionsTable(pool);
        const amountEur = intent.amount / 100;
        const balRow = await pool.query(`SELECT balance FROM profiles WHERE user_id = $1`, [userId]);
        if (balRow.rows.length > 0) {
          const current = Number(balRow.rows[0].balance ?? 0);
          await pool.query(`UPDATE profiles SET balance = $2, updated_at = NOW() WHERE user_id = $1`, [userId, current + amountEur]);
          const txId = randomId(16);
          await pool.query(
            `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, external_id, completed_at, created_at, updated_at)
             VALUES ($1, $2, 'deposit', $3, 'completed', 'card', $4, $5, NOW(), NOW(), NOW())`,
            [txId, userId, amountEur, `Depósito Stripe webhook — €${amountEur.toFixed(2)}`, intent.id],
          );
          console.log(`[stripe] webhook credited €${amountEur.toFixed(2)} to user ${userId}`);
        }
      }
    }

    res.statusCode = 200;
    res.end('ok');
    return true;
  }

  return false;
}
