/**
 * FinPro — Cloud Storage Service Abstraction
 * Supports Local Disk (development) and S3-Compatible Cloud Object Storage (production).
 * Compatible with AWS S3, Cloudflare R2, Oracle Cloud Object Storage, MinIO, and Backblaze B2.
 * Owner: Jinay Golecha (jinay_golecha)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// ----------------------------------------------------------------------------
// Local Disk Storage Provider (Default for Development)
// ----------------------------------------------------------------------------
class LocalDiskProvider {
  constructor(baseDir) {
    this.baseDir = path.resolve(baseDir || path.join(__dirname, '..', '..', 'uploads'));
    if (!fs.existsSync(this.baseDir)) {
      try {
        fs.mkdirSync(this.baseDir, { recursive: true });
      } catch (err) {
        console.warn('[Storage] Notice creating uploads dir:', err.message);
      }
    }
  }

  _resolveSafePath(key) {
    // Sanitize key to prevent directory traversal attacks
    const sanitizedKey = key.replace(/^(\.\.[\/\\])+/, '').replace(/[\\]/g, '/');
    const fullPath = path.join(this.baseDir, sanitizedKey);
    if (!fullPath.startsWith(this.baseDir)) {
      throw new Error('Invalid storage key path: directory traversal detected');
    }
    return fullPath;
  }

  async upload({ buffer, key, contentType = 'application/octet-stream', metadata = {} }) {
    const fullPath = this._resolveSafePath(key);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    await fs.promises.writeFile(fullPath, buffer);
    const stat = await fs.promises.stat(fullPath);

    return {
      success: true,
      key,
      url: `/api/v1/storage/file/${encodeURIComponent(key)}`,
      size: stat.size,
      contentType,
      provider: 'local',
      etag: crypto.createHash('md5').update(buffer).digest('hex'),
      createdAt: new Date().toISOString(),
      metadata,
    };
  }

  async download(key) {
    const fullPath = this._resolveSafePath(key);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Object not found: ${key}`);
    }
    const buffer = await fs.promises.readFile(fullPath);
    const ext = path.extname(key).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.txt': 'text/plain',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    return {
      buffer,
      size: buffer.length,
      contentType,
      key,
      provider: 'local',
    };
  }

  async delete(key) {
    const fullPath = this._resolveSafePath(key);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
    return { success: true, key, provider: 'local' };
  }

  /**
   * Delete every object stored under a validated tenant prefix.
   *
   * Used by account deletion, where leaving files behind on disk would mean the
   * user's receipts/exports survive the account. The caller (StorageService)
   * is responsible for rejecting unsafe prefixes; this method still refuses to
   * touch the storage root.
   */
  async deletePrefix(prefix) {
    const normalized = String(prefix || '').replace(/\\/g, '/');
    if (!normalized || !normalized.endsWith('/') || normalized.includes('..')) {
      throw new Error('Invalid storage prefix');
    }
    const fullPath = this._resolveSafePath(normalized);
    if (fullPath === this.baseDir || !fullPath.startsWith(this.baseDir + path.sep)) {
      throw new Error('Refusing to delete storage root');
    }
    await fs.promises.rm(fullPath, { recursive: true, force: true });
    return { success: true, provider: 'local', prefix: normalized };
  }

  async getPublicOrSignedUrl(key) {
    return `/api/v1/storage/file/${encodeURIComponent(key)}`;
  }

  async checkHealth() {
    const start = Date.now();
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      const testFile = path.join(this.baseDir, `.healthcheck-${crypto.randomBytes(6).toString('hex')}`);
      await fs.promises.writeFile(testFile, `health-${Date.now()}`);
      await fs.promises.readFile(testFile);
      try { await fs.promises.unlink(testFile); } catch {}
      const latencyMs = Date.now() - start;
      return {
        available: true,
        status: 'available',
        provider: 'local',
        directory: path.basename(this.baseDir),
        latencyMs,
      };
    } catch (err) {
      return {
        available: false,
        status: 'error',
        provider: 'local',
        error: err.message,
        latencyMs: Date.now() - start,
      };
    }
  }
}

