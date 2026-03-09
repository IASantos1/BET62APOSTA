import { Env } from '../shared/types';
import { AuditService } from './services/audit';

export async function processWithdrawals(env: Env) {
    console.log('Starting withdrawal processing job...');
    const audit = new AuditService(env.DB);

    // Fetch AUTHORIZED withdrawals between 10 and 300 EUR
    // We limit to 50 to avoid timeout
    const { results } = await env.DB.prepare(`
        SELECT w.id, w.user_id, w.amount_eur, w.iban_id, b.iban, b.holder_name
        FROM withdrawals w
        JOIN user_bank_accounts b ON w.iban_id = b.id
        WHERE w.status = 'AUTHORIZED'
        AND w.amount_eur BETWEEN 10 AND 300
        LIMIT 50
    `).all<any>();

    if (!results || results.length === 0) {
        console.log('No withdrawals to process.');
        return;
    }

    console.log(`Processing ${results.length} withdrawals...`);

    for (const w of results) {
        try {
            // 1. Send SEPA via Revolut (Mocked)
            // await revolutClient.createPayment({ ... });
            console.log(`Sending ${w.amount_eur} EUR to ${w.iban} (${w.holder_name}) via Revolut...`);
            
            // Simulate success
            const revolutId = `REV-${crypto.randomUUID()}`;

            // 2. Update Status
            await env.DB.batch([
                env.DB.prepare(`
                    UPDATE withdrawals 
                    SET status = 'PAID', processed_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `).bind(w.id),
                // Update Transaction status in transactions table if linked
                // We stored external_id as WTH-{id}
                env.DB.prepare(`
                    UPDATE transactions 
                    SET status = 'COMPLETED', external_id = ?
                    WHERE type = 'WITHDRAWAL' AND external_id = ?
                `).bind(revolutId, `WTH-${w.id}`)
            ]);

            await audit.log({
                actorType: 'system',
                actorId: 'withdrawal-job',
                action: 'WITHDRAWAL_PROCESSED',
                entity: 'withdrawal',
                entityId: w.id,
                before: JSON.stringify({ status: 'AUTHORIZED' }),
                after: JSON.stringify({ status: 'PAID', provider_ref: revolutId }),
                ip: '127.0.0.1',
                userAgent: 'CronJob'
            });

            console.log(`Withdrawal ${w.id} processed successfully.`);

        } catch (e) {
            console.error(`Failed to process withdrawal ${w.id}:`, e);
            // Optionally mark as manual review needed or retry later
        }
    }
    console.log('Withdrawal processing job complete.');
}
