/**
 * Production storage durability — fail closed, never silently ephemeral.
 *
 * The fallback is a deliberate resilience feature for development and for
 * explicitly opted-in production windows. In production without that opt-in, a
 * failed cloud write must surface as an error rather than quietly persisting a
 * financial document to container disk that disappears on redeploy.
 */

const storageService = require('../services/storageService');

describe('storage fail-closed policy', () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    STORAGE_ALLOW_EPHEMERAL_FALLBACK: process.env.STORAGE_ALLOW_EPHEMERAL_FALLBACK,
  };
  let cloudUploadSpy;
  let localUploadSpy;
  let cloudHealthSpy;
  let localHealthSpy;

  beforeEach(() => {
    process.env.STORAGE_PROVIDER = 's3';
    cloudUploadSpy = jest.spyOn(storageService.cloudProvider, 'upload')
      .mockRejectedValue(new Error('S3 upload timed out after 15000ms'));
    localUploadSpy = jest.spyOn(storageService.localProvider, 'upload')
      .mockResolvedValue({ success: true, key: 'users/u1/x.png', provider: 'local' });
    cloudHealthSpy = jest.spyOn(storageService.cloudProvider, 'checkHealth')
      .mockResolvedValue({ available: false, status: 'unreachable', provider: 's3', latencyMs: 1 });
    localHealthSpy = jest.spyOn(storageService.localProvider, 'checkHealth')
      .mockResolvedValue({ available: true, status: 'available', provider: 'local', latencyMs: 1 });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  it('fails a production upload instead of writing to ephemeral disk', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.STORAGE_ALLOW_EPHEMERAL_FALLBACK;

    await expect(storageService.upload({ buffer: Buffer.from('x'), key: 'users/u1/x.png' }))
      .rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', statusCode: 503 });

    expect(localUploadSpy).not.toHaveBeenCalled();
    // The fallback attempt is still recorded for observability.
    expect(storageService.getLastFallback()).toMatchObject({
      operation: 'upload',
      provider: 's3',
      fallbackProvider: 'local',
    });
  });

  it('passes a missing object through as 404 instead of masking it as an outage', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.STORAGE_ALLOW_EPHEMERAL_FALLBACK;

    const missing = Object.assign(new Error('File not found in storage (users/u1/x.png)'), { statusCode: 404 });
    const cloudDownloadSpy = jest.spyOn(storageService.cloudProvider, 'download').mockRejectedValue(missing);
    const localDownloadSpy = jest.spyOn(storageService.localProvider, 'download')
      .mockResolvedValue({ buffer: Buffer.from('x'), size: 1, provider: 'local' });

    await expect(storageService.download('users/u1/x.png'))
      .rejects.toMatchObject({ statusCode: 404 });

    expect(localDownloadSpy).not.toHaveBeenCalled();
    cloudDownloadSpy.mockRestore();
    localDownloadSpy.mockRestore();
  });

  it('allows the fallback in production only with the explicit opt-in', async () => {
    process.env.NODE_ENV = 'production';
    process.env.STORAGE_ALLOW_EPHEMERAL_FALLBACK = 'true';

    const result = await storageService.upload({ buffer: Buffer.from('x'), key: 'users/u1/x.png' });

    expect(result.provider).toBe('local');
    expect(localUploadSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the development/test fallback unchanged', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.STORAGE_ALLOW_EPHEMERAL_FALLBACK;

    const result = await storageService.upload({ buffer: Buffer.from('x'), key: 'users/u1/x.png' });

    expect(result.provider).toBe('local');
    expect(localUploadSpy).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable (not healthy) when cloud is down and fallback is disabled', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.STORAGE_ALLOW_EPHEMERAL_FALLBACK;

    const health = await storageService.checkStorageHealth();

    expect(health.available).toBe(false);
    expect(health.status).toBe('unavailable');
    expect(health.cloudAvailable).toBe(false);
    expect(health.durable).toBe(false);
    expect(health.ephemeral).toBe(false);
    expect(health.fallbackProvider).toBeNull();
  });

  it('reports a degraded cloud but available ephemeral fallback when explicitly allowed', async () => {
    process.env.NODE_ENV = 'production';
    process.env.STORAGE_ALLOW_EPHEMERAL_FALLBACK = 'true';

    const health = await storageService.checkStorageHealth();

    expect(health.available).toBe(true);
    expect(health.cloudStatus).toBe('degraded');
    expect(health.cloudAvailable).toBe(false);
    expect(health.durable).toBe(false);
    expect(health.ephemeral).toBe(true);
    expect(health.fallbackProvider).toBe('local');
  });

  it('reports local disk as non-durable without pretending it is cloud storage', async () => {
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_PROVIDER = 'local';
    cloudHealthSpy.mockRestore();
    localHealthSpy.mockRestore();

    const health = await storageService.checkStorageHealth();

    expect(health.available).toBe(true);
    expect(health.durable).toBe(false);
    expect(health.ephemeral).toBe(true);
  });
});
