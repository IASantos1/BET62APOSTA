import { Hono } from 'hono';
import { Env } from '../shared/types';
import { PasswordService } from './services/security/passwordService';
import { TokenService } from './services/security/tokenService';
import { TwoFAService } from './services/security/twofaService';
import { AuditService } from './services/audit';
import { ensureUserSchema } from './db';

const authRouter = new Hono<{ Bindings: Env }>();

const getServices = (env: Env) => {
    return {
        password: new PasswordService(),
        token: new TokenService(env.JWT_SECRET || 'secret-key-must-be-set'),
        twofa: new TwoFAService(),
        audit: new AuditService(env.DB)
    };
};

authRouter.post('/signup', async (c) => {
    const { firstName, lastName, email, password, dob, country } = await c.req.json();
    
    // Tier-1 Validation
    if (!email || !password || !firstName || !lastName || !dob || !country) {
        return c.json({ error: 'All fields are required' }, 400);
    }

    const { password: pwService, token: tokenService } = getServices(c.env);

    // Check if user exists (by email/username)
    const existing = await c.env.DB.prepare('SELECT id FROM user WHERE username = ?').bind(email).first();
    if (existing) return c.json({ error: 'Email already registered' }, 400);

    const userId = crypto.randomUUID();
    const hashedPassword = await pwService.hash(password);

    try {
        await c.env.DB.batch([
            // Create Core User (Username is Email)
            c.env.DB.prepare('INSERT INTO user (id, username, twofa_enabled) VALUES (?, ?, 0)').bind(userId, email),
            
            // Create Credentials
            c.env.DB.prepare('INSERT INTO user_key (id, user_id, hashed_password) VALUES (?, ?, ?)').bind(`username:${email}`, userId, hashedPassword),
            
            // Create Wallet
            c.env.DB.prepare('INSERT INTO wallets (user_id, currency, balance) VALUES (?, ?, 0)').bind(userId, 'EUR'),
            
            // Create Profile (Tier-1 Fields)
            c.env.DB.prepare(`
                INSERT INTO user_profile (
                    user_id, first_name, last_name, email, birth_date, country, 
                    kyc_status, terms_accepted_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'unverified', CURRENT_TIMESTAMP)
            `).bind(userId, firstName, lastName, email, dob, country)
        ]);

        const accessToken = await tokenService.createAccessToken(userId);
        const refreshToken = await tokenService.createRefreshToken();
        
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
        await c.env.DB.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), userId, refreshToken, expiresAt).run();

        return c.json({
            success: true,
            user: { id: userId, username: email, twofa_enabled: false },
            token: accessToken,
            refreshToken
        });
    } catch (e: any) {
        console.error('Signup error', e);
        return c.json({ error: 'Server error' }, 500);
    }
});

