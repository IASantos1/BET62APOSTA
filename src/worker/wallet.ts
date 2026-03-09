import { Hono } from 'hono';
import { Env } from '../shared/types';
import { verifyAuth } from './middleware/jwtAuth';
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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const amount = (session.amount_total || 0) / 100;

      if (userId && amount > 0) {
        const w = await c.env.DB.prepare('SELECT id FROM wallets WHERE user_id = ?').bind(userId).first();
        if (w) {
            // Optional: Check if user is blocked/suspended before crediting?
            // Since payment is already captured, we should probably credit it to avoid inconsistencies,
            // but the user won't be able to use it if suspended.
            const audit = new AuditService(c.env.DB);
            const ledger = new LedgerService(c.env.DB, audit);
            
            // Tier-1: Credit Deposit via Ledger
            await ledger.addTransaction(
                (w as any).id,
                'credit',
                amount,
                `DEPOSIT:stripe:${session.payment_intent || session.id}`,
                'Stripe Deposit',
                { actorId: userId, ip: 'stripe-webhook', userAgent: 'Stripe/Webhook' }
            );
        }
      }
    }

    return c.json({ received: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
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
