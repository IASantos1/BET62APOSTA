
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
        console.error('Self-exclusion check failed:', e);
        // Fail safe: if we can't check, we should probably allow? 
        // Or block to be safe? 
        // Better to block if error implies system failure, but let's log and proceed to avoid DoS if DB is glitchy?
        // Responsible gaming: better to block if uncertain.
        return c.json({ error: 'System error verifying account status' }, 500);
    }

    await next();
}
