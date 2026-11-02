'use strict';

const syncService = require('../services/syncService');
const prisma = require('../config/database');

describe('syncService validation & contracts', () => {
  describe('bootstrap', () => {
    test('returns local-first capabilities and entity types', async () => {
      // Mock ensureState or db read if database is unreachable in test runner
      const origFindUnique = prisma.syncState.findUnique;
      prisma.syncState.findUnique = jest.fn().mockResolvedValue({
        userId: 'u1',
        revision: 42,
        lastBackupAt: new Date('2026-11-01T00:00:00Z'),
      });

      const res = await syncService.bootstrap('u1', 'dev-1');
      expect(res.serverRevision).toBe(42);
      expect(res.capabilities.localFirst).toBe(true);
      expect(res.capabilities.entities).toContain('transaction');
      expect(res.capabilities.entities).toContain('account');

      prisma.syncState.findUnique = origFindUnique;
    });
  });

  describe('push operation validation', () => {
    test('rejects missing deviceId', async () => {
      await expect(syncService.push('u1', { operations: [] })).rejects.toThrow(
        /deviceId is required/
      );
    });

    test('rejects empty operations array', async () => {
      await expect(
        syncService.push('u1', { deviceId: 'dev-1', operations: [] })
      ).rejects.toThrow(/operations must be a non-empty array/);
    });

    test('validates malformed operation items safely without throwing whole batch', async () => {
      const origFindUnique = prisma.syncState.findUnique;
      prisma.syncState.findUnique = jest.fn().mockResolvedValue({ userId: 'u1', revision: 1 });

      const res = await syncService.push('u1', {
        deviceId: 'dev-1',
        operations: [{ opId: 'bad-op-1', entityType: 'invalid_type', operation: 'CREATE' }],
      });

      expect(res.failed).toBe(1);
      expect(res.results[0].status).toBe('FAILED');
      expect(res.results[0].error.code).toBe('VALIDATION_ERROR');

      prisma.syncState.findUnique = origFindUnique;
    });
  });

  describe('idempotency and duplicate prevention', () => {
    test('replays prior result when (userId, opId) already exists', async () => {
      const FAKE_UUID = '00000000-0000-4000-a000-000000000001';
      const origFindUnique = prisma.syncState.findUnique;
      const origOpFind = prisma.syncOperation.findUnique;

      prisma.syncState.findUnique = jest.fn().mockResolvedValue({ userId: 'u1', revision: 5 });
      prisma.syncOperation.findUnique = jest.fn().mockResolvedValue({
        userId: 'u1',
        opId: 'op-100',
        entityType: 'transaction',
        entityId: FAKE_UUID,
        operation: 'CREATE',
        status: 'SYNCED',
        appliedRevision: 5,
        result: { id: FAKE_UUID, amount: 1500 },
      });

      const res = await syncService.push('u1', {
        deviceId: 'dev-1',
        operations: [
          {
            opId: 'op-100',
            entityType: 'transaction',
            entityId: FAKE_UUID,
            operation: 'CREATE',
            data: { amount: 1500, type: 'EXPENSE' },
          },
        ],
      });

      expect(res.results).toHaveLength(1);
      expect(res.results[0].replayed).toBe(true);
      expect(res.results[0].status).toBe('SYNCED');
      expect(res.results[0].result.amount).toBe(1500);

      prisma.syncState.findUnique = origFindUnique;
      prisma.syncOperation.findUnique = origOpFind;
    });
  });
});
