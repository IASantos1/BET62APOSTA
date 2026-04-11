import { Hono } from 'hono';
import { Env } from '../shared/types';
import { verifyAuth } from './middleware/jwtAuth';
import { adminAuth } from './middleware/adminAuth';
import Stripe from 'stripe';
import { LedgerService } from './services/ledger';
import { AuditService } from './services/audit';
import { WithdrawService } from './services/withdraw';
import { AccountStateService } from './services/accountState';

type Variables = {
    user: {
        userId: string;
    }
};

const wallet = new Hono<{ Bindings: Env; Variables: Variables }>();

// Public Webhooks
wallet.post('/webhook/stripe', async (c) => {
  const sig = c.req.header('stripe-signature');
  const body = await c.req.text();
  
  if (!sig || !c.env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: 'Assinatura ou segredo em falta' }, 400);
  }

  try {
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' });
    const event = stripe.webhooks.constructEvent(body, sig, c.env.STRIPE_WEBHOOK_SECRET);

    const alreadyCredited = async (reference: string) => {
      const hit = await c.env.DB.prepare('SELECT id FROM ledger_transactions WHERE reference = ? LIMIT 1').bind(reference).first();
      return Boolean(hit);
    };

    const creditUser = async (userId: string, amount: number, reference: string) => {
      if (!userId || !(amount > 0) || !reference) return;
      if (await alreadyCredited(reference)) return;
      const w = await c.env.DB.prepare('SELECT id FROM wallets WHERE user_id = ?').bind(userId).first();
      if (!w) return;
      const audit = new AuditService(c.env.DB);
      const ledger = new LedgerService(c.env.DB, audit);
      await ledger.addTransaction(
        (w as any).id,
        'credit',
        amount,
        reference,
        'Stripe Deposit',
        { actorId: userId, ip: 'stripe-webhook', userAgent: 'Stripe/Webhook' }
      );
    };

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const amount = (session.amount_total || 0) / 100;

      if (userId && amount > 0) {
        await creditUser(userId, amount, `DEPOSIT:stripe:${session.payment_intent || session.id}`);
      }
    }
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const userId = String(pi.metadata?.userId || '').trim();
      const purpose = String(pi.metadata?.purpose || '').trim();
      const amount = (pi.amount_received || pi.amount || 0) / 100;
      if (purpose === 'deposit' && userId && amount > 0) {
        await creditUser(userId, amount, `DEPOSIT:stripe:${pi.id}`);
      }
    }

    return c.json({ received: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

wallet.post('/admin/credit', adminAuth, async (c) => {
  try {
    const body = await c.req.json();
    const userId = String(body?.userId || '').trim();
    const amount = Number(body?.amount || 0);
    const reference = String(body?.reference || '').trim();
    const description = String(body?.description || 'Stripe Deposit').trim();
    const methodRaw = String(body?.method || '').trim().toLowerCase();
    if (!userId || !(amount > 0) || !reference) return c.json({ error: 'invalid_payload' }, 400);

    const hit = await c.env.DB.prepare('SELECT id FROM ledger_transactions WHERE reference = ? LIMIT 1').bind(reference).first();
    if (hit) return c.json({ ok: true, skipped: true });

    const w = await c.env.DB.prepare('SELECT id FROM wallets WHERE user_id = ?').bind(userId).first();
    if (!w) return c.json({ error: 'wallet_not_found' }, 404);

    const audit = new AuditService(c.env.DB);
    const ledger = new LedgerService(c.env.DB, audit);
    await ledger.addTransaction(
      (w as any).id,
      'credit',
      amount,
      reference,
      description,
      { actorId: userId, ip: 'admin-credit', userAgent: 'Admin/Credit' }
    );

    const depHit = await c.env.DB.prepare('SELECT id FROM deposits WHERE provider_ref = ? LIMIT 1').bind(reference).first();
    if (!depHit) {
      const depId = crypto.randomUUID();
      const method =
        methodRaw === 'mb_way' || methodRaw === 'mbway'
          ? 'MBWAY'
          : methodRaw === 'multibanco'
            ? 'MULTIBANCO'
            : null;
      await c.env.DB.prepare(
        `INSERT INTO deposits (id, user_id, amount_eur, method, status, provider_ref)
         VALUES (?, ?, ?, ?, 'PAID', ?)`
      ).bind(depId, userId, amount, method, reference).run();
    }
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e?.message || 'credit_failed' }, 500);
  }
});

