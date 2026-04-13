import { getDb } from '../db.js';
import { randomUUID } from 'crypto';

class LedgerService {
  async getBalance(userId) {
    const db = await getDb();
    const wallet = await db.prepare('SELECT id FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) return 0;
    const row = await db.prepare(`
      SELECT COALESCE(SUM(
        CASE
          WHEN type = 'credit' AND status = 'confirmed' THEN amount
          WHEN type = 'debit'  AND status = 'confirmed' THEN -amount
          WHEN type = 'hold'   AND status = 'confirmed' THEN -amount
          WHEN type = 'release'AND status = 'confirmed' THEN amount
          ELSE 0
        END
      ), 0) as balance FROM ledger_transactions WHERE wallet_id = ?
    `).get(wallet.id);
    return Math.max(0, row?.balance || 0);
  }

  async getWalletId(userId) {
    const db = await getDb();
    const w = await db.prepare('SELECT id FROM wallets WHERE user_id = ?').get(userId);
    return w?.id || null;
  }

  async credit(userId, amount, reference, description = '') {
    if (!(amount > 0)) throw new Error('Amount must be positive');
    const db = await getDb();
    let wallet = await db.prepare('SELECT id FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) {
      await db.prepare(`INSERT INTO wallets (user_id, currency) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING`).run(userId, 'EUR');
      wallet = await db.prepare('SELECT id FROM wallets WHERE user_id = ?').get(userId);
    }
    const alreadyCredited = await db.prepare('SELECT id FROM ledger_transactions WHERE reference = ? LIMIT 1').get(reference);
    if (alreadyCredited) return { id: alreadyCredited.id, skipped: true };
    const id = randomUUID();
    await db.prepare(
      'INSERT INTO ledger_transactions (id, wallet_id, type, amount, reference, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, wallet.id, 'credit', amount, reference, description, 'confirmed');
    return { id };
  }

  async debit(userId, amount, reference, description = '') {
    if (!(amount > 0)) throw new Error('Amount must be positive');
    const db = await getDb();
    const wallet = await db.prepare('SELECT id FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) throw new Error('Wallet not found');
    const balance = await this.getBalance(userId);
    if (balance < amount) throw new Error(`Saldo insuficiente. Disponível: €${balance.toFixed(2)}`);
    const id = randomUUID();
    await db.prepare(
      'INSERT INTO ledger_transactions (id, wallet_id, type, amount, reference, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, wallet.id, 'debit', amount, reference, description, 'confirmed');
    return { id };
  }

  async hold(userId, amount, reference, description = '') {
    if (!(amount > 0)) throw new Error('Amount must be positive');
    const db = await getDb();
    const wallet = await db.prepare('SELECT id FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) throw new Error('Wallet not found');
    const balance = await this.getBalance(userId);
    if (balance < amount) throw new Error(`Saldo insuficiente. Disponível: €${balance.toFixed(2)}`);
    const id = randomUUID();
    await db.prepare(
      'INSERT INTO ledger_transactions (id, wallet_id, type, amount, reference, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, wallet.id, 'hold', amount, reference, description, 'confirmed');
    return { id };
  }

  async release(userId, amount, reference, description = '') {
    if (!(amount > 0)) throw new Error('Amount must be positive');
    const db = await getDb();
    const wallet = await db.prepare('SELECT id FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) throw new Error('Wallet not found');
    const id = randomUUID();
    await db.prepare(
      'INSERT INTO ledger_transactions (id, wallet_id, type, amount, reference, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, wallet.id, 'release', amount, reference, description, 'confirmed');
    return { id };
  }

  async getTransactions(userId, limit = 50) {
    const db = await getDb();
    const wallet = await db.prepare('SELECT id FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) return [];
    return await db.prepare(
      'SELECT * FROM ledger_transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(wallet.id, limit);
  }
}

export const ledgerService = new LedgerService();
