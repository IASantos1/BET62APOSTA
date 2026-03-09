import { D1Database } from '@cloudflare/workers-types';

export interface AuditLogParams {
    actorType: 'user' | 'system' | 'admin';
    actorId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    before?: any;
    after?: any;
    ip?: string;
    userAgent?: string;
}

export class AuditService {
    constructor(private db: D1Database) {}

    async log(params: AuditLogParams) {
        try {
            await this.prepareLogStatement(params).run();
        } catch (e) {
            // Audit logging should essentially never fail the main request, 
            // but for Tier-1, a failure to audit is a critical system failure.
            // In a strict environment, we might throw here. 
            // For now, we log to console so infrastructure can pick it up.
            console.error('CRITICAL: Audit log failed', e, params);
        }
    }

    prepareLogStatement(params: AuditLogParams) {
        return this.db.prepare(`
            INSERT INTO audit_logs (
                id, actor_type, actor_id, action, entity, entity_id, 
                before_state, after_state, ip_address, user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            crypto.randomUUID(),
            params.actorType,
            params.actorId || null,
            params.action,
            params.entity,
            params.entityId || null,
            params.before ? JSON.stringify(params.before) : null,
            params.after ? JSON.stringify(params.after) : null,
            params.ip || 'unknown',
            params.userAgent || 'unknown'
        );
    }
}