// Middleware for Protected Routes
wallet.use('*', verifyAuth);

wallet.get('/', async (c) => {
  const userId = c.get('user').userId;

  const w = await c.env.DB.prepare('SELECT * FROM wallets WHERE user_id = ?').bind(userId).first();
  if (!w) {
    return c.json({ balance: 0, currency: 'EUR', id: null });
  }

  const ledger = new LedgerService(c.env.DB);
  const realBalance = await ledger.getBalance(w.id as number);
  return c.json({ ...w, balance: realBalance });
});

wallet.get('/balances', async (c) => {
  const userId = c.get('user').userId;

  const results = await c.env.DB.prepare('SELECT * FROM wallets WHERE user_id = ?').bind(userId).all();
  if (!results.results || results.results.length === 0) {
    return c.json([{ balance: 0, currency: 'EUR', id: null }]);
  }

  // Tier-1: Calculate balance for each wallet
  const ledger = new LedgerService(c.env.DB);
  const walletsWithRealBalance = await Promise.all(results.results.map(async (w: any) => {
    const realBalance = await ledger.getBalance(w.id);
    return { ...w, balance: realBalance };
  }));

  return c.json(walletsWithRealBalance);
});

wallet.get('/transactions', async (c) => {
  const userId = c.get('user').userId;

  // Get wallet IDs for the user
  const wallets = await c.env.DB.prepare('SELECT id FROM wallets WHERE user_id = ?').bind(userId).all();
  if (!wallets.results || wallets.results.length === 0) {
    return c.json([]);
  }

  // Use Ledger Transactions instead of legacy transactions table
  // Ideally, we should migrate old data or union them.
  // For now, let's query the new ledger_transactions table.
  
  const placeholders = wallets.results.map(() => '?').join(',');
  const query = `SELECT * FROM ledger_transactions WHERE wallet_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 50`;
  const args = wallets.results.map((w: any) => w.id);
  
  const txs = await c.env.DB.prepare(query).bind(...args).all();
  
  const mappedTxs = (txs.results || []).map((tx: any) => ({
    id: tx.id,
    type: tx.type, // 'credit', 'debit', 'hold', 'release'
    status: tx.status,
    amount: tx.amount,
    currency: 'EUR', // Assuming single currency per wallet for now or fetched from wallet
    created_at: tx.created_at,
    reference: tx.reference
  }));

  return c.json(mappedTxs);
});

wallet.post('/withdraw', async (c) => {
  const userId = c.get('user').userId;

  // Account State Guard
  const stateService = new AccountStateService(c.env.DB);
  const canWithdraw = await stateService.canWithdraw(userId);
  if (!canWithdraw) {
      return c.json({ error: 'Withdraw not allowed: KYC not verified' }, 403);
  }

  const w = await c.env.DB.prepare('SELECT * FROM wallets WHERE user_id = ?').bind(userId).first();
  if (!w) {
    return c.json({ error: 'Carteira não encontrada' }, 404);
  }

  try {
    const { amount, method, destination } = await c.req.json();
    if (!amount || amount <= 0) return c.json({ error: 'Montante inválido' }, 400);

    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
        return c.json({ error: 'Idempotency-Key header is required' }, 400);
    }

    const audit = new AuditService(c.env.DB);
    const withdrawService = new WithdrawService(c.env.DB, audit);
    const result = await withdrawService.requestWithdraw(
        (w as any).id,
        amount,
        method,
        destination,
        idempotencyKey,
        { actorId: userId, ip: c.req.header('CF-Connecting-IP'), userAgent: c.req.header('User-Agent') }
    );

    return c.json(result);
  } catch (e: any) {
    console.error('Withdraw error:', e);
    return c.json({ error: e.message }, 400);
  }
});

