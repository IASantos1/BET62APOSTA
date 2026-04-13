import { verifyAccessToken } from '../services/auth.js';
import { getDb } from '../db.js';

export function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });

  const payload = verifyAccessToken(token);
  if (!payload) return res.status(401).json({ error: 'Token inválido ou expirado' });

  req.user = { userId: payload.sub, role: payload.role || 'user' };
  next();
}

export async function requireAdmin(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });

  const payload = verifyAccessToken(token);
  if (!payload) return res.status(401).json({ error: 'Token inválido' });

  const db = await getDb();
  const profile = await db.prepare('SELECT is_operator, role FROM user_profile WHERE user_id = ?').get(payload.sub);
  const isAdmin = profile?.is_operator === 1 || payload.role === 'admin';
  if (!isAdmin) return res.status(403).json({ error: 'Acesso negado' });

  req.user = { userId: payload.sub, role: 'admin' };
  next();
}