// ----------------------------------------------------------------------------
// S3-Compatible Cloud Object Storage Provider (Production)
// Implements AWS Signature V4 REST API without external bloat
// ----------------------------------------------------------------------------
// Every S3 network call MUST be bounded. Without a timeout a stalled provider
// (paused bucket, black-holed TCP, half-open connection) keeps the caller's
// request open until the OS gives up — turning one slow object store into a
// pinned HTTP worker. Operators can tune this per environment.
const DEFAULT_S3_TIMEOUT_MS = 15000;
const resolveS3TimeoutMs = (override) => {
  const parsed = Number.parseInt(override, 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return DEFAULT_S3_TIMEOUT_MS;
};

class S3CloudProvider {
  constructor(config = {}) {
    this.endpoint = config.endpoint || process.env.S3_ENDPOINT || 'https://s3.amazonaws.com';
    this.region = config.region || process.env.S3_REGION || 'us-east-1';
    this.bucket = config.bucket || process.env.S3_BUCKET || 'finpro-cloud-documents';
    this.accessKeyId = config.accessKeyId || process.env.S3_ACCESS_KEY_ID || '';
    this.secretAccessKey = config.secretAccessKey || process.env.S3_SECRET_ACCESS_KEY || '';
    this.forcePathStyle = config.forcePathStyle === true || process.env.S3_FORCE_PATH_STYLE === 'true';
    this.publicUrl = config.publicUrl || process.env.S3_PUBLIC_URL || '';
    this.requestTimeoutMs = resolveS3TimeoutMs(config.requestTimeoutMs || process.env.S3_TIMEOUT_MS);
  }

  _isConfigured() {
    return !!(
      this.accessKeyId &&
      this.accessKeyId !== 'YOUR_S3_ACCESS_KEY_ID' &&
      this.secretAccessKey &&
      this.secretAccessKey !== 'YOUR_S3_SECRET_ACCESS_KEY'
    );
  }

  _signRequest(method, urlStr, headers = {}, payloadHash = 'UNSIGNED-PAYLOAD') {
    const parsedUrl = new URL(urlStr);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    headers['host'] = parsedUrl.host;
    headers['x-amz-date'] = amzDate;
    headers['x-amz-content-sha256'] = payloadHash;

    const sortedHeaders = Object.keys(headers)
      .map(k => k.toLowerCase())
      .sort();
    const canonicalHeaders = sortedHeaders.map(k => `${k}:${headers[k].trim()}\n`).join('');
    const signedHeaders = sortedHeaders.join(';');

    const canonicalRequest = [
      method,
      parsedUrl.pathname,
      parsedUrl.search.replace(/^\?/, ''),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join('\n');

    const kDate = crypto.createHmac('sha256', `AWS4${this.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(this.region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return headers;
  }

  _buildObjectUrl(key) {
    const cleanKey = encodeURI(key.replace(/^\//, ''));
    const endpointUrl = new URL(this.endpoint);
    const hasPath = endpointUrl.pathname && endpointUrl.pathname !== '/';
    if (this.forcePathStyle || hasPath || endpointUrl.host.includes('supabase.co') || endpointUrl.host.includes('cloudflarestorage.com')) {
      const basePath = endpointUrl.pathname.replace(/\/$/, '');
      return `${endpointUrl.origin}${basePath}/${this.bucket}/${cleanKey}`;
    }
    return `${endpointUrl.protocol}//${this.bucket}.${endpointUrl.host}/${cleanKey}`;
  }

  _buildBucketUrl() {
    const endpointUrl = new URL(this.endpoint);
    const hasPath = endpointUrl.pathname && endpointUrl.pathname !== '/';
    if (this.forcePathStyle || hasPath || endpointUrl.host.includes('supabase.co') || endpointUrl.host.includes('cloudflarestorage.com')) {
      const basePath = endpointUrl.pathname.replace(/\/$/, '');
      return `${endpointUrl.origin}${basePath}/${this.bucket}`;
    }
    return `${endpointUrl.protocol}//${this.bucket}.${endpointUrl.host}`;
  }

  /**
   * List object keys under a prefix using ListObjectsV2 with pagination.
   * Throws on any non-2xx response so callers cannot mistake a failed listing
   * (and therefore an incomplete deletion) for an empty prefix.
   */
  async listPrefix(prefix) {
    if (!this._isConfigured()) {
      throw Object.assign(new Error('Cloud S3 Object Storage is not configured'), { code: 'S3_NOT_CONFIGURED' });
    }

    const keys = [];
    let continuationToken = null;
    let pages = 0;

    do {
      // AWS SigV4 canonical query strings are sorted by parameter name.
      const queryParts = [];
      if (continuationToken) {
        queryParts.push(`continuation-token=${encodeURIComponent(continuationToken)}`);
      }
      queryParts.push('list-type=2', `prefix=${encodeURIComponent(prefix)}`);
      const url = `${this._buildBucketUrl()}?${queryParts.join('&')}`;
      const signedHeaders = this._signRequest('GET', url, {});

      const body = await new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'http:' ? http : https;
        const req = transport.request(url, { method: 'GET', headers: signedHeaders, timeout: this.requestTimeoutMs }, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return reject(new Error(`S3 List Failed (${res.statusCode})`));
            }
            resolve(text);
          });
        });
        req.on('timeout', () => {
          req.destroy(Object.assign(new Error(`S3 list timed out after ${this.requestTimeoutMs}ms`), { code: 'S3_TIMEOUT' }));
        });
        req.on('error', reject);
        req.end();
      });

      const decodeXml = (value) => String(value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');

      for (const match of body.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
        keys.push(decodeXml(match[1]));
      }

      const tokenMatch = body.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
      continuationToken = tokenMatch ? decodeXml(tokenMatch[1]) : null;
      pages += 1;
      if (pages > 1000) {
        throw new Error('S3 List pagination exceeded safety limit');
      }
    } while (continuationToken);

    return keys;
  }

  async deletePrefix(prefix) {
    const keys = await this.listPrefix(prefix);
    for (const key of keys) {
      const result = await this.delete(key);
      if (!result || result.success !== true) {
        throw new Error(`S3 delete failed for one or more objects under ${prefix}`);
      }
    }
    return { success: true, provider: 's3', prefix, deleted: keys.length };
  }

  async upload({ buffer, key, contentType = 'application/octet-stream', metadata = {} }) {
    if (!this._isConfigured()) {
      throw new Error('Cloud S3 Object Storage is not configured with valid credentials in .env');
    }

    const payloadHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const url = this._buildObjectUrl(key);
    const headers = {
      'content-type': contentType,
      'content-length': String(buffer.length),
    };

    const signedHeaders = this._signRequest('PUT', url, headers, payloadHash);

    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'http:' ? http : https;
      const req = transport.request(
        url,
        { method: 'PUT', headers: signedHeaders, timeout: this.requestTimeoutMs },
        (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              success: true,
              key,
              url: this.publicUrl ? `${this.publicUrl.replace(/\/$/, '')}/${encodeURI(key)}` : url,
              size: buffer.length,
              contentType,
              provider: 's3',
              etag: res.headers.etag || payloadHash,
              createdAt: new Date().toISOString(),
              metadata,
            });
          } else {
            let data = '';
            res.on('data', chunk => (data += chunk));
            res.on('end', () => reject(new Error(`S3 Upload Failed (${res.statusCode}): ${data}`)));
          }
        }
      );

      req.on('timeout', () => {
        req.destroy(Object.assign(new Error(`S3 upload timed out after ${this.requestTimeoutMs}ms`), { code: 'S3_TIMEOUT' }));
      });
      req.on('error', reject);
      req.write(buffer);
      req.end();
    });
  }

  async download(key) {
    if (!this._isConfigured()) {
      throw new Error('Cloud S3 Object Storage is not configured');
    }
    const url = this._buildObjectUrl(key);
    const signedHeaders = this._signRequest('GET', url, {});

    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'http:' ? http : https;
      const req = transport.request(url, { method: 'GET', headers: signedHeaders, timeout: this.requestTimeoutMs }, (res) => {
        if (res.statusCode === 404) {
          return reject(Object.assign(new Error(`File not found in storage (${key})`), { statusCode: 404 }));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`S3 Download Failed (${res.statusCode})`));
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            buffer,
            size: buffer.length,
            contentType: res.headers['content-type'] || 'application/octet-stream',
            key,
            provider: 's3',
          });
        });
      });
      req.on('timeout', () => {
        req.destroy(Object.assign(new Error(`S3 download timed out after ${this.requestTimeoutMs}ms`), { code: 'S3_TIMEOUT' }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  async delete(key) {
    if (!this._isConfigured()) return { success: false, error: 'S3 not configured' };
    const url = this._buildObjectUrl(key);
    const signedHeaders = this._signRequest('DELETE', url, {});

    return new Promise((resolve) => {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'http:' ? http : https;
      const req = transport.request(url, { method: 'DELETE', headers: signedHeaders, timeout: this.requestTimeoutMs }, (res) => {
        resolve({ success: res.statusCode >= 200 && res.statusCode < 300, key, provider: 's3' });
      });
      req.on('timeout', () => {
        req.destroy(Object.assign(new Error(`S3 delete timed out after ${this.requestTimeoutMs}ms`), { code: 'S3_TIMEOUT' }));
      });
      req.on('error', err => resolve({ success: false, error: err.message, key }));
      req.end();
    });
  }

  async getPublicOrSignedUrl(key, { expiresIn = 3600 } = {}) {
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/$/, '')}/${encodeURI(key)}`;
    }
    return this._buildObjectUrl(key);
  }

  async checkHealth() {
    const start = Date.now();
    if (!this._isConfigured()) {
      return {
        available: false,
        status: 'not_configured',
        provider: 's3',
        note: 'S3 Object Storage configured in fallback or unconfigured mode. Set S3_ACCESS_KEY_ID in .env for production cloud store.',
        bucket: this.bucket,
        latencyMs: 0,
      };
    }

    try {
      const endpointUrl = new URL(this.endpoint);
      const hasPath = endpointUrl.pathname && endpointUrl.pathname !== '/';
      const usePathStyle = this.forcePathStyle || hasPath || endpointUrl.host.includes('supabase.co') || endpointUrl.host.includes('cloudflarestorage.com');
      const url = usePathStyle
        ? `${this.endpoint.replace(/\/$/, '')}/${this.bucket}`
        : `${endpointUrl.protocol}//${this.bucket}.${endpointUrl.host}`;
      const signedHeaders = this._signRequest('HEAD', url, {});

      // The probe must stay cheap: never wait longer than the request timeout,
      // and cap it at 5s so a stalled endpoint cannot slow the health endpoint.
      const probeTimeoutMs = Math.min(this.requestTimeoutMs, 5000);

      return await new Promise((resolve) => {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'http:' ? http : https;
        const req = transport.request(url, { method: 'HEAD', headers: signedHeaders, timeout: probeTimeoutMs }, (res) => {
          const latencyMs = Date.now() - start;
          const ok = res.statusCode >= 200 && res.statusCode < 400;
          resolve({
            available: ok,
            status: ok ? 'available' : 'degraded',
            statusCode: res.statusCode,
            provider: 's3',
            bucket: this.bucket,
            region: this.region,
            latencyMs,
          });
        });
        req.on('timeout', () => {
          req.destroy();
          resolve({ available: false, status: 'timeout', provider: 's3', latencyMs: Date.now() - start });
        });
        req.on('error', (err) => {
          resolve({ available: false, status: 'unreachable', error: err.message, provider: 's3', latencyMs: Date.now() - start });
        });
        req.end();
      });
    } catch (err) {
      return {
        available: false,
        status: 'error',
        error: err.message,
        provider: 's3',
        latencyMs: Date.now() - start,
      };
    }
  }
}

