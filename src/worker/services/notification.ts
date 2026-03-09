import { D1Database } from '@cloudflare/workers-types';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
    id: string;
    user_id: string;
    type: NotificationType;
    message: string;
    read: boolean;
    created_at: string;
}

export class NotificationService {
    constructor(private db: D1Database) {}

    async create(userId: string, type: NotificationType, message: string): Promise<string> {
        const id = crypto.randomUUID();
        await this.db.prepare(`
            INSERT INTO notifications (id, user_id, type, message, read)
            VALUES (?, ?, ?, ?, 0)
        `).bind(id, userId, type, message).run();
        return id;
    }

    async getUnread(userId: string): Promise<Notification[]> {
        const res = await this.db.prepare(`
            SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC
        `).bind(userId).all<Notification>();
        return res.results || [];
    }

    async markAsRead(notificationId: string, userId: string): Promise<void> {
        await this.db.prepare(`
            UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?
        `).bind(notificationId, userId).run();
    }
}
