import { Context, Next } from 'hono';
import { Env } from '../../shared/types';

export const adminAuth = async (c: Context<{ Bindings: Env }>, next: Next) => {
  // 1. Pegar token de várias formas possíveis (flexível para testes)
  const authHeader = c.req.header('Authorization');
  const queryKey = c.req.query('key') || c.req.query('token');
  
  let token = null;
  
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.replace('Bearer ', '');
  } else if (queryKey) {
    token = queryKey;
  }

  // 2. Modo desenvolvimento → permite sem token
  const isDev = c.env.ENVIRONMENT === 'development' || 
                c.env.ENVIRONMENT === 'dev' || 
                c.env.DEV_MODE === 'true' || 
                c.req.url.includes('localhost') || 
                c.req.url.includes('127.0.0.1');

  if (isDev) {
    // Em dev, apenas loga mas permite passar (ou poderiamos exigir token mesmo em dev se quisessemos ser estritos)
    // O usuário pediu para liberar em dev:
    // "Local / Dev: deve funcionar sem token"
    // Mas também pediu para logar
    // console.log('[AdminAuth] Modo desenvolvimento → acesso liberado sem token');
    await next();
    return;
  }

  // 3. Produção → exige token válido
  if (!token) {
    return c.json({ error: 'Token de autenticação obrigatório' }, 401);
  }

  if (token !== c.env.ADMIN_TOKEN) {
    console.warn('[AdminAuth] Tentativa de acesso com token inválido:', token.substring(0, 8) + '...');
    return c.json({ error: 'Acesso negado – token inválido' }, 403);
  }

  // 4. Opcional: log de acesso autorizado
  // console.log('[AdminAuth] Acesso autorizado para rota:', c.req.path);

  await next();
};