// ----------------------------------------------------------------------------
// Storage Service Singleton Manager
// ----------------------------------------------------------------------------
class StorageService {
  constructor() {
    this.localProvider = new LocalDiskProvider(process.env.STORAGE_LOCAL_DIR);
    this.cloudProvider = new S3CloudProvider();
    // Most recent silent cloud→local fallback, if any. Kept in-memory only:
    // it holds no secrets and is surfaced through the health endpoints so a
    // cloud outage is observable instead of being hidden behind the fallback.
    this.lastFallback = null;
  }

  get activeProvider() {
    const prov = (process.env.STORAGE_PROVIDER || 'local').toLowerCase().trim();
    return (prov === 's3' || prov === 'cloud') ? this.cloudProvider : this.localProvider;
  }

  get providerName() {
    const prov = (process.env.STORAGE_PROVIDER || 'local').toLowerCase().trim();
    return (prov === 's3' || prov === 'cloud') ? 's3' : 'local';
  }

  /**
   * Where objects are persisted *right now* and whether that survives a
   * redeploy. Local disk lives inside the container/host and is lost on
   * redeploy, restart or crash; S3-compatible object storage is durable.
   * Reported through the health endpoints so production can never *look* like
   * it has durable cloud storage while writing to an ephemeral disk.
   */
  getDurability() {
    const provider = this.providerName;
    const durable = provider === 's3';
    return {
      provider,
      durable,
      ephemeral: !durable,
      reason: durable
        ? 'Objects are stored in S3-compatible cloud object storage.'
        : 'Objects are stored on local disk and are lost on redeploy or restart.',
    };
  }

