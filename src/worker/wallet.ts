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
    const { amount, method: rawMethod, destination: destParam, iban, holder_name } = await c.req.json();
    const method = rawMethod || 'SEPA';
    if (!amount || amount <= 0) return c.json({ error: 'Montante inválido' }, 400);

    const idempotencyKey = c.req.header('Idempotency-Key') || `wd-${userId}-${Date.now()}`;

    // Resolve destination: use passed iban or lookup locked IBAN from KYC
    let destination = destParam || iban || '';
    if (!destination && method.toUpperCase() === 'SEPA') {
      const kyc = await c.env.DB.prepare('SELECT locked_iban FROM kyc_profiles WHERE user_id = ?').bind(userId).first();
      destination = (kyc as any)?.locked_iban || '';
    }
    if (!destination) return c.json({ error: 'IBAN de destino em falta. Guarde o seu IBAN primeiro.' }, 400);

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
          product_data: { name: 'Depósito BET62' },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${c.req.header('origin')}/wallet?status=success`,
      cancel_url: `${c.req.header('origin')}/wallet?status=cancel`,
      metadata: { userId }
    });

    return c.json({ url: sessionStripe.url });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Helper: check if user is operator (admin) — admins are exempt from deposit minimums
async function isOperator(db: D1Database, userId: string): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT is_operator FROM user_profile WHERE user_id = ?').bind(userId).first<{ is_operator: number }>();
    return !!row && row.is_operator === 1;
  } catch { return false; }
}

// Stripe: criar Payment Intent para cartão
wallet.post('/deposit/stripe/card', async (c) => {
  const userId = c.get('user').userId;

  const stateService = new AccountStateService(c.env.DB);
  const canDeposit = await stateService.canDeposit(userId);
  if (!canDeposit) return c.json({ error: 'Depósito não permitido' }, 403);

  try {
    const { amount } = await c.req.json();
    const admin = await isOperator(c.env.DB, userId);
    const minAmount = admin ? 0.5 : 10;
    if (!amount || amount < minAmount) return c.json({ error: admin ? 'Mínimo €0.50' : 'Mínimo €10' }, 400);

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' });
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'eur',
      payment_method_types: ['card'],
      metadata: { userId, method: 'card' },
    });
    return c.json({ clientSecret: intent.client_secret });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Stripe: criar Payment Intent para MB WAY (telemóvel via billing_details)
wallet.post('/deposit/stripe/mbway', async (c) => {
  const userId = c.get('user').userId;

  const stateService = new AccountStateService(c.env.DB);
  const canDeposit = await stateService.canDeposit(userId);
  if (!canDeposit) return c.json({ error: 'Depósito não permitido' }, 403);

  try {
    const { amount, phone } = await c.req.json();
    const admin = await isOperator(c.env.DB, userId);
    const minAmount = admin ? 0.5 : 10;
    if (!amount || amount < minAmount) return c.json({ error: admin ? 'Mínimo €0.50' : 'Mínimo €10' }, 400);
    if (!phone) return c.json({ error: 'Número de telemóvel obrigatório' }, 400);

    // Lookup customer email/name for billing_details (MB WAY exige)
    const userRow = await c.env.DB.prepare(
      "SELECT username FROM user WHERE id = ? LIMIT 1"
    ).bind(userId).first<{ username: string }>();
    const userEmail = userRow?.username && /@/.test(userRow.username) ? userRow.username : undefined;

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' });
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'eur',
      payment_method_types: ['mb_way'],
      payment_method_data: {
        type: 'mb_way',
        billing_details: {
          phone,
          email: userEmail,
          name: userRow?.username || undefined,
        },
      },
      confirm: true,
      metadata: { userId, method: 'mbway' },
    });
    return c.json({
      status: intent.status,
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Stripe: criar Payment Intent para Multibanco (referência inline, sem redirect)
wallet.post('/deposit/stripe/multibanco', async (c) => {
  const userId = c.get('user').userId;

  const stateService = new AccountStateService(c.env.DB);
  const canDeposit = await stateService.canDeposit(userId);
  if (!canDeposit) return c.json({ error: 'Depósito não permitido' }, 403);

  try {
    const { amount, email: bodyEmail, name: bodyName } = await c.req.json();
    const admin = await isOperator(c.env.DB, userId);
    const minAmount = admin ? 0.5 : 10;
    if (!amount || amount < minAmount) return c.json({ error: admin ? 'Mínimo €0.50' : 'Mínimo €10' }, 400);

    // Lookup customer email/name for billing_details (Multibanco exige email)
    const userRow = await c.env.DB.prepare(
      "SELECT username FROM user WHERE id = ? LIMIT 1"
    ).bind(userId).first<{ username: string }>();
    const userEmail = userRow?.username && /@/.test(userRow.username) ? userRow.username : null;

    const email = bodyEmail || userEmail;
    const name = bodyName || userRow?.username || 'Cliente BET62';
    if (!email) return c.json({ error: 'Email obrigatório para Multibanco' }, 400);

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' });
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'eur',
      payment_method_types: ['multibanco'],
      payment_method_data: {
        type: 'multibanco',
        billing_details: { email, name },
      },
      confirm: true,
      metadata: { userId, method: 'multibanco' },
    });

    const next = (intent as any).next_action?.multibanco_display_details;
    return c.json({
      status: intent.status,
      paymentIntentId: intent.id,
      entity: next?.entity || null,
      reference: next?.reference || null,
      amount: amount,
      expiresAt: next?.expires_at || null,
      hostedVoucherUrl: next?.hosted_voucher_url || null,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Stripe: confirmar pagamento e creditar saldo (fallback para webhook)
wallet.post('/deposit/stripe/confirm', async (c) => {
  const userId = c.get('user').userId;
  try {
    const { paymentIntentId } = await c.req.json();
    if (!paymentIntentId) return c.json({ error: 'paymentIntentId obrigatório' }, 400);

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' });
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== 'succeeded') {
      return c.json({ status: intent.status, credited: false });
    }

    // Verify ownership via metadata
    if (intent.metadata?.userId && intent.metadata.userId !== String(userId)) {
      return c.json({ error: 'Não autorizado' }, 403);
    }

    // Idempotency: check if already credited
    const existing = await c.env.DB.prepare(
      "SELECT id FROM ledger_transactions WHERE reference = ? LIMIT 1"
    ).bind(`DEPOSIT:stripe:${paymentIntentId}`).first();

    if (existing) {
      return c.json({ status: 'succeeded', credited: false, reason: 'already_credited' });
    }

    const w = await c.env.DB.prepare('SELECT id FROM wallets WHERE user_id = ?').bind(userId).first();
    if (!w) return c.json({ error: 'Carteira não encontrada' }, 404);

    const amount = intent.amount / 100;
    const audit = new AuditService(c.env.DB);
    const ledger = new LedgerService(c.env.DB, audit);
    await ledger.addTransaction(
      (w as any).id,
      'credit',
      amount,
      `DEPOSIT:stripe:${paymentIntentId}`,
      `Stripe Deposit (${intent.metadata?.method || 'card'})`,
      { actorId: userId, ip: c.req.header('CF-Connecting-IP') || 'confirm', userAgent: c.req.header('User-Agent') || 'confirm' }
    );

    return c.json({ status: 'succeeded', credited: true, amount });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Stripe: webhook para Payment Intents (cartão/mbway)
wallet.post('/webhook/stripe/intents', async (c) => {
  const sig = c.req.header('stripe-signature');
  const body = await c.req.text();

  if (!sig || !c.env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: 'Assinatura ou segredo em falta' }, 400);
  }

  try {
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' });
    const event = stripe.webhooks.constructEvent(body, sig, c.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const userId = intent.metadata?.userId;
      const amount = intent.amount / 100;

      if (userId && amount > 0) {
        const w = await c.env.DB.prepare('SELECT id FROM wallets WHERE user_id = ?').bind(userId).first();
        if (w) {
          const audit = new AuditService(c.env.DB);
          const ledger = new LedgerService(c.env.DB, audit);
          await ledger.addTransaction(
            (w as any).id,
            'credit',
            amount,
            `DEPOSIT:stripe:${intent.id}`,
            `Stripe Deposit (${intent.metadata?.method || 'card'})`,
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

export default wallet;
