/**
 * FinPro — authenticated encryption for PostgreSQL backup archives.
 *
 * Format (`FPE1`):
 *
 *   0    4    5         17                       n-16              n
 *   +----+----+---------+-------------------------+-----------------+
 *   |FPE1| 01 | 12-byte | AES-256-GCM ciphertext  | 16-byte GCM tag |
 *   +----+----+---------+-------------------------+-----------------+
 *
 * The header (magic + version + IV) is authenticated as additional data. The
 * plaintext is never written outside the caller-provided temporary path. Keys
 * are 32 raw bytes encoded as base64 (with or without padding) or 64 hex chars;
 * passphrases are intentionally not accepted.
 *
 * This module does not manage keys. The caller reads BACKUP_ENCRYPTION_KEY from
 * the secret store and passes it in. Errors never include key material.
 */

const crypto = require('crypto');
const fs = require('fs');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('FPE1', 'ascii');
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + IV_BYTES; // 17
const ALGORITHM = 'aes-256-gcm';
const MIN_ARCHIVE_BYTES = 1024;

const cryptoError = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

const decodeBase64 = (value) => {
  const normalized = value.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
  const decoded = Buffer.from(normalized, 'base64');
  // Reject strings that Buffer silently tolerates but that are not canonical.
  const canonical = decoded.toString('base64').replace(/=+$/, '');
  if (canonical !== normalized.replace(/=+$/, '')) return null;
  return decoded;
};

/** Decode and validate a 32-byte key. Never include the value in an error. */
const resolveKey = (keyMaterial) => {
  let key;
  if (Buffer.isBuffer(keyMaterial)) {
    key = keyMaterial;
  } else if (typeof keyMaterial === 'string') {
    let value = keyMaterial.trim();
    if (!value) throw cryptoError('Backup encryption key is empty.', 'MISSING_BACKUP_KEY');

    let explicitHex = false;
    let explicitBase64 = false;
    if (/^hex:/i.test(value)) {
      explicitHex = true;
      value = value.slice(4);
    } else if (/^base64:/i.test(value)) {
      explicitBase64 = true;
      value = value.slice(7);
    }

    if (explicitHex || (!explicitBase64 && /^[a-f0-9]{64}$/i.test(value))) {
      if (!/^[a-f0-9]{64}$/i.test(value)) {
        throw cryptoError(
          'Backup encryption key is invalid: hex keys must be exactly 64 hex characters (32 bytes).',
          'INVALID_BACKUP_KEY'
        );
      }
      key = Buffer.from(value, 'hex');
    } else {
      key = decodeBase64(value);
      if (!key) {
        throw cryptoError(
          'Backup encryption key is invalid: use a base64-encoded 32-byte key ' +
            '(or 64 hex characters). Passphrases are not accepted.',
          'INVALID_BACKUP_KEY'
        );
      }
    }
  } else {
    throw cryptoError(
      'No backup encryption key supplied. Set BACKUP_ENCRYPTION_KEY to a base64-encoded 32-byte key.',
      'MISSING_BACKUP_KEY'
    );
  }

  if (key.length !== 32) {
    throw cryptoError(
      `Backup encryption key is invalid: decoded to ${key.length} bytes, expected 32.`,
      'INVALID_BACKUP_KEY'
    );
  }
  return key;
};

const resolveKeyFromEnv = (env = process.env) => resolveKey(env.BACKUP_ENCRYPTION_KEY);

const isEncryptedArchive = (filePath) => /\.dump\.enc$/i.test(String(filePath || ''));

const readHeader = (filePath) => {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(HEADER_BYTES);
    const read = fs.readSync(fd, header, 0, HEADER_BYTES, 0);
    if (read !== HEADER_BYTES) {
      throw cryptoError('Encrypted backup is truncated (incomplete header).', 'INVALID_BACKUP_FORMAT');
    }
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw cryptoError('Not a FinPro encrypted backup (bad magic bytes).', 'INVALID_BACKUP_FORMAT');
    }
    const version = header[MAGIC.length];
    if (version !== VERSION) {
      throw cryptoError(`Unsupported encrypted backup version: ${version}.`, 'INVALID_BACKUP_FORMAT');
    }
    return {
      version,
      header,
      iv: header.subarray(MAGIC.length + 1),
    };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
};

const removeQuietly = (filePath) => {
  try {
    if (filePath) fs.unlinkSync(filePath);
  } catch {
    // best effort
  }
};

