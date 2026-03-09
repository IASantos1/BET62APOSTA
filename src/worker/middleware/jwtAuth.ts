
import { createMiddleware } from 'hono/factory';
import { TokenService } from '../services/security/tokenService';
import { Env } from '../../shared/types';

export type Variables = {
    user: {
        userId: string;
    }
};

export type HonoEnv = {
    Bindings: Env;
    Variables: Variables;
};

export const verifyAuth = createMiddleware<HonoEnv>(async (c, next) => {
    let token: string | undefined;
    
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else {
        const queryToken = c.req.query('token');
        if (queryToken) {
            token = queryToken;
        }
    }

    if (!token) {
        // console.log(`[Auth] Missing/Invalid Header on: ${c.req.path}`);
        return c.json({ error: 'Unauthorized' }, 401);
    }

    // Ensure JWT_SECRET is available or use a fallback for dev safety (though explicit is better)
    const secret = c.env.JWT_SECRET;
    if (!secret) {
        console.error('JWT_SECRET is not set');
        return c.json({ error: 'Server configuration error' }, 500);
    }

    const tokenService = new TokenService(secret);

    const payload = await tokenService.verifyAccessToken(token);
    if (!payload) {
        // console.log(`[Auth] Invalid Token on: ${c.req.path}`);
        return c.json({ error: 'Unauthorized' }, 401);
    }

    c.set('user', { userId: payload.sub });
    await next();
});