authRouter.post('/signin', async (c) => {
    try {
        const { username, password } = await c.req.json();
        const { password: pwService, token: tokenService, audit } = getServices(c.env);
        const ip = c.req.header('CF-Connecting-IP') || 'unknown';
        const userAgent = c.req.header('User-Agent') || 'unknown';

        // Ensure schema in dev environment to handle missing tables (like refresh_tokens)
        if (c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'development') {
            try { await ensureUserSchema(c.env.DB); } catch (e) { console.error('ensureUserSchema failed', e); }
        }

        let user = await c.env.DB.prepare('SELECT * FROM user WHERE username = ?').bind(username).first<any>();

        // Auto-registration: dev/local environment OR (.local suffix in non-production envs only)
        const isDevEnv = c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'development';
        const isLocalSuffix = String(username).endsWith('.local');
        const allowAutoRegister = isDevEnv || (isLocalSuffix && c.env.ENVIRONMENT !== 'production');

        if (!user && allowAutoRegister) {
            console.log('[Auth] Auto-registering dev user:', username);
            try { 
                // Fix dynamic import issue by using standard import if possible, or just skip ensureUserSchema if it causes issues
                await ensureUserSchema(c.env.DB); 
            } catch (e) { console.error('ensureUserSchema failed', e); }
            
            const userId = crypto.randomUUID();
            const hashedPassword = await pwService.hash(password);
            try {
                await c.env.DB.prepare('INSERT INTO user (id, username) VALUES (?, ?)').bind(userId, username).run();
                user = { id: userId, username };
            } catch (e: any) {
                return c.json({ error: e.message || 'Server error' }, 500);
            }
            const accessToken = await tokenService.createAccessToken(user.id);
            const refreshToken = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            await c.env.DB.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, refreshToken, expiresAt).run();

            return c.json({
                success: true,
                user: { id: user.id, username: user.username, twofa_enabled: false },
                token: accessToken,
                refreshToken
            });
        }
        
        if (!user) {
            await audit.log({
                actorType: 'user',
                actorId: null,
                action: 'LOGIN_FAILED',
                entity: 'user',
                entityId: null,
                ip,
                userAgent
            });
            return c.json({ error: 'Invalid credentials' }, 401);
        }

        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            await audit.log({
                actorType: 'user',
                actorId: user.id,
                action: 'LOGIN_FAILED',
                entity: 'user',
                entityId: user.id,
                before: { reason: 'Account locked' },
                ip,
                userAgent
            });
            return c.json({ error: 'Account locked. Try again later.' }, 403);
        }

        const key = await c.env.DB.prepare('SELECT hashed_password FROM user_key WHERE user_id = ?').bind(user.id).first<any>();
        // Password bypass: dev environment OR (.local suffix in non-production envs only)
        // In production, ALL users (including .local) require valid password.
        const allowPasswordBypass =
            (c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'development')
            || (String(username).endsWith('.local') && c.env.ENVIRONMENT !== 'production' && !key);
        if (allowPasswordBypass) {
            const accessToken = await tokenService.createAccessToken(user.id);
            const refreshToken = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            await c.env.DB.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, refreshToken, expiresAt).run();

            await audit.log({
                actorType: 'user',
                actorId: user.id,
                action: 'LOGIN_SUCCESS',
                entity: 'user',
                entityId: user.id,
                ip,
                userAgent
            });
            return c.json({
                success: true,
                user: { id: user.id, username: user.username, twofa_enabled: !!user.twofa_enabled },
                token: accessToken,
                refreshToken
            });
        }
        if (!key) {
            await audit.log({
                actorType: 'user',
                actorId: user.id,
                action: 'LOGIN_FAILED',
                entity: 'user',
                entityId: user.id,
                before: { reason: 'No password set' },
                ip,
                userAgent
            });
            return c.json({ error: 'Invalid credentials' }, 401);
        }

        const isValid = await pwService.verify(key.hashed_password, password);
        if (!isValid) {
            const attempts = (user.failed_attempts || 0) + 1;
            let lockUntil = null;
            if (attempts >= 5) {
                lockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
            }
            await c.env.DB.prepare('UPDATE user SET failed_attempts = ?, locked_until = ? WHERE id = ?').bind(attempts, lockUntil, user.id).run();
            
            await audit.log({
                actorType: 'user',
                actorId: user.id,
                action: 'LOGIN_FAILED',
                entity: 'user',
                entityId: user.id,
                before: { attempts },
                ip,
                userAgent
            });
            return c.json({ error: 'Invalid credentials' }, 401);
        }

        // Reset attempts on success
        await c.env.DB.prepare('UPDATE user SET failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(user.id).run();

        if (user.twofa_enabled) {
            return c.json({
                success: true,
                requires2fa: true,
                userId: user.id
            });
        }

        const accessToken = await tokenService.createAccessToken(user.id);
        const refreshToken = await tokenService.createRefreshToken();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        
        await c.env.DB.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, refreshToken, expiresAt).run();
        
        await audit.log({
            actorType: 'user',
            actorId: user.id,
            action: 'LOGIN_SUCCESS',
            entity: 'user',
            entityId: user.id,
            ip,
            userAgent
        });

        return c.json({
            success: true,
            user: { id: user.id, username: user.username, twofa_enabled: !!user.twofa_enabled },
            token: accessToken,
            refreshToken
        });
    } catch (e: any) {
        console.error('Signin error', e);
        return c.json({ error: 'Server error: ' + (e.message || e) }, 500);
    }
});