  /**
   * One loud, credential-free startup warning when the process is about to
   * serve production traffic from ephemeral local disk. Nothing is invented or
   * required here: it only makes the existing default visible. Returns true
   * when the warning was emitted.
   */
  warnIfEphemeralInProduction() {
    const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    const { provider, durable, reason } = this.getDurability();
    if (isProduction && !durable) {
      console.warn(
        `[Storage] WARNING: object storage provider is "${provider}" — ${reason} ` +
          'Set STORAGE_PROVIDER=s3 plus S3_ENDPOINT, S3_REGION, S3_BUCKET, ' +
          'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY for durable cloud storage.'
      );
      return true;
    }
    return false;
  }

  /**
   * Records that the configured cloud provider failed and the local fallback
   * was used instead. Deliberately stores only a short, non-sensitive message:
   * never the bucket, credentials, signed URL or exact object key.
   */
  _recordFallback(operation, err) {
    this.lastFallback = {
      operation,
      at: new Date().toISOString(),
      message: (err && err.message ? String(err.message) : 'Unknown storage error').slice(0, 200),
      provider: 's3',
      fallbackProvider: 'local',
    };
    return this.lastFallback;
  }

  getLastFallback() {
    return this.lastFallback ? { ...this.lastFallback } : null;
  }

