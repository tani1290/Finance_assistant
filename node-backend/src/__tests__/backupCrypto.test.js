/**
 * Authenticated encryption for backup archives. These tests cover the failure
 * modes that matter for recovery: wrong key, tampering, truncation and a missing
 * key must all fail closed without leaving plaintext behind.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ALGORITHM,
  HEADER_BYTES,
  MAGIC,
  TAG_BYTES,
  resolveKey,
  resolveKeyFromEnv,
  isEncryptedArchive,
  readHeader,
  encryptFile,
  decryptFile,
} = require('../../scripts/lib/backupCrypto');

let workDir;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finpro-crypto-test-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const filePath = (name) => path.join(workDir, name);
const key = () => crypto.randomBytes(32).toString('base64');
const write = (name, data) => {
  const target = filePath(name);
  fs.writeFileSync(target, data, { mode: 0o600 });
  return target;
};
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

describe('key validation', () => {
  test('accepts base64, base64: and 64-character hex encodings', () => {
    const raw = crypto.randomBytes(32);
    const base64 = raw.toString('base64');
    const hex = raw.toString('hex');
    expect(resolveKey(base64).equals(raw)).toBe(true);
    expect(resolveKey(`base64:${base64}`).equals(raw)).toBe(true);
    expect(resolveKey(hex).equals(raw)).toBe(true);
    expect(resolveKey(`hex:${hex}`).equals(raw)).toBe(true);
    expect(resolveKey(raw).equals(raw)).toBe(true);
  });

  test('rejects empty, passphrase, wrong-length and malformed keys', () => {
    const cases = [
      '',
      'correct horse battery staple',
      'not base64!',
      crypto.randomBytes(31).toString('base64'),
      crypto.randomBytes(33).toString('base64'),
      'hex:abcd',
      `base64:${crypto.randomBytes(31).toString('base64')}`,
    ];
    for (const value of cases) {
      expect(() => resolveKey(value)).toThrow();
    }
  });

  test('does not echo key material in an error', () => {
    const weak = crypto.randomBytes(31).toString('base64');
    let message = '';
    try {
      resolveKey(weak);
    } catch (err) {
      message = err.message;
    }
    expect(message).not.toContain(weak);
    expect(message).toMatch(/32/);
  });

  test('missing environment key has a stable error code', () => {
    expect(() => resolveKeyFromEnv({})).toThrow(/BACKUP_ENCRYPTION_KEY|No backup encryption key/);
    try {
      resolveKeyFromEnv({});
    } catch (err) {
      expect(err.code).toBe('MISSING_BACKUP_KEY');
    }
  });

  test('recognises the encrypted archive extension only', () => {
    expect(isEncryptedArchive('finpro-db-1.dump.enc')).toBe(true);
    expect(isEncryptedArchive('finpro-db-1.dump')).toBe(false);
    expect(isEncryptedArchive('finpro-db-1.dump.enc.json')).toBe(false);
  });
});

describe('encrypt/decrypt round trip', () => {
  test('recovers the exact plaintext and reports its checksum', async () => {
    const original = crypto.randomBytes(256 * 1024);
    const input = write('source.dump', original);
    const encrypted = filePath('source.dump.enc');
    const output = filePath('roundtrip.dump');
    const encryptionKey = key();

    const meta = await encryptFile(input, encrypted, encryptionKey);
    expect(meta.algorithm).toBe(ALGORITHM);
    expect(meta.plaintextBytes).toBe(original.length);
    expect(meta.plaintextChecksumSha256).toBe(sha256(original));

    const encryptedBytes = fs.readFileSync(encrypted);
    expect(encryptedBytes.subarray(0, MAGIC.length).equals(MAGIC)).toBe(true);
    expect(encryptedBytes.length).toBe(HEADER_BYTES + original.length + TAG_BYTES);
    expect(encryptedBytes.includes(original.subarray(0, 64))).toBe(false);

    const decrypted = await decryptFile(encrypted, output, encryptionKey);
    expect(decrypted.plaintextBytes).toBe(original.length);
    expect(fs.readFileSync(output).equals(original)).toBe(true);
    expect(fs.statSync(output).mode & 0o777).toBe(0o600);
  });

  test('streams a multi-chunk archive and accepts a hex key', async () => {
    const original = crypto.randomBytes(2 * 1024 * 1024 + 17);
    const input = write('large.dump', original);
    const encrypted = filePath('large.dump.enc');
    const output = filePath('large-roundtrip.dump');
    const hexKey = crypto.randomBytes(32).toString('hex');

    await encryptFile(input, encrypted, hexKey);
    const header = readHeader(encrypted);
    expect(header.version).toBe(1);
    await decryptFile(encrypted, output, hexKey);
    expect(fs.readFileSync(output).equals(original)).toBe(true);
  });
});

describe('fail-closed behaviour', () => {
  let encrypted;
  let input;

  beforeEach(async () => {
    input = write('source.dump', Buffer.from('a backup with recoverable rows\n'.repeat(1000)));
    encrypted = filePath('source.dump.enc');
    await encryptFile(input, encrypted, key());
  });

  test('a wrong key cannot decrypt the archive', async () => {
    const output = filePath('wrong-key.dump');
    await expect(decryptFile(encrypted, output, key())).rejects.toMatchObject({
      code: 'BACKUP_DECRYPT_FAILED',
    });
    expect(fs.existsSync(output)).toBe(false);
    expect(fs.readdirSync(workDir).some((name) => name.includes('.partial-'))).toBe(false);
  });

  test('a modified ciphertext byte is rejected by GCM', async () => {
    const bytes = fs.readFileSync(encrypted);
    bytes[HEADER_BYTES + 10] ^= 0xff;
    fs.writeFileSync(encrypted, bytes);
    const output = filePath('tampered.dump');

    await expect(decryptFile(encrypted, output, key())).rejects.toMatchObject({
      code: 'BACKUP_DECRYPT_FAILED',
    });
    expect(fs.existsSync(output)).toBe(false);
  });

  test('a modified header is rejected before decryption', async () => {
    const bytes = fs.readFileSync(encrypted);
    bytes[4] = 2;
    fs.writeFileSync(encrypted, bytes);
    await expect(decryptFile(encrypted, filePath('v2.dump'), key())).rejects.toMatchObject({
      code: 'INVALID_BACKUP_FORMAT',
    });
  });

  test('a non-FinPro file is rejected', async () => {
    fs.writeFileSync(encrypted, crypto.randomBytes(2048));
    await expect(decryptFile(encrypted, filePath('bad.dump'), key())).rejects.toMatchObject({
      code: 'INVALID_BACKUP_FORMAT',
    });
  });

  test('truncated archives fail before writing plaintext', async () => {
    const bytes = fs.readFileSync(encrypted);
    fs.writeFileSync(encrypted, bytes.subarray(0, HEADER_BYTES + TAG_BYTES));

    await expect(decryptFile(encrypted, filePath('short.dump'), key())).rejects.toMatchObject({
      code: 'INVALID_BACKUP_FORMAT',
    });
    expect(fs.existsSync(filePath('short.dump'))).toBe(false);
  });

  test('a missing key fails before reading the archive', async () => {
    await expect(decryptFile(encrypted, filePath('no-key.dump'), '')).rejects.toMatchObject({
      code: 'MISSING_BACKUP_KEY',
    });
  });
});
