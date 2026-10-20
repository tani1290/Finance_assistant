/**
 * Phase 10 — Bank statement CSV transaction-type classification regression tests.
 *
 * Deterministic by construction:
 *  - the database module is MOCKED (no DB required); `transaction.findMany`
 *    resolves to an empty history so every row is treated as new.
 *  - classification is a pure function, and `processStatementCSV` performs no
 *    other I/O.
 *
 * Regression under test: with a single positive "Amount" column and no
 * Debit/Credit columns, the previous fallback classified every row as INCOME,
 * silently flipping outgoing debits into income and inflating reported earnings.
 */

jest.mock('../config/database', () => ({
  transaction: { findMany: jest.fn().mockResolvedValue([]) },
}));

const documentIngestionService = require('../services/documentIngestionService');

describe('Phase 10 — Statement CSV transaction-type classification', () => {
  describe('detectTransactionType()', () => {
    it('treats a populated Debit column as EXPENSE and a Credit column as INCOME', () => {
      expect(documentIngestionService.detectTransactionType({ isDebitCol: true })).toBe('EXPENSE');
      expect(documentIngestionService.detectTransactionType({ isCreditCol: true })).toBe('INCOME');
    });

    it('honours an explicit DR/CR/INCOME/EXPENSE type column regardless of amount sign', () => {
      expect(documentIngestionService.detectTransactionType({ rawType: 'DR', rawAmount: '5000' })).toBe('EXPENSE');
      expect(documentIngestionService.detectTransactionType({ rawType: 'CR', rawAmount: '5000' })).toBe('INCOME');
      expect(documentIngestionService.detectTransactionType({ rawType: 'EXPENSE', rawAmount: '5000' })).toBe('EXPENSE');
      expect(documentIngestionService.detectTransactionType({ rawType: 'INCOME', rawAmount: '5000' })).toBe('INCOME');
    });

    it('reads a CR/DR or +/- marker embedded in the amount cell', () => {
      expect(documentIngestionService.detectTransactionType({ rawAmount: '5000 DR' })).toBe('EXPENSE');
      expect(documentIngestionService.detectTransactionType({ rawAmount: '5000 CR' })).toBe('INCOME');
      expect(documentIngestionService.detectTransactionType({ rawAmount: '-5000' })).toBe('EXPENSE');
      expect(documentIngestionService.detectTransactionType({ rawAmount: '+5000' })).toBe('INCOME');
    });

    it('uses narration semantics when only a positive Amount column exists', () => {
      expect(documentIngestionService.detectTransactionType({ rawAmount: '499', description: 'UPI/DR/PAID TO SWIGGY' })).toBe('EXPENSE');
      expect(documentIngestionService.detectTransactionType({ rawAmount: '85000', description: 'SALARY CREDIT FROM ACME' })).toBe('INCOME');
    });

    it('defaults to EXPENSE for an ambiguous positive amount (never overstates income)', () => {
      // The exact regression: positive amount, no debit/credit column, no type
      // column and no narration clue must NOT become INCOME.
      expect(documentIngestionService.detectTransactionType({ rawAmount: '2500', description: 'TXN 88213' })).toBe('EXPENSE');
    });

    it('recognises internal transfers', () => {
      expect(documentIngestionService.detectTransactionType({ rawAmount: '10000', description: 'Self transfer to savings' })).toBe('TRANSFER');
    });
  });

  describe('processStatementCSV()', () => {
    it('classifies single-Amount rows by their Type column without flipping EXPENSE to INCOME', async () => {
      const csvContent = [
        'Date,Description,Amount,Type',
        '2026-08-10,Salary Deposit,85000,INCOME',
        '2026-08-12,Grocery Supermarket,4200,EXPENSE',
      ].join('\n');

      const result = await documentIngestionService.processStatementCSV({ userId: 'user-1', csvContent });
      expect(result.validCount).toBe(2);
      const byDesc = Object.fromEntries(result.validRows.map(r => [r.description, r.type]));
      expect(byDesc['Salary Deposit']).toBe('INCOME');
      expect(byDesc['Grocery Supermarket']).toBe('EXPENSE');
    });

    it('extracts running balance, reference id and remarks columns', async () => {
      const csvContent = [
        'Date,Narration,Debit,Credit,Balance,Ref No,Remarks',
        '2026-08-11,PAID TO AMAZON,1500,,98500,TXN12345,Marketplace order',
        '2026-08-12,SALARY CREDIT,,50000,148500,TXN12346,August salary',
      ].join('\n');

      const result = await documentIngestionService.processStatementCSV({ userId: 'user-1', csvContent });
      expect(result.validCount).toBe(2);

      const debitRow = result.validRows.find(r => r.description === 'PAID TO AMAZON');
      expect(debitRow.type).toBe('EXPENSE');
      expect(debitRow.amount).toBe(1500);
      expect(debitRow.runningBalance).toBe(98500);
      expect(debitRow.referenceId).toBe('TXN12345');
      expect(debitRow.remarks).toBe('Marketplace order');

      const creditRow = result.validRows.find(r => r.description === 'SALARY CREDIT');
      expect(creditRow.type).toBe('INCOME');
      expect(creditRow.amount).toBe(50000);
    });
  });
});
