/**
 * Encryption for cloud sync backups.
 *
 * Design constraints that shaped this module:
 *   • A backup contains every financial row for one user, so it must never be
 *     readable from a database dump or a leaked object-storage bucket.
 *   • The key must not be stored beside the ciphertext. It comes from
 *     `SYNC_BACKUP_KEY` (preferred) or is derived from `JWT_SECRET` so an
 *     existing deployment keeps working without a second secret.
 *   • Per-user key derivation means one user's backup cannot be decrypted with
 *     another user's salt even if the master secret leaks into a shared log.
 *   • AES-256-GCM authenticates the payload; the additional authenticated data
 *     binds a ciphertext to a specific user so a swapped blob fails closed.
 *
 * Nothing here ever returns the key or the plaintext to a caller that did not
 * ask to decrypt, and no function logs the secret.
 */

'use strict';

const crypto = require('crypto');

const FORMAT = 'finpro-sync-backup-v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MIN_SECRET_LENGTH = 16;

/**
 * Read the master secret from the environment.
 *
 * `JWT_SECRET` is an accepted fallback because it is already mandatory in this
 * deployment. It is not ideal (rotating it would invalidate backups), so the
 * health endpoint and docs both recommend a dedicated `SYNC_BACKUP_KEY`.
 */
function getMasterSecret() {
  const dedicated = process.env.SYNC_BACKUP_KEY;
  const fallback = process.env.JWT_SECRET;
  const raw = (dedicated && dedicated.trim()) || (fallback && fallback.trim());

  if (!raw || raw.length < MIN_SECRET_LENGTH) {
    const error = new Error(
      'Backup encryption is not configured. Set SYNC_BACKUP_KEY (or JWT_SECRET) to a value of at least 16 characters.'
    );
    error.code = 'SYNC_BACKUP_KEY_MISSING';
    error.statusCode = 503;
    throw error;
  }

  return raw;
}

function userBoundSalt(salt, userId) {
  return Buffer.concat([salt, Buffer.from(String(userId), 'utf8')]);
}

function deriveKey(masterSecret, salt, userId) {
  return crypto.scryptSync(masterSecret, userBoundSalt(salt, userId), KEY_BYTES);
}

function aadFor(userId) {
  return Buffer.from(`${FORMAT}:${userId}`, 'utf8');
}

function checksumOf(plaintext) {
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * Encrypt a JSON-serialisable backup payload.
 *
 * @param {string} userId owner of the backup
 * @param {object} payload the snapshot to protect
 * @returns {{format: string, ciphertext: string, iv: string, authTag: string, salt: string, checksum: string, sizeBytes: number}}
 */
function encryptBackup(userId, payload) {
  if (!userId) {
    const error = new Error('A user id is required to encrypt a backup.');
    error.code = 'SYNC_BACKUP_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const plaintext = JSON.stringify(payload ?? {});
  const masterSecret = getMasterSecret();
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(masterSecret, salt, userId);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aadFor(userId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    format: FORMAT,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    salt: salt.toString('base64'),
    checksum: checksumOf(plaintext),
    sizeBytes: Buffer.byteLength(plaintext, 'utf8'),
  };
}

/**
 * Decrypt a stored backup and prove it belongs to `userId`.
 *
 * The GCM tag is verified first; a tampered ciphertext, a wrong key or a
 * ciphertext copied from another user throws and never yields data.
 *
 * @param {string} userId owner the backup must belong to
 * @param {{ciphertext: string, iv: string, authTag: string, salt: string, checksum?: string}} envelope
 * @returns {object} the original payload
 */
function decryptBackup(userId, envelope) {
  if (!userId || !envelope) {
    const error = new Error('A user id and an encrypted backup are required.');
    error.code = 'SYNC_BACKUP_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const required = ['ciphertext', 'iv', 'authTag', 'salt'];
  for (const field of required) {
    if (typeof envelope[field] !== 'string' || envelope[field].length === 0) {
      const error = new Error(`Backup is missing its "${field}" field and cannot be decrypted.`);
      error.code = 'SYNC_BACKUP_CORRUPT';
      error.statusCode = 422;
      throw error;
    }
  }

  const masterSecret = getMasterSecret();
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const key = deriveKey(masterSecret, salt, userId);

  let plaintext;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(aadFor(userId));
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (_) {
    const error = new Error(
      'This backup could not be decrypted. It may be corrupted, encrypted with a different key, or belong to a different account.'
    );
    error.code = 'SYNC_BACKUP_UNDECRYPTABLE';
    error.statusCode = 422;
    throw error;
  }

  if (envelope.checksum) {
    const actual = Buffer.from(checksumOf(plaintext), 'hex');
    const expected = Buffer.from(String(envelope.checksum), 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      const error = new Error('This backup failed its integrity check and was not restored.');
      error.code = 'SYNC_BACKUP_CHECKSUM_MISMATCH';
      error.statusCode = 422;
      throw error;
    }
  }

  try {
    return JSON.parse(plaintext);
  } catch (_) {
    const error = new Error('This backup is not valid JSON and was not restored.');
    error.code = 'SYNC_BACKUP_CORRUPT';
    error.statusCode = 422;
    throw error;
  }
}

/** True when the deployment can encrypt and decrypt backups. */
function isConfigured() {
  try {
    getMasterSecret();
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  FORMAT,
  encryptBackup,
  decryptBackup,
  isConfigured,
};