authRouter.post('/2fa/login', async (c) => {
    const { userId, token } = await c.req.json();
    const { twofa, token: tokenService, audit } = getServices(c.env);
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const userAgent = c.req.header('User-Agent') || 'unknown';

    const user = await c.env.DB.prepare('SELECT * FROM user WHERE id = ?').bind(userId).first<any>();
    if (!user || !user.twofa_secret) return c.json({ error: 'Invalid request' }, 400);

    const valid = twofa.verify(user.twofa_secret, token);
    if (!valid) {
        await audit.log({
            actorType: 'user',
            actorId: userId,
            action: 'LOGIN_FAILED_2FA',
            entity: 'user',
            entityId: userId,
            ip,
            userAgent
        });
        return c.json({ error: 'Invalid code' }, 401);
    }

    const accessToken = await tokenService.createAccessToken(user.id);
    const refreshToken = await tokenService.createRefreshToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    
    await c.env.DB.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, refreshToken, expiresAt).run();
    
    await audit.log({
        actorType: 'user',
        actorId: user.id,
        action: 'LOGIN_SUCCESS_2FA',
        entity: 'user',
        entityId: user.id,
        ip,
        userAgent
    });

    return c.json({
        success: true,
        user: { id: user.id, username: user.username, twofa_enabled: !!user.twofa_enabled },
        token: accessToken,
        refreshToken
    });
});

authRouter.post('/refresh', async (c) => {
    const { refreshToken } = await c.req.json();
    if (!refreshToken) return c.json({ error: 'Missing token' }, 400);

    const { token: tokenService } = getServices(c.env);

    const stored = await c.env.DB.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0').bind(refreshToken).first<any>();
    if (!stored) return c.json({ error: 'Invalid token' }, 401);

    if (new Date(stored.expires_at) < new Date()) {
        return c.json({ error: 'Token expired' }, 401);
    }

    await c.env.DB.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').bind(stored.id).run();

    const accessToken = await tokenService.createAccessToken(stored.user_id);
    const newRefreshToken = await tokenService.createRefreshToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await c.env.DB.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), stored.user_id, newRefreshToken, expiresAt).run();

    return c.json({
        success: true,
        token: accessToken,
        refreshToken: newRefreshToken
    });
});

authRouter.post('/2fa/setup', async (c) => {
    const authHeader = c.req.header('Authorization');
    const { token: tokenService, twofa } = getServices(c.env);
    
    if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
    const token = authHeader.split(' ')[1];
    const payload = await tokenService.verifyAccessToken(token);
    if (!payload) return c.json({ error: 'Unauthorized' }, 401);

    const user = await c.env.DB.prepare('SELECT username FROM user WHERE id = ?').bind(payload.sub).first<any>();
    if (!user) return c.json({ error: 'User not found' }, 404);

    const secret = twofa.generateSecret();
    const qrCode = await twofa.generateQRCode(secret, user.username);

    await c.env.DB.prepare('UPDATE user SET twofa_secret = ?, twofa_enabled = 0 WHERE id = ?').bind(secret, payload.sub).run();

    return c.json({
        success: true,
        secret,
        qrCode
    });
});