  /**
   * Production must never silently write financial documents to the
   * container's ephemeral disk because the configured cloud bucket failed.
   * Tests and local development keep the resilient fallback; production fails
   * closed unless an operator explicitly opts in with
   * STORAGE_ALLOW_EPHEMERAL_FALLBACK=true (for example, a documented,
   * temporary migration window with an off-host backup).
   */
  _fallbackAllowed() {
    const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (!isProduction) return true;
    return String(process.env.STORAGE_ALLOW_EPHEMERAL_FALLBACK || '').toLowerCase() === 'true';
  }

  _storageUnavailable(operation) {
    const err = new Error('Object storage is temporarily unavailable. Please retry.');
    err.code = 'STORAGE_UNAVAILABLE';
    err.statusCode = 503;
    err.operation = operation;
    return err;
  }

  /**
   * Only tenant-owned prefixes may be bulk-deleted. This is deliberately
   * narrow: account deletion needs exactly `users/<id>/` and `exports/<id>/`,
   * and nothing else should be able to invoke a recursive delete.
   */
  _assertSafePrefix(prefix) {
    const normalized = typeof prefix === 'string' ? prefix : '';
    if (!/^(users|exports)\/[A-Za-z0-9._-]+\/$/.test(normalized) || normalized.includes('..')) {
      throw Object.assign(new Error('Invalid storage prefix'), {
        code: 'INVALID_STORAGE_PREFIX',
        statusCode: 400,
      });
    }
    return normalized;
  }

  async upload({ buffer, key, contentType, metadata, isPublic }) {
    try {
      return await this.activeProvider.upload({ buffer, key, contentType, metadata, isPublic });
    } catch (err) {
      if (this.providerName === 's3') {
        this._recordFallback('upload', err);
        if (!this._fallbackAllowed()) {
          console.error('[Storage] Cloud S3 upload failed and ephemeral fallback is disabled in production.');
          throw this._storageUnavailable('upload');
        }
        console.warn(`[Storage] Cloud S3 upload notice (${err.message}). Engaging resilient local fallback...`);
        return await this.localProvider.upload({ buffer, key, contentType, metadata, isPublic });
      }
      throw err;
    }
  }

