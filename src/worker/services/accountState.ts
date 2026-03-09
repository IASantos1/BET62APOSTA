import { D1Database } from '@cloudflare/workers-types';

export type KYCStatus = 'unverified' | 'pending' | 'verified' | 'rejected' | 'suspended' | 'closed';

export class AccountStateService {
    constructor(private db: D1Database) {}

    async getStatus(userId: string): Promise<KYCStatus> {
        const profile = await this.db.prepare('SELECT status FROM kyc_profiles WHERE user_id = ?').bind(userId).first();
        // Fallback: Check if user exists, if so return 'unverified', else 'closed'?
        // Assuming user exists if we are checking their status.
        if (!profile) return 'unverified';
        return profile.status as KYCStatus;
    }

    async canDeposit(userId: string): Promise<boolean> {
        const status = await this.getStatus(userId);
        return ['unverified', 'pending', 'verified'].includes(status);
    }

    async canWithdraw(userId: string): Promise<boolean> {
        const status = await this.getStatus(userId);
        return status === 'verified';
    }

    async canBet(userId: string): Promise<boolean> {
        const status = await this.getStatus(userId);
        return ['verified', 'pending'].includes(status);
    }

    async isAccountBlocked(userId: string): Promise<boolean> {
        const status = await this.getStatus(userId);
        return ['rejected', 'suspended', 'closed'].includes(status);
    }
}