authRouter.post('/2fa/confirm', async (c) => {
    const authHeader = c.req.header('Authorization');
    const { token: tokenService, twofa } = getServices(c.env);
    const { token: code } = await c.req.json();

    if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
    const token = authHeader.split(' ')[1];
    const payload = await tokenService.verifyAccessToken(token);
    if (!payload) return c.json({ error: 'Unauthorized' }, 401);

    const user = await c.env.DB.prepare('SELECT twofa_secret FROM user WHERE id = ?').bind(payload.sub).first<any>();
    if (!user || !user.twofa_secret) return c.json({ error: 'Setup 2FA first' }, 400);

    const valid = twofa.verify(user.twofa_secret, code);
    if (!valid) return c.json({ error: 'Invalid code' }, 400);

    await c.env.DB.prepare('UPDATE user SET twofa_enabled = 1 WHERE id = ?').bind(payload.sub).run();

    return c.json({ success: true });
});

authRouter.get('/2fa/status', async (c) => {
    const authHeader = c.req.header('Authorization');
    const { token: tokenService } = getServices(c.env);
    
    if (!authHeader?.startsWith('Bearer ')) return c.json({ enabled: false });
    const token = authHeader.split(' ')[1];
    
    const payload = await tokenService.verifyAccessToken(token);
    if (!payload) return c.json({ enabled: false });

    const user = await c.env.DB.prepare('SELECT twofa_enabled FROM user WHERE id = ?').bind(payload.sub).first<any>();
    return c.json({ enabled: !!user?.twofa_enabled });
});

authRouter.get('/me', async (c) => {
    const authHeader = c.req.header('Authorization');
    const { token: tokenService } = getServices(c.env);
    
    if (!authHeader?.startsWith('Bearer ')) return c.json({ success: true, user: null });
    const token = authHeader.split(' ')[1];
    const payload = await tokenService.verifyAccessToken(token);
    if (!payload) return c.json({ success: true, user: null });

    try {
        const user = await c.env.DB.prepare(`
            SELECT 
                u.id, 
                u.username, 
                COALESCE(up.twofa_enabled, 0) AS twofa_enabled, 
                COALESCE(kp.status, 'unverified') AS kyc_status, 
                COALESCE(up.is_operator, 0) AS is_operator, 
                COALESCE(w.balance, 0) AS balance, 
                COALESCE(w.currency, 'EUR') AS currency
            FROM user u 
            LEFT JOIN user_profile up ON u.id = up.user_id 
            LEFT JOIN kyc_profiles kp ON u.id = kp.user_id
            LEFT JOIN wallets w ON u.id = w.user_id
            WHERE u.id = ?
        `).bind(payload.sub).first<any>();
        
        if (!user) return c.json({ success: true, user: null });

        const isDev = c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'development';
        if (isDev) {
            user.is_operator = 1;
        }

        return c.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                twofa_enabled: !!user.twofa_enabled,
                kyc_status: user.kyc_status,
                is_operator: user.is_operator,
                balance: user.balance || 0,
                currency: user.currency || 'EUR'
            }
        });
    } catch (e: any) {
        console.error('[Auth Error] /me endpoint failed:', e);
        return c.json({ error: 'Internal Server Error', detail: e.message }, 500);
    }
});

authRouter.post('/logout', async (c) => {
    let refreshToken: string | undefined;
    try {
        const body = await c.req.json();
        refreshToken = body.refreshToken;
    } catch (e) {
        // Body might be empty, ignore
    }

    const { audit } = getServices(c.env);
    const authHeader = c.req.header('Authorization');
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const userAgent = c.req.header('User-Agent') || 'unknown';
    
    let userId = null;
    
    // Try to get user ID from access token for audit log
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const { token: tokenService } = getServices(c.env);
            const payload = await tokenService.verifyAccessToken(token);
            if (payload) userId = payload.sub;
        } catch (e) {
            // Ignore token validation errors during logout
        }
    }

    if (refreshToken) {
        await c.env.DB.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').bind(refreshToken).run();
    }
    
    if (userId) {
        await audit.log({
            actorType: 'user',
            actorId: userId,
            action: 'LOGOUT',
            entity: 'user',
            entityId: userId,
            ip,
            userAgent
        });
    }

    return c.json({ success: true });
});

export default authRouter;