  async download(key) {
    try {
      return await this.activeProvider.download(key);
    } catch (err) {
      if (this.providerName === 's3') {
        this._recordFallback('download', err);
        if (!this._fallbackAllowed()) {
          console.error('[Storage] Cloud S3 download failed and ephemeral fallback is disabled in production.');
          throw this._storageUnavailable('download');
        }
        return await this.localProvider.download(key);
      }
      throw err;
    }
  }

  async delete(key) {
    try {
      return await this.activeProvider.delete(key);
    } catch (err) {
      if (this.providerName === 's3') {
        this._recordFallback('delete', err);
        if (!this._fallbackAllowed()) {
          throw this._storageUnavailable('delete');
        }
        return await this.localProvider.delete(key);
      }
      throw err;
    }
  }

  /**
   * Recursively delete every object under a validated tenant prefix.
   * Returns `{ success, provider, prefix, deleted }` (local `deleted` is null).
   */
  async deletePrefix(prefix) {
    const safePrefix = this._assertSafePrefix(prefix);
    try {
      return await this.activeProvider.deletePrefix(safePrefix);
    } catch (err) {
      if (this.providerName === 's3') {
        this._recordFallback('deletePrefix', err);
        if (!this._fallbackAllowed()) {
          throw this._storageUnavailable('deletePrefix');
        }
        return await this.localProvider.deletePrefix(safePrefix);
      }
      throw err;
    }
  }

  async getPublicOrSignedUrl(key, options) {
    try {
      return await this.activeProvider.getPublicOrSignedUrl(key, options);
    } catch (err) {
      if (this.providerName === 's3') {
        this._recordFallback('getPublicOrSignedUrl', err);
        if (!this._fallbackAllowed()) {
          throw this._storageUnavailable('getPublicOrSignedUrl');
        }
        return await this.localProvider.getPublicOrSignedUrl(key, options);
      }
      throw err;
    }
  }

  async checkStorageHealth() {
    const health = await this.activeProvider.checkHealth();
    const lastFallback = this.getLastFallback();
    // If cloud S3 is paused or unreachable, check if local storage fallback is operational
    if (this.providerName === 's3' && !health.available) {
      const localHealth = await this.localProvider.checkHealth();
      if (localHealth.available && this._fallbackAllowed()) {
        return {
          available: true,
          status: 'available',
          provider: 's3',
          // `available` means "the platform can still persist documents" (local
          // fallback), NOT "the cloud bucket is healthy". `cloudStatus` carries
          // that truth so callers/reporting never present a downed cloud as up.
          cloudStatus: 'degraded',
          cloudAvailable: false,
          fallbackProvider: 'local',
          // Falling back to local disk means objects are ephemeral right now,
          // regardless of what STORAGE_PROVIDER is configured to.
          durable: false,
          ephemeral: true,
          latencyMs: health.latencyMs || localHealth.latencyMs,
          cloudError: health.error || health.status || 'unreachable',
          lastFallback,
          note: 'Cloud S3 endpoint unreachable; resilient local disk fallback is active and operational.',
        };
      }
      if (!this._fallbackAllowed()) {
        return {
          available: false,
          status: 'unavailable',
          provider: 's3',
          cloudStatus: 'degraded',
          cloudAvailable: false,
          fallbackProvider: null,
          durable: false,
          ephemeral: false,
          latencyMs: health.latencyMs || localHealth.latencyMs,
          cloudError: health.error || health.status || 'unreachable',
          lastFallback,
          note: 'Cloud S3 endpoint unreachable and ephemeral local fallback is disabled in production.',
        };
      }
    }
    const durability = this.getDurability();
    const durable = durability.provider === 's3' && health.available === true;
    return {
      ...health,
      cloudAvailable: health.available,
      durable,
      ephemeral: !durable && durability.provider !== 's3',
      lastFallback,
    };
  }
}

const storageService = new StorageService();

// Exposed for targeted unit tests and for operators building custom providers.
// The classes hold no shared state and are safe to reference.
storageService.LocalDiskProvider = LocalDiskProvider;
storageService.S3CloudProvider = S3CloudProvider;

module.exports = storageService;
