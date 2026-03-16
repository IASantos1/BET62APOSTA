import { Hono } from 'hono';
import { Env } from '../shared/types';
import { verifyAuth, HonoEnv } from './middleware/jwtAuth';
import { LedgerService } from './services/ledger';
import { AuditService } from './services/audit';
import { AccountStateService } from './services/accountState';

const deposits = new Hono<HonoEnv>();

// Helper to get Access Token and effective Base URL
async function getPayPalContext(env: Env): Promise<{ token: string, baseUrl: string }> {
    const credentials = `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`;
    const auth = btoa(credentials);
    
    // Default URL based on PAYPAL_ENVIRONMENT variable
    let baseUrl = (env.PAYPAL_ENVIRONMENT === 'live' || env.PAYPAL_ENVIRONMENT === 'production')
        ? 'https://api-m.paypal.com' 
        : 'https://api-m.sandbox.paypal.com';

    console.log('[PayPal] Getting access token...');
    console.log(`[PayPal] Initial Base URL: ${baseUrl}`);

    let response = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        body: 'grant_type=client_credentials',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    // Auto-detect Live Credentials in Dev (Fallback mechanism)
    if (!response.ok && response.status === 401 && baseUrl.includes('sandbox')) {
        console.warn('[PayPal] Sandbox authentication failed. Trying Live URL (Auto-detection)...');
        baseUrl = 'https://api-m.paypal.com';
        response = await fetch(`${baseUrl}/v1/oauth2/token`, {
            method: 'POST',
            body: 'grant_type=client_credentials',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
    }

    if (!response.ok) {
        const text = await response.text();
        console.error(`[PayPal] Token Error: ${response.status} ${response.statusText}`, text);
        throw new Error(`Failed to get PayPal access token: ${response.statusText} - ${text}`);
    }

    const data = await response.json() as any;
    console.log('[PayPal] Access token received. Effective Base URL:', baseUrl);
    return { token: data.access_token, baseUrl };
}

deposits.use('*', verifyAuth);

deposits.post('/paypal/create-order', async (c) => {
    const user = c.get('user') as any;
    const userId = user.userId;

    // Account State Guard
    const stateService = new AccountStateService(c.env.DB);
    const canDeposit = await stateService.canDeposit(userId);
    if (!canDeposit) {
        return c.json({ error: 'Deposit not allowed: Account blocked or restricted' }, 403);
    }

    try {
        const { amount } = await c.req.json();
        if (!amount || amount < 10) { // Minimum 10 based on frontend
            return c.json({ error: 'Invalid amount (minimum 10)' }, 400);
        }

        const { token, baseUrl } = await getPayPalContext(c.env);
        
        const orderResponse = await fetch(`${baseUrl}/v2/checkout/orders`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                intent: 'CAPTURE',
                purchase_units: [{
                    amount: {
                        currency_code: 'EUR',
                        value: amount.toString()
                    },
                    description: 'Deposit to BET62 Wallet'
                }]
            })
        });

        if (!orderResponse.ok) {
            const errorData = await orderResponse.text();
            console.error('PayPal Create Order Error:', errorData);
            throw new Error('Failed to create PayPal order');
        }

        const orderData = await orderResponse.json() as any;
        return c.json({ orderId: orderData.id });

    } catch (e: any) {
        console.error('Create Order Exception:', e);
        return c.json({ error: e.message }, 500);
    }
});

deposits.post('/paypal/capture-order', async (c) => {
    const user = c.get('user') as any;
    const userId = user.userId;

    try {
        const { orderId } = await c.req.json();
        if (!orderId) return c.json({ error: 'Missing orderId' }, 400);

        const { token, baseUrl } = await getPayPalContext(c.env);

        const captureResponse = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!captureResponse.ok) {
            const errorData = await captureResponse.text();
            console.error('PayPal Capture Error:', errorData);
            throw new Error('Failed to capture PayPal order');
        }

        const captureData = await captureResponse.json() as any;

        if (captureData.status === 'COMPLETED') {
             // Credit User Wallet
             const w = await c.env.DB.prepare('SELECT id FROM wallets WHERE user_id = ?').bind(userId).first();
             if (w) {
                 const amount = parseFloat(captureData.purchase_units[0].payments.captures[0].amount.value);
                 
                 const audit = new AuditService(c.env.DB);
                 const ledger = new LedgerService(c.env.DB, audit);
                 
                 await ledger.addTransaction(
                     (w as any).id,
                     'credit',
                     amount,
                     `DEPOSIT:paypal:${orderId}`,
                     'PayPal Deposit',
                     { actorId: userId, ip: c.req.header('CF-Connecting-IP') || 'unknown', userAgent: c.req.header('User-Agent') || 'unknown' }
                 );
             }
             return c.json({ status: 'COMPLETED', captureId: captureData.id });
        } else {
            return c.json({ status: captureData.status });
        }

    } catch (e: any) {
        console.error('Capture Order Exception:', e);
        return c.json({ error: e.message }, 500);
    }
});

export default deposits;
