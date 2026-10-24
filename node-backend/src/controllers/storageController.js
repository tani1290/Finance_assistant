/**
 * FinPro — Cloud Storage Controller
 * Handles document uploads, downloads, and cloud file management.
 * Owner: Jinay Golecha (jinay_golecha)
 */

const storageService = require('../services/storageService');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Storage keys embed the owner's user id as the first path segment. Every tenant
// — regardless of the storage prefix (user uploads, generated exports, …) — may
// only read or delete keys it owns.
const OWNER_SCOPED_PREFIXES = ['users/', 'exports/'];
const requiresOwnershipCheck = (key) => OWNER_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix));

// Uploads are receipts, statements and exported reports. SVG, HTML and XML are
// deliberately absent: they execute active content when opened inline from the
// API origin. The extension is derived from the approved MIME type, never from
// the client-supplied file name.
const ALLOWED_UPLOADS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
  ['text/csv', '.csv'],
  ['text/plain', '.txt'],
]);

const MIME_ALIASES = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
  ['application/x-pdf', 'application/pdf'],
  ['text/x-csv', 'text/csv'],
]);

const EXTENSION_MIME = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.pdf', 'application/pdf'],
  ['.csv', 'text/csv'],
  ['.txt', 'text/plain'],
]);

const normaliseMime = (value) => {
  const raw = String(value || '').split(';')[0].trim().toLowerCase();
  return MIME_ALIASES.get(raw) || raw;
};

const looksLike = (buffer, mime) => {
  if (mime === 'application/pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (mime === 'image/png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === 'image/webp') {
    return buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (mime === 'text/csv' || mime === 'text/plain') {
    // Text formats have no magic number. Reject binary/NUL payloads so a
    // renamed executable is not stored and served as a "text" document.
    return !buffer.includes(0);
  }
  return false;
};

const safeDownloadName = (key) => {
  const base = path.basename(String(key || 'download')).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 120) || 'download';
};

/**
 * POST /api/v1/storage/upload
 * Accepts base64 encoded document/image or raw payload and stores via storageService
 */
const uploadDocument = async (req, res, next) => {
  try {
    const userId = req.user?.id || 'public';
    const { fileData, fileName, contentType, documentType = 'receipt' } = req.body;

    if (!fileData) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'fileData (base64 string or data URL) is required.' },
      });
    }

    let buffer = null;
    let detectedMime = normaliseMime(contentType);

    if (typeof fileData === 'string' && fileData.startsWith('data:')) {
      const match = fileData.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_FILE', message: 'Malformed data URL. Expected data:<mime>;base64,<payload>.' },
        });
      }
      detectedMime = normaliseMime(match[1]);
      buffer = Buffer.from(match[2], 'base64');
    } else if (typeof fileData === 'string') {
      buffer = Buffer.from(fileData, 'base64');
    } else if (Buffer.isBuffer(fileData)) {
      buffer = fileData;
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_FILE', message: 'Supplied file data is empty or invalid.' },
      });
    }

    // Limit to 15MB
    if (buffer.length > 15 * 1024 * 1024) {
      return res.status(413).json({
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: 'File exceeds 15MB maximum size limit.' },
      });
    }

    // If the client omitted the MIME type, infer it only from an approved
    // extension. Anything else is rejected rather than stored as octet-stream.
    if (!detectedMime && fileName) {
      detectedMime = EXTENSION_MIME.get(path.extname(fileName).toLowerCase()) || '';
    }

    if (!ALLOWED_UPLOADS.has(detectedMime)) {
      return res.status(415).json({
        success: false,
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Only JPEG, PNG, WebP, PDF, CSV and plain-text uploads are accepted.',
        },
      });
    }

    if (!looksLike(buffer, detectedMime)) {
      return res.status(415).json({
        success: false,
        error: {
          code: 'CONTENT_TYPE_MISMATCH',
          message: 'File content does not match the declared content type.',
        },
      });
    }

    const folder = (documentType === 'receipt' ? 'receipts' : documentType === 'export' ? 'exports' : documentType === 'report' ? 'reports' : 'documents');
    const cleanExt = ALLOWED_UPLOADS.get(detectedMime);
    const safeBaseName = fileName ? path.basename(fileName, path.extname(fileName)).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30) : `${folder}_${Date.now()}`;
    const storageKey = `users/${userId}/${folder}/${safeBaseName}_${uuidv4().slice(0, 8)}${cleanExt}`;

    const uploadResult = await storageService.upload({
      buffer,
      key: storageKey,
      contentType: detectedMime,
      metadata: {
        userId,
        originalName: fileName || 'uploaded_document',
        documentType: folder,
      },
    });

    return res.status(201).json({
      success: true,
      data: uploadResult,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/storage/file/:key*
 * Retrieves stored file via storageService with tenant isolation
 */
const getFile = async (req, res, next) => {
  try {
    const rawKey = req.params.key || req.params[0] || '';
    if (!rawKey) {
      return res.status(400).json({ success: false, message: 'Storage key is required' });
    }

    const decodedKey = decodeURIComponent(rawKey).replace(/^\/+/, '');

    // Strict Tenant Isolation: Never allow one user to access another user's files
    if (requiresOwnershipCheck(decodedKey)) {
      const parts = decodedKey.split('/');
      const keyOwnerId = parts[1];
      if (req.user && req.user.id !== keyOwnerId && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You do not have permission to access this file.',
        });
      }
    }

    const downloaded = await storageService.download(decodedKey);

    // Never echo a provider/client-supplied active content type. Legacy objects
    // (or a malicious S3 metadata write) could otherwise execute as HTML on the
    // API origin. Unknown types are forced to a download.
    const responseMime = ALLOWED_UPLOADS.has(normaliseMime(downloaded.contentType))
      ? normaliseMime(downloaded.contentType)
      : 'application/octet-stream';
    const inline = responseMime.startsWith('image/');

    res.setHeader('Content-Type', responseMime);
    res.setHeader('Content-Length', downloaded.size);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${safeDownloadName(decodedKey)}"`
    );
    return res.send(downloaded.buffer);
  } catch (err) {
    if (err.statusCode === 404 || (err.message && (err.message.toLowerCase().includes('not found') || err.message.includes('404')))) {
      return res.status(404).json({ success: false, error: 'File not found in storage' });
    }
    next(err);
  }
};

/**
 * DELETE /api/v1/storage/file/:key*
 * Deletes stored file via storageService with tenant isolation
 */
const deleteFile = async (req, res, next) => {
  try {
    const rawKey = req.params.key || req.params[0] || '';
    const decodedKey = decodeURIComponent(rawKey).replace(/^\/+/, '');

    // Strict Tenant Isolation: Never allow one user to delete another user's files
    if (requiresOwnershipCheck(decodedKey)) {
      const parts = decodedKey.split('/');
      const keyOwnerId = parts[1];
      if (req.user && req.user.id !== keyOwnerId && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You do not have permission to delete this file.',
        });
      }
    }

    const result = await storageService.delete(decodedKey);
    return res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/storage/status
 */
const getStorageStatus = async (req, res) => {
  const health = await storageService.checkStorageHealth();
  return res.status(health.available ? 200 : 503).json({
    success: health.available,
    ...health,
  });
};

module.exports = {
  uploadDocument,
  getFile,
  deleteFile,
  getStorageStatus,
};
