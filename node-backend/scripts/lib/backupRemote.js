/**
 * Pure validation helpers for publishing encrypted backups off-host.
 * No network access and no credentials live here.
 */

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const ARCHIVE_RE = /^finpro-[A-Za-z0-9._-]+\.dump\.enc$/;
const CHECKSUM_RE = /^[a-f0-9]{64}$/i;

const invalid = (message, code = 'INVALID_REMOTE_BACKUP') => {
  const err = new Error(message);
  err.code = code;
  return err;
};

const validateBucket = (bucket) => {
  const value = String(bucket || '').trim();
  if (!value) throw invalid('BACKUP_S3_BUCKET (or --bucket) is required.', 'MISSING_BUCKET');
  if (!BUCKET_RE.test(value)) {
    throw invalid(
      'S3 bucket name is invalid: use 3–63 lowercase letters, digits, dots or hyphens, ' +
        'starting and ending with a letter or digit.'
    );
  }
  if (value.includes('..') || /\d+\.\d+\.\d+\.\d+/.test(value)) {
    throw invalid('S3 bucket name must not contain ".." or look like an IP address.');
  }
  return value;
};

/** Normalise a key prefix and reject traversal/control characters. */
const validatePrefix = (prefix) => {
  if (prefix === undefined || prefix === null) return 'finpro/postgres';
  let value = String(prefix).trim().replace(/^\/+|\/+$/g, '');
  if (!value) return '';
  if (/[\u0000-\u001f\u007f\\]/.test(value)) {
    throw invalid('S3 prefix contains control characters or backslashes.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw invalid('S3 prefix must not contain empty, "." or ".." path segments.');
  }
  return segments.join('/');
};

const validateArchiveName = (name) => {
  const value = String(name || '');
  if (!value || value !== value.split('/').pop()) {
    throw invalid('Backup archive must be a file name, not a path.');
  }
  if (!ARCHIVE_RE.test(value)) {
    throw invalid(
      'Refusing to publish an unencrypted or unrecognised archive. ' +
        'Expected finpro-<database>-<timestamp>.dump.enc.'
    );
  }
  return value;
};

const validateEncryptedManifest = (manifest, archiveName) => {
  if (!manifest || typeof manifest !== 'object') {
    throw invalid('Backup manifest is missing or not a JSON object.', 'INVALID_MANIFEST');
  }
  if (manifest.file !== archiveName) {
    throw invalid('Manifest file name does not match the archive being published.', 'INVALID_MANIFEST');
  }
  if (manifest.encrypted !== true || !manifest.encryption) {
    throw invalid('Manifest does not describe an encrypted archive.', 'INVALID_MANIFEST');
  }
  if (manifest.encryption.algorithm !== 'aes-256-gcm') {
    throw invalid('Manifest uses an unsupported encryption algorithm.', 'INVALID_MANIFEST');
  }
  if (!Number.isFinite(manifest.bytes) || manifest.bytes <= 0) {
    throw invalid('Manifest has an invalid encrypted byte count.', 'INVALID_MANIFEST');
  }
  if (!CHECKSUM_RE.test(String(manifest.checksumSha256 || ''))) {
    throw invalid('Manifest is missing a valid encrypted SHA-256.', 'INVALID_MANIFEST');
  }
  if (!Number.isFinite(manifest.plaintextBytes) || manifest.plaintextBytes <= 0) {
    throw invalid('Manifest is missing the plaintext byte count.', 'INVALID_MANIFEST');
  }
  if (!CHECKSUM_RE.test(String(manifest.plaintextChecksumSha256 || ''))) {
    throw invalid('Manifest is missing a valid plaintext SHA-256.', 'INVALID_MANIFEST');
  }
  return manifest;
};

const buildRemoteKey = ({ prefix, fileName, date = new Date() }) => {
  const safeName = validateArchiveName(fileName);
  const safePrefix = validatePrefix(prefix);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${safePrefix ? `${safePrefix}/` : ''}${year}/${month}/${safeName}`;
};

const maskSecretLikeValues = (value) =>
  String(value || '')
    .replace(/(aws_access_key_id|aws_secret_access_key|aws_session_token)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/(authorization|bearer)\s+\S+/gi, '$1 [redacted]')
    .replace(/(X-Amz-Security-Token=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 4000);

module.exports = {
  validateBucket,
  validatePrefix,
  validateArchiveName,
  validateEncryptedManifest,
  buildRemoteKey,
  maskSecretLikeValues,
};