/**
 * Encrypt one file with AES-256-GCM.
 * Returns { algorithm, version, plaintextBytes, plaintextChecksumSha256 }.
 */
const encryptFile = async (inputPath, outputPath, keyMaterial) => {
  const key = resolveKey(keyMaterial);
  if (!fs.existsSync(inputPath)) throw cryptoError(`Input file not found: ${inputPath}`, 'ENOENT');

  const iv = crypto.randomBytes(IV_BYTES);
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header[MAGIC.length] = VERSION;
  iv.copy(header, MAGIC.length + 1);

  const tempPath = `${outputPath}.partial-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let hash;
  let cipher;
  try {
    fs.writeFileSync(tempPath, header, { mode: 0o600, flag: 'wx' });
    cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(header);
    hash = crypto.createHash('sha256');
    let plaintextBytes = 0;

    const hashingTransform = new Transform({
      transform(chunk, encoding, callback) {
        hash.update(chunk);
        plaintextBytes += chunk.length;
        callback(null, chunk);
      },
    });

    await pipeline(
      fs.createReadStream(inputPath),
      hashingTransform,
      cipher,
      fs.createWriteStream(tempPath, { flags: 'a', mode: 0o600 })
    );

    fs.appendFileSync(tempPath, cipher.getAuthTag(), { mode: 0o600 });
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, outputPath);
    fs.chmodSync(outputPath, 0o600);

    return {
      algorithm: ALGORITHM,
      version: VERSION,
      plaintextBytes,
      plaintextChecksumSha256: hash.digest('hex'),
    };
  } catch (err) {
    removeQuietly(tempPath);
    if (err.code && String(err.code).startsWith('INVALID_BACKUP')) throw err;
    throw cryptoError(`Backup encryption failed: ${err.message}`, 'BACKUP_ENCRYPT_FAILED');
  }
};

/**
 * Decrypt a FinPro archive. GCM authentication runs before the caller trusts the
 * plaintext checksum, so a wrong key or a modified byte fails closed.
 * Returns { algorithm, version, plaintextBytes }.
 */
const decryptFile = async (inputPath, outputPath, keyMaterial) => {
  const key = resolveKey(keyMaterial);
  let stat;
  try {
    stat = fs.statSync(inputPath);
  } catch {
    throw cryptoError(`Encrypted archive not found: ${inputPath}`, 'ENOENT');
  }
  if (!stat.isFile()) throw cryptoError('Encrypted archive is not a regular file.', 'INVALID_BACKUP_FORMAT');
  if (stat.size < HEADER_BYTES + TAG_BYTES + 1) {
    throw cryptoError('Encrypted archive is truncated (no ciphertext).', 'INVALID_BACKUP_FORMAT');
  }

  const { header, iv } = readHeader(inputPath);
  const tag = Buffer.alloc(TAG_BYTES);
  let fd;
  try {
    fd = fs.openSync(inputPath, 'r');
    const read = fs.readSync(fd, tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
    if (read !== TAG_BYTES) {
      throw cryptoError('Encrypted archive is truncated (incomplete authentication tag).', 'INVALID_BACKUP_FORMAT');
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  const tempPath = `${outputPath}.partial-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    await pipeline(
      fs.createReadStream(inputPath, {
        start: HEADER_BYTES,
        end: stat.size - TAG_BYTES - 1,
      }),
      decipher,
      fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 })
    );
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, outputPath);
    fs.chmodSync(outputPath, 0o600);
    return { algorithm: ALGORITHM, version: VERSION, plaintextBytes: stat.size - HEADER_BYTES - TAG_BYTES };
  } catch (err) {
    removeQuietly(tempPath);
    if (err.code && String(err.code).startsWith('INVALID_BACKUP')) throw err;
    // OpenSSL reports a generic bad-decrypt error for wrong keys and tampering.
    throw cryptoError(
      'Backup decryption failed: wrong encryption key or the archive was modified.',
      'BACKUP_DECRYPT_FAILED'
    );
  }
};

module.exports = {
  ALGORITHM,
  VERSION,
  MAGIC,
  HEADER_BYTES,
  TAG_BYTES,
  MIN_ARCHIVE_BYTES,
  resolveKey,
  resolveKeyFromEnv,
  isEncryptedArchive,
  readHeader,
  encryptFile,
  decryptFile,
};
