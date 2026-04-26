
import { Context, Next } from 'hono';

export async function checkSelfExclusion(c: Context, next: Next) {
    const user = c.get('user');
    if (!user || !user.userId) {
        return next();
    }

    try {
        const profile = await c.env.DB.prepare(
            'SELECT self_exclude, self_exclude_until FROM user_profile WHERE user_id = ?'
        ).bind(user.userId).first();

        if (profile && profile.self_exclude) {
            const now = new Date();
            let until: Date | null = null;
            
            if (profile.self_exclude_until) {
                until = new Date(profile.self_exclude_until);
            }

            // If "Permanent" (no date or far future) or still active
            if (!until || until > now) {
                return c.json({ 
                    error: 'Conta em autoexclusão. Esta ação não é permitida.',
                    code: 'SELF_EXCLUDED',
                    until: until ? until.toISOString() : 'PERMANENT'
                }, 403);
            } else {
                // Expired: auto-disable
                await c.env.DB.prepare(
                    'UPDATE user_profile SET self_exclude = 0, self_exclude_until = NULL WHERE user_id = ?'
                ).bind(user.userId).run();
            }
        }
    } catch (e) {
        // Most common cause: missing columns on legacy schemas. Don't block the user — just log and proceed.
        // Auto-exclusion on errors created false-positive 500s blocking all bets/deposits.
        console.error('Self-exclusion check failed (allowing through):', e);
    }

    await next();
}
