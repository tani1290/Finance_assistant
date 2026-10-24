/**
 * Pure validation for off-host backup publishing. The AWS calls themselves are
 * not mocked: these tests only prove that unsafe names, prefixes and manifests
 * are rejected before any network operation can run.
 */

const {
  validateBucket,
  validatePrefix,
  validateArchiveName,
  validateEncryptedManifest,
  buildRemoteKey,
  maskSecretLikeValues,
} = require('../../scripts/lib/backupRemote');

const checksum = 'a'.repeat(64);
const validManifest = (overrides = {}) => ({
  file: 'finpro-finpro-2026-10-21_02-17-00-000.dump.enc',
  encrypted: true,
  encryption: { algorithm: 'aes-256-gcm', version: 1, keyEnv: 'BACKUP_ENCRYPTION_KEY' },
  bytes: 4096,
  checksumSha256: checksum,
  plaintextBytes: 8192,
  plaintextChecksumSha256: 'b'.repeat(64),
  ...overrides,
});

describe('bucket validation', () => {
  test('accepts valid S3-compatible bucket names', () => {
    expect(validateBucket('finpro-backups')).toBe('finpro-backups');
    expect(validateBucket('my.bucket-1')).toBe('my.bucket-1');
    expect(validateBucket('abc')).toBe('abc');
  });

  test('rejects empties, uppercase, short, traversal and IP-like names', () => {
    for (const value of ['', 'FinPro-Backups', 'ab', 'a..b', '192.168.1.1', '-leading', 'trailing-']) {
      expect(() => validateBucket(value)).toThrow();
    }
  });
});

describe('prefix validation', () => {
  test('defaults and normalises slashes', () => {
    expect(validatePrefix(undefined)).toBe('finpro/postgres');
    expect(validatePrefix('/finpro/postgres/')).toBe('finpro/postgres');
    expect(validatePrefix('')).toBe('');
  });

  test('rejects traversal, backslashes, control characters and empty segments', () => {
    for (const value of ['../escape', 'a/../b', 'a//b', 'a\\b', 'a\u0000b', '.', 'a/.']) {
      expect(() => validatePrefix(value)).toThrow();
    }
  });
});

describe('archive name validation', () => {
  test('accepts only encrypted finpro archive names', () => {
    expect(validateArchiveName(validManifest().file)).toBe(validManifest().file);
    expect(() => validateArchiveName('finpro-db.dump')).toThrow(/unencrypted/);
    expect(() => validateArchiveName('other-db.dump.enc')).toThrow();
    expect(() => validateArchiveName('dir/finpro-db.dump.enc')).toThrow(/file name/);
    expect(() => validateArchiveName('finpro-db.dump.enc.json')).toThrow();
  });
});

describe('encrypted manifest validation', () => {
  test('accepts a complete encrypted manifest', () => {
    expect(validateEncryptedManifest(validManifest(), validManifest().file)).toBeTruthy();
  });

  test('rejects plaintext, mismatched, incomplete and weak manifests', () => {
    const name = validManifest().file;
    expect(() => validateEncryptedManifest(validManifest({ encrypted: false }), name)).toThrow();
    expect(() => validateEncryptedManifest(validManifest({ file: 'other.dump.enc' }), name)).toThrow();
    expect(() =>
      validateEncryptedManifest(
        validManifest({ encryption: { algorithm: 'aes-128-cbc', version: 1 } }),
        name
      )
    ).toThrow();
    expect(() => validateEncryptedManifest(validManifest({ bytes: 0 }), name)).toThrow();
    expect(() => validateEncryptedManifest(validManifest({ checksumSha256: 'nope' }), name)).toThrow();
    expect(() => validateEncryptedManifest(validManifest({ plaintextBytes: undefined }), name)).toThrow();
    expect(() =>
      validateEncryptedManifest(validManifest({ plaintextChecksumSha256: undefined }), name)
    ).toThrow();
  });
});

describe('remote key construction', () => {
  test('uses a UTC year/month partition and the archive basename', () => {
    const key = buildRemoteKey({
      prefix: 'finpro/postgres',
      fileName: 'finpro-finpro-2026-10-21_02-17-00-000.dump.enc',
      date: new Date('2026-10-21T02:17:00Z'),
    });
    expect(key).toBe(
      'finpro/postgres/2026/10/finpro-finpro-2026-10-21_02-17-00-000.dump.enc'
    );
  });

  test('supports an empty prefix', () => {
    const key = buildRemoteKey({
      prefix: '',
      fileName: 'finpro-a-1.dump.enc',
      date: new Date('2026-01-02T00:00:00Z'),
    });
    expect(key).toBe('2026/01/finpro-a-1.dump.enc');
  });
});

describe('log masking for provider errors', () => {
  test('redacts credential-like values and truncates', () => {
    const out = maskSecretLikeValues(
      'aws_access_key_id=AKIAEXAMPLE aws_secret_access_key=topsecret ' +
        'Authorization: Bearer abc.def X-Amz-Security-Token=tok' +
        'x'.repeat(5000)
    );
    expect(out).not.toContain('AKIAEXAMPLE');
    expect(out).not.toContain('topsecret');
    expect(out).not.toContain('abc.def');
    expect(out).not.toContain('tokxxxx');
    expect(out).toContain('[redacted]');
    expect(out.length).toBeLessThanOrEqual(4000);
  });
});
