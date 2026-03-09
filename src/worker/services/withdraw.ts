import { D1Database } from '@cloudflare/workers-types';
import { LedgerService } from './ledger';
import { AuditService } from './audit';
import { AccountStateService } from './accountState';

export type WithdrawStatus = 'requested' | 'approved' | 'processing' | 'paid' | 'rejected';

export interface WithdrawRequest {
    id: string;
    wallet_id: number;
    amount: number;
    method: string;
    destination: string;
    status: WithdrawStatus;
    idempotency_key: string;
    requested_at: string;
    processed_at?: string;
}

export class WithdrawService {
    private db: D1Database;
    private ledger: LedgerService;
    private audit?: AuditService;
    private accountState: AccountStateService;

    constructor(db: D1Database, audit?: AuditService) {
        this.db = db;
        this.audit = audit;
        this.ledger = new LedgerService(db, audit);
        this.accountState = new AccountStateService(db);
    }

    /**
     * Request a withdrawal with Tier-1 safety:
     * 1. Check Idempotency
     * 2. Lock Wallet (Advisory)
     * 3. Check Balance
     * 4. Atomic Insert: Ledger Debit + Withdraw Request
     */
    async requestWithdraw(
        walletId: number,
        amount: number,
        method: string,
        destination: string,
        idempotencyKey: string,
        auditContext?: { actorId?: string, ip?: string, userAgent?: string }
    ): Promise<{ id: string; status: WithdrawStatus }> {
        // 0. KYC Check
        // Get userId from walletId
        const wallet = await this.db.prepare('SELECT user_id FROM wallets WHERE id = ?').bind(walletId).first();
        if (!wallet) throw new Error('Wallet not found');
        const userId = wallet.user_id as string;

        const canWithdraw = await this.accountState.canWithdraw(userId);
        if (!canWithdraw) {
            throw new Error('Conta não verificada. Complete o KYC para efetuar levantamentos.');
        }

        // Check IBAN consistency for SEPA
        const kyc = await this.db.prepare('SELECT status, locked_iban FROM kyc_profiles WHERE user_id = ?').bind(userId).first();
        if (method === 'SEPA' && kyc?.locked_iban) {
            if (kyc.locked_iban !== destination) {
                 throw new Error('IBAN diferente do verificado. Por favor, submeta comprovativo do novo IBAN.');
            }
        }

        // 1. Idempotency Check
        const existing = await this.db.prepare(
            'SELECT id, status FROM withdraw_requests WHERE idempotency_key = ?'
        ).bind(idempotencyKey).first<WithdrawRequest>();

        if (existing) {
            console.log(`[Withdraw] Idempotency hit: ${idempotencyKey}`);
            return { id: existing.id, status: existing.status };
        }

        // 2. Acquire Lock (Simple Advisory Lock)
        // We use the 'locks' table. If insert fails, resource is busy.
        const lockKey = `wallet:${walletId}`;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 5000).toISOString(); // 5s lock

        try {
            await this.db.prepare(
                'INSERT INTO locks (key, expires_at) VALUES (?, ?)'
            ).bind(lockKey, expiresAt).run();
        } catch (e) {
            // Lock busy or expired? 
            // We should check if expired and steal it, but for simplicity we fail fast.
            throw new Error('Wallet is busy. Please try again.');
        }

