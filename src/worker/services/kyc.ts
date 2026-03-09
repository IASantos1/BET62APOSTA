import { D1Database } from '@cloudflare/workers-types';
import { KYCStatus } from './accountState';
import { AuditService } from './audit';
import { NotificationService } from './notification';

export type KYCDocumentType = 'id_card' | 'iban_proof' | 'bank_statement';
export type KYCDocumentStatus = 'uploaded' | 'verified' | 'rejected';

export class KYCService {
    private notifications: NotificationService;

    constructor(private db: D1Database, private audit?: AuditService) {
        this.notifications = new NotificationService(db);
    }

    async ensureProfile(userId: string) {
        const existing = await this.db.prepare('SELECT id FROM kyc_profiles WHERE user_id = ?').bind(userId).first();
        if (!existing) {
            await this.db.prepare(`
                INSERT INTO kyc_profiles (id, user_id, status)
                VALUES (?, ?, 'unverified')
            `).bind(crypto.randomUUID(), userId).run();
        }
    }

    async submitDocument(userId: string, type: string, filePath: string, auditContext?: { ip?: string, userAgent?: string }) {
        if (!['id_card', 'iban_proof', 'bank_statement'].includes(type)) {
            throw new Error('Invalid document type. Must be id_card, iban_proof, or bank_statement');
        }

        await this.ensureProfile(userId);
        const profile = await this.db.prepare('SELECT id, status FROM kyc_profiles WHERE user_id = ?').bind(userId).first();
        if (!profile) throw new Error('Profile not found');

        const profileId = profile.id as string;

        // Check if document of this type already exists
        const existingDoc = await this.db.prepare('SELECT id FROM kyc_documents WHERE kyc_profile_id = ? AND type = ?').bind(profileId, type).first();
        
        const docId = existingDoc ? existingDoc.id : crypto.randomUUID();

        if (existingDoc) {
             await this.db.prepare(`
                UPDATE kyc_documents SET file_path = ?, status = 'uploaded', updated_at = ?
                WHERE id = ?
            `).bind(filePath, Date.now(), docId).run();
        } else {
            await this.db.prepare(`
                INSERT INTO kyc_documents (id, kyc_profile_id, type, file_path, status)
                VALUES (?, ?, ?, ?, 'uploaded')
            `).bind(docId, profileId, type, filePath).run();
        }

        // Audit Log
        if (this.audit) {
            await this.audit.log({
                actorType: 'user',
                actorId: userId,
                action: 'KYC_DOCUMENT_UPLOAD',
                entity: 'kyc_profile',
                entityId: profileId,
                after: { type, filePath, docId },
                ip: auditContext?.ip,
                userAgent: auditContext?.userAgent
            });
        }

        // Update status to pending if it was unverified or rejected
        const currentStatus = (profile as any).status;
        if (['unverified', 'rejected'].includes(currentStatus)) {
            await this.updateStatus(userId, 'pending', null, 'Document uploaded', auditContext);
        }
    }

    async getDocuments(userId: string) {
        const profile = await this.db.prepare('SELECT id FROM kyc_profiles WHERE user_id = ?').bind(userId).first();
        if (!profile) return [];
        const docs = await this.db.prepare('SELECT * FROM kyc_documents WHERE kyc_profile_id = ?').bind(profile.id).all();
        return docs.results;
    }

    async validateDocument(docId: string, isValid: boolean, reason?: string, adminId: string | null = 'system', extractedIban?: string) {
        const doc = await this.db.prepare('SELECT kyc_profile_id, type FROM kyc_documents WHERE id = ?').bind(docId).first();
        if (!doc) throw new Error('Document not found');

        const newStatus: KYCDocumentStatus = isValid ? 'verified' : 'rejected';
        let notes = reason || null;

        if (isValid && doc.type === 'iban_proof' && extractedIban) {
            notes = (notes ? notes + '; ' : '') + `VERIFIED_IBAN:${extractedIban}`;
        }
        
        await this.db.prepare('UPDATE kyc_documents SET status = ?, notes = ? WHERE id = ?')
            .bind(newStatus, notes, docId).run();

        // Trigger Profile Re-evaluation
        const profile = await this.db.prepare('SELECT user_id FROM kyc_profiles WHERE id = ?').bind(doc.kyc_profile_id).first();
        if (profile) {
            await this.evaluateProfile(profile.user_id as string, adminId);
        }
    }

