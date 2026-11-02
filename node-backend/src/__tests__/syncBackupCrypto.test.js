'use strict';

const crypto = require('crypto');
const syncBackupCrypto = require('../services/syncBackupCrypto');

describe('syncBackupCrypto', () => {
  const originalBackupKey = process.env.SYNC_BACKUP_KEY;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.SYNC_BACKUP_KEY = 'test-sync-backup-secret-key-12345678';
  });

  afterAll(() => {
    process.env.SYNC_BACKUP_KEY = originalBackupKey;
    process.env.JWT_SECRET = originalJwtSecret;
  });

  test('isConfigured reports true when secret is present', () => {
    expect(syncBackupCrypto.isConfigured()).toBe(true);
  });

  test('isConfigured reports false when secret is missing or too short', () => {
    delete process.env.SYNC_BACKUP_KEY;
    delete process.env.JWT_SECRET;
    expect(syncBackupCrypto.isConfigured()).toBe(false);

    expect(() => syncBackupCrypto.encryptBackup('user-1', { foo: 'bar' })).toThrow(
      /Backup encryption is not configured/
    );
  });

  test('encrypt and decrypt round trip preserves payload', () => {
    const payload = {
      accounts: [{ id: 'acc-1', name: 'HDFC Bank', balance: 50000 }],
      transactions: [{ id: 'tx-1', amount: 250, type: 'EXPENSE' }],
      metadata: { app: 'FinPro', version: '1.1.0' },
    };

    const envelope = syncBackupCrypto.encryptBackup('user-alice', payload);
    expect(envelope.format).toBe('finpro-sync-backup-v1');
    expect(envelope.ciphertext).toBeDefined();
    expect(envelope.iv).toBeDefined();
    expect(envelope.authTag).toBeDefined();
    expect(envelope.salt).toBeDefined();
    expect(envelope.checksum).toBeDefined();
    expect(envelope.sizeBytes).toBeGreaterThan(0);

    const decrypted = syncBackupCrypto.decryptBackup('user-alice', envelope);
    expect(decrypted).toEqual(payload);
  });

  test('ciphertext cannot be decrypted by a different user id (AAD bound)', () => {
    const payload = { secretFinancials: 1000000 };
    const envelope = syncBackupCrypto.encryptBackup('user-alice', payload);

    expect(() => {
      syncBackupCrypto.decryptBackup('user-bob', envelope);
    }).toThrow(/This backup could not be decrypted/);
  });

  test('tampered ciphertext fails authentication', () => {
    const payload = { balance: 100 };
    const envelope = syncBackupCrypto.encryptBackup('user-alice', payload);

    const buf = Buffer.from(envelope.ciphertext, 'base64');
    buf[0] ^= 0xff; // Flip bits
    envelope.ciphertext = buf.toString('base64');

    expect(() => {
      syncBackupCrypto.decryptBackup('user-alice', envelope);
    }).toThrow(/This backup could not be decrypted/);
  });

  test('tampered auth tag fails authentication', () => {
    const payload = { balance: 100 };
    const envelope = syncBackupCrypto.encryptBackup('user-alice', payload);

    const buf = Buffer.from(envelope.authTag, 'base64');
    buf[0] ^= 0xff;
    envelope.authTag = buf.toString('base64');

    expect(() => {
      syncBackupCrypto.decryptBackup('user-alice', envelope);
    }).toThrow(/This backup could not be decrypted/);
  });

  test('mismatched checksum fails integrity verification', () => {
    const payload = { balance: 100 };
    const envelope = syncBackupCrypto.encryptBackup('user-alice', payload);

    // Give it a wrong sha256 checksum
    envelope.checksum = crypto.createHash('sha256').update('different').digest('hex');

    expect(() => {
      syncBackupCrypto.decryptBackup('user-alice', envelope);
    }).toThrow(/integrity check/);
  });
});