        try {
            // 3. Check Balance
            const balance = await this.ledger.getBalance(walletId);
            if (balance < amount) {
                throw new Error('Insufficient funds');
            }

            // 4. Determine Status (Auto-Approval Logic)
            let initialStatus: WithdrawStatus = 'requested';
            
            // Check for previous paid withdrawals
            const prev = await this.db.prepare("SELECT count(*) as count FROM withdraw_requests WHERE wallet_id = ? AND status = 'paid'").bind(walletId).first<{count: number}>();
            const isFirstWithdrawal = !prev || prev.count === 0;

            if (!isFirstWithdrawal && method === 'SEPA' && kyc?.locked_iban === destination) {
                 initialStatus = 'approved'; // Automatic approval
            }

            // 5. Atomic Batch Insert
            const withdrawId = crypto.randomUUID();
            const ledgerId = crypto.randomUUID();

            const batch = [
                // Ledger Debit
                this.db.prepare(`
                    INSERT INTO ledger_transactions (id, wallet_id, type, amount, reference, status)
                    VALUES (?, ?, 'debit', ?, ?, 'confirmed')
                `).bind(ledgerId, walletId, amount, `WITHDRAW:${withdrawId}`),

                // Withdraw Request
                this.db.prepare(`
                    INSERT INTO withdraw_requests (id, wallet_id, amount, method, destination, status, idempotency_key)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).bind(withdrawId, walletId, amount, method, destination, initialStatus, idempotencyKey)
            ];

            // Tier-1 Audit Log in Batch
            if (this.audit) {
                batch.push(this.audit.prepareLogStatement({
                    actorType: auditContext?.actorId ? 'user' : 'system',
                    actorId: auditContext?.actorId,
                    action: 'WITHDRAW_REQUEST',
                    entity: 'wallet',
                    entityId: walletId.toString(),
                    after: { amount, withdrawId, status: initialStatus },
                    ip: auditContext?.ip,
                    userAgent: auditContext?.userAgent
                }));
            }
            
            await this.db.batch(batch);

            return { id: withdrawId, status: initialStatus };

        } finally {
            // Release Lock
            await this.db.prepare('DELETE FROM locks WHERE key = ?').bind(lockKey).run();
        }
    }

    /**
     * Approve a withdrawal (Backoffice/System)
     */
    async approveWithdraw(withdrawId: string): Promise<void> {
        const res = await this.db.prepare(
            "UPDATE withdraw_requests SET status = 'approved' WHERE id = ? AND status = 'requested'"
        ).bind(withdrawId).run();

        if (!res.meta.changed_db) {
            throw new Error('Withdrawal not found or not in requested state');
        }
    }

    /**
     * Mark as Paid (Success)
     */
    async markAsPaid(withdrawId: string): Promise<void> {
        // No ledger change needed, money was already debited.
        const res = await this.db.prepare(
            "UPDATE withdraw_requests SET status = 'paid', processed_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('approved', 'processing')"
        ).bind(withdrawId).run();

        if (!res.meta.changed_db) {
            throw new Error('Withdrawal not found or invalid state');
        }
    }

    /**
     * Reject Withdrawal (Reversal)
     * Must Credit the Ledger back.
     */
    async rejectWithdraw(withdrawId: string, reason: string, auditContext?: { actorId?: string, ip?: string, userAgent?: string }): Promise<void> {
        // 1. Get Request
        const req = await this.db.prepare(
            'SELECT * FROM withdraw_requests WHERE id = ?'
        ).bind(withdrawId).first<WithdrawRequest>();

        if (!req) throw new Error('Withdrawal not found');
        if (req.status === 'rejected' || req.status === 'paid') {
            throw new Error('Withdrawal already finalized');
        }

        // 2. Atomic Reversal
        const ledgerId = crypto.randomUUID();

        const batch = [
            // Update Status
            this.db.prepare(
                "UPDATE withdraw_requests SET status = 'rejected', processed_at = CURRENT_TIMESTAMP WHERE id = ?"
            ).bind(withdrawId),

            // Credit Ledger (Refund)
            this.db.prepare(`
                INSERT INTO ledger_transactions (id, wallet_id, type, amount, reference, status)
                VALUES (?, ?, 'credit', ?, ?, 'confirmed')
            `).bind(ledgerId, req.wallet_id, req.amount, `REFUND:${withdrawId}:${reason}`)
        ];

        if (this.audit) {
            batch.push(this.audit.prepareLogStatement({
                actorType: auditContext?.actorId ? 'admin' : 'system', // Usually rejected by admin or system
                actorId: auditContext?.actorId || null,
                action: 'WITHDRAW_REJECTED',
                entity: 'withdraw_request',
                entityId: withdrawId,
                after: { status: 'rejected', reason },
                ip: auditContext?.ip,
                userAgent: auditContext?.userAgent
            }));
        }

        await this.db.batch(batch);
    }
}
