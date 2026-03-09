import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LedgerService } from './ledger';

describe('LedgerService (Wallet Logic)', () => {
    let mockDb: any;
    let ledger: LedgerService;

    beforeEach(() => {
        // Mock D1 Database
        mockDb = {
            prepare: vi.fn(),
            batch: vi.fn(),
        };
        ledger = new LedgerService(mockDb as any);
    });

    it('should calculate balance correctly (Credit - Debit)', async () => {
        // Mock getBalance SQL result
        const mockBind = vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ balance: 100 }),
        });
        mockDb.prepare.mockReturnValue({ bind: mockBind });

        const balance = await ledger.getBalance(1);
        
        expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT COALESCE(SUM'));
        expect(mockBind).toHaveBeenCalledWith(1);
        expect(balance).toBe(100);
    });

    it('should allow credit transaction', async () => {
        const mockRun = vi.fn().mockResolvedValue({});
        const mockBind = vi.fn().mockReturnValue({ run: mockRun });
        mockDb.prepare.mockReturnValue({ bind: mockBind });

        const txId = await ledger.addTransaction(1, 'credit', 50, 'REF-123');

        expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ledger_transactions'));
        expect(mockBind).toHaveBeenCalledWith(expect.any(String), 1, 'credit', 50, 'REF-123');
        expect(txId).toBeDefined();
    });

    it('should allow debit transaction if sufficient funds', async () => {
        // Mock getBalance to return 100
        const mockBindBalance = vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ balance: 100 }),
        });
        
        // Mock Insert
        const mockRunInsert = vi.fn().mockResolvedValue({});
        const mockBindInsert = vi.fn().mockReturnValue({ run: mockRunInsert });

        // Sequence of calls: 1. getBalance, 2. Insert
        mockDb.prepare
            .mockReturnValueOnce({ bind: mockBindBalance }) // For getBalance check
            .mockReturnValueOnce({ bind: mockBindInsert }); // For Insert

        const txId = await ledger.addTransaction(1, 'debit', 50, 'REF-DEBIT');

        expect(txId).toBeDefined();
    });

    it('should REJECT debit transaction if insufficient funds', async () => {
        // Mock getBalance to return 10
        const mockBindBalance = vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ balance: 10 }),
        });
        
        mockDb.prepare.mockReturnValue({ bind: mockBindBalance });

        await expect(ledger.addTransaction(1, 'debit', 50, 'REF-FAIL'))
            .rejects
            .toThrow('Insufficient funds');
    });

    it('should REJECT negative amount', async () => {
        await expect(ledger.addTransaction(1, 'credit', -10, 'REF-NEG'))
            .rejects
            .toThrow('Amount must be positive');
    });
});