    async evaluateProfile(userId: string, adminId: string | null = 'system') {
        const profile = await this.db.prepare('SELECT id FROM kyc_profiles WHERE user_id = ?').bind(userId).first();
        if (!profile) return;

        const docs = await this.db.prepare('SELECT type, status, notes FROM kyc_documents WHERE kyc_profile_id = ?').bind(profile.id).all<any>();
        const results = docs.results || [];

        const requiredTypes = ['id_card', 'iban_proof', 'bank_statement'];
        const validDocs = results.filter(d => d.status === 'verified');
        const validTypes = validDocs.map(d => d.type);
        const rejectedTypes = results.filter(d => d.status === 'rejected').map(d => d.type);

        const allValid = requiredTypes.every(t => validTypes.includes(t));
        const anyRejected = requiredTypes.some(t => rejectedTypes.includes(t));

        if (allValid) {
            // Check for Locked IBAN in notes
            const ibanDoc = validDocs.find(d => d.type === 'iban_proof');
            if (ibanDoc && ibanDoc.notes && ibanDoc.notes.includes('VERIFIED_IBAN:')) {
                const match = ibanDoc.notes.match(/VERIFIED_IBAN:([A-Z0-9]+)/);
                if (match) {
                    const iban = match[1];
                    // Update locked_iban
                     await this.db.prepare('UPDATE kyc_profiles SET locked_iban = ? WHERE id = ?').bind(iban, profile.id).run();
                }
            }
            await this.updateStatus(userId, 'verified', adminId, 'All documents valid');
        } else if (anyRejected) {
            await this.updateStatus(userId, 'rejected', adminId, 'One or more documents rejected');
        }
        // Else remains pending
    }

    async updateStatus(userId: string, newStatus: KYCStatus, adminId: string | null, reason: string, auditContext?: { ip?: string, userAgent?: string }): Promise<void> {
        const profile = await this.db.prepare('SELECT id, status FROM kyc_profiles WHERE user_id = ?').bind(userId).first();
        if (!profile) {
            // If profile doesn't exist, create it first (e.g. initial suspension of a new user)
            await this.ensureProfile(userId);
             // Re-fetch
             await this.updateStatus(userId, newStatus, adminId, reason, auditContext);
             return;
        }

        const currentStatus = profile.status as string;
        const profileId = profile.id as string;

        if (currentStatus === newStatus) return;

        // Update profile
        let verifiedAt = null;
        if (newStatus === 'verified') verifiedAt = Date.now();

        await this.db.prepare(`
            UPDATE kyc_profiles
            SET status = ?, verified_at = COALESCE(?, verified_at), updated_at = ?
            WHERE id = ?
        `).bind(newStatus, verifiedAt, Date.now(), profileId).run();

        // Send Notification
        if (newStatus === 'verified') {
            await this.notifications.create(userId, 'success', 'A sua conta foi verificada com sucesso. Os levantamentos estão agora disponíveis.');
        } else if (newStatus === 'rejected') {
            await this.notifications.create(userId, 'error', 'Os documentos enviados não puderam ser validados. Por favor, envie novos documentos legíveis.');
        } else if (newStatus === 'suspended' || newStatus === 'closed') {
            await this.notifications.create(userId, 'error', 'A sua conta foi suspensa por motivos de segurança. Contacte o suporte.');
        }

        // Log audit (Legacy)
        await this.db.prepare(`
            INSERT INTO kyc_audit_logs (kyc_profile_id, admin_id, action, reason, previous_status, new_status)
            VALUES (?, ?, ?, ?, ?, ?)
        `).bind(profileId, adminId, 'status_change', reason, currentStatus, newStatus).run();

        // Audit Log (Tier-1)
        if (this.audit) {
            await this.audit.log({
                actorType: adminId ? 'admin' : 'system',
                actorId: adminId,
                action: 'KYC_STATUS_CHANGE',
                entity: 'kyc_profile',
                entityId: profileId,
                before: { status: currentStatus },
                after: { status: newStatus, reason },
                ip: auditContext?.ip,
                userAgent: auditContext?.userAgent
            });
        }
    }

    async blockUser(userId: string, reason: string, adminId: string | null = 'system', auditContext?: { ip?: string, userAgent?: string }) {
        await this.updateStatus(userId, 'suspended', adminId, reason, auditContext);
    }
}