wallet.post('/payment-intent', async (c) => {
  const userId = c.get('user').userId;

  const stateService = new AccountStateService(c.env.DB);
  const canDeposit = await stateService.canDeposit(userId);
  if (!canDeposit) {
    return c.json({ error: 'Deposit not allowed: Account blocked or restricted' }, 403);
  }

  try {
    const { amount, method } = await c.req.json();
    if (!amount || amount <= 0) return c.json({ error: 'Montante inválido' }, 400);
    const m = String(method || '').trim();
    const allowed = new Set(['card', 'mb_way', 'multibanco']);
    if (!allowed.has(m)) return c.json({ error: 'Método inválido' }, 400);

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' });
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount) * 100),
      currency: 'eur',
      payment_method_types: [m] as any,
      metadata: { userId, purpose: 'deposit' },
    });

    return c.json({ clientSecret: pi.client_secret });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

wallet.post('/confirm-deposit', async (c) => {
  const userId = c.get('user').userId;
  try {
    const body = await c.req.json().catch(() => null) as any;
    const paymentIntentId = String(body?.paymentIntentId || body?.payment_intent_id || '').trim();
    if (!paymentIntentId) return c.json({ error: 'Missing paymentIntentId' }, 400);

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' });
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const piUserId = String((pi as any)?.metadata?.userId || '').trim();
    const purpose = String((pi as any)?.metadata?.purpose || '').trim();
    if (!piUserId || piUserId !== userId) return c.json({ error: 'Unauthorized payment intent' }, 403);
    if (purpose !== 'deposit') return c.json({ error: 'Invalid purpose' }, 400);

    const status = String((pi as any)?.status || '');
    const amount = Number(((pi as any)?.amount_received ?? (pi as any)?.amount ?? 0) / 100);
    const reference = `DEPOSIT:stripe:${String((pi as any)?.id || '')}`;
    if (!reference || reference === 'DEPOSIT:stripe:') return c.json({ error: 'Invalid reference' }, 400);

    if (status !== 'succeeded') {
      return c.json({ ok: true, credited: false, status, amount });
    }
    if (!(amount > 0)) return c.json({ ok: true, credited: false, status, amount });

    const hit = await c.env.DB.prepare('SELECT id FROM ledger_transactions WHERE reference = ? LIMIT 1').bind(reference).first();
    if (hit) return c.json({ ok: true, credited: true, status, amount, skipped: true });

    const w = await c.env.DB.prepare('SELECT id FROM wallets WHERE user_id = ?').bind(userId).first();
    if (!w) return c.json({ error: 'wallet_not_found' }, 404);

    const audit = new AuditService(c.env.DB);
    const ledger = new LedgerService(c.env.DB, audit);
    await ledger.addTransaction(
      (w as any).id,
      'credit',
      amount,
      reference,
      'Stripe Deposit',
      { actorId: userId, ip: c.req.header('CF-Connecting-IP') || 'unknown', userAgent: c.req.header('User-Agent') || 'unknown' }
    );

    return c.json({ ok: true, credited: true, status, amount });
  } catch (e: any) {
    return c.json({ error: e?.message || 'confirm_failed' }, 500);
  }
});

wallet.post('/deposit', async (c) => {
  const userId = c.get('user').userId;

  // Account State Guard
  const stateService = new AccountStateService(c.env.DB);
  const canDeposit = await stateService.canDeposit(userId);
  if (!canDeposit) {
      return c.json({ error: 'Deposit not allowed: Account blocked or restricted' }, 403);
  }

  try {
    const { amount } = await c.req.json();
    if (!amount || amount <= 0) return c.json({ error: 'Montante inválido' }, 400);

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' });
    const sessionStripe = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'multibanco'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'Deposit' },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${c.req.header('origin')}/wallet?status=success`,
      cancel_url: `${c.req.header('origin')}/wallet?status=cancel`,
      metadata: {
        userId: userId
      }
    });

    return c.json({ url: sessionStripe.url });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default wallet;
