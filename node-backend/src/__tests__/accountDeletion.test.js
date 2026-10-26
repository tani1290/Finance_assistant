/**
 * Account deletion — permanent, authenticated, owner-scoped.
 *
 * These are integration tests against the configured test database because the
 * property that matters most is the real Prisma cascade: deleting the User must
 * remove every user-owned row, and nothing belonging to another user.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../app');
const prisma = require('../config/database');
const storageService = require('../services/storageService');
const authService = require('../services/authService');

const PASSWORD = 'Password123!';
const unique = () => `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const register = async (label) => {
  const suffix = unique();
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      email: `${label}_${suffix}@example.com`,
      username: `${label}_${suffix}`,
      password: PASSWORD,
      firstName: 'Delete',
      lastName: 'Test',
    });

  expect(res.status).toBe(201);
  return {
    user: res.body.data.user,
    accessToken: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
  };
};

describe('DELETE /api/v1/auth/account', () => {
  const createdUserIds = [];
  const uploadsRoot = path.join(__dirname, '..', '..', 'uploads');

  const track = (session) => {
    createdUserIds.push(session.user.id);
    return session;
  };

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    }
    for (const id of createdUserIds) {
      await fs.promises.rm(path.join(uploadsRoot, 'users', id), { recursive: true, force: true }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('requires an access token', async () => {
    const res = await request(app)
      .delete('/api/v1/auth/account')
      .send({ confirmation: 'DELETE', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('refuses to delete without the exact DELETE confirmation', async () => {
    const session = track(await register('confirm'));

    const res = await request(app)
      .delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ confirmation: 'delete my account', password: PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CONFIRMATION_REQUIRED');
    expect(await prisma.user.findUnique({ where: { id: session.user.id } })).not.toBeNull();
  });

  it('rejects a missing or incorrect password for password accounts', async () => {
    const session = track(await register('password'));

    const missing = await request(app)
      .delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ confirmation: 'DELETE' });

    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('PASSWORD_REQUIRED');

    const wrong = await request(app)
      .delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ confirmation: 'DELETE', password: 'DefinitelyWrong123!' });

    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(await prisma.user.findUnique({ where: { id: session.user.id } })).not.toBeNull();
  });

  it('permanently deletes the user, cascades owned data and revokes sessions', async () => {
    const session = track(await register('cascade'));
    const userId = session.user.id;

    // Non-trivial owned data across unrelated tables.
    await prisma.goal.create({
      data: {
        userId,
        name: 'Deletion test goal',
        targetAmount: 1000,
        currentAmount: 10,
        targetDate: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.budget.create({
      data: {
        userId,
        categoryName: 'Deletion test budget',
        monthlyLimit: 500,
        month: 10,
        year: 2026,
      },
    });

    // Files must be removed before the row so a storage failure aborts instead
    // of silently orphaning user receipts/exports.
    const userDir = path.join(uploadsRoot, 'users', userId);
    await fs.promises.mkdir(userDir, { recursive: true });
    await fs.promises.writeFile(path.join(userDir, 'receipt.txt'), 'sensitive');

    const res = await request(app)
      .delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ confirmation: 'DELETE', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deleted).toBe(true);

    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await prisma.goal.count({ where: { userId } })).toBe(0);
    expect(await prisma.budget.count({ where: { userId } })).toBe(0);
    expect(fs.existsSync(userDir)).toBe(false);

    // The old access token no longer authenticates (user row is gone).
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.status).toBe(401);

    // The refresh token was revoked with the account.
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(401);
  });

  it('does not touch another user or their stored files', async () => {
    const victim = track(await register('victim'));
    const bystander = track(await register('bystander'));

    const bystanderDir = path.join(uploadsRoot, 'users', bystander.user.id);
    await fs.promises.mkdir(bystanderDir, { recursive: true });
    await fs.promises.writeFile(path.join(bystanderDir, 'keep.txt'), 'keep');

    const res = await request(app)
      .delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${victim.accessToken}`)
      .send({ confirmation: 'DELETE', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: victim.user.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: bystander.user.id } })).not.toBeNull();
    expect(fs.existsSync(path.join(bystanderDir, 'keep.txt'))).toBe(true);

    const bystanderMe = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${bystander.accessToken}`);
    expect(bystanderMe.status).toBe(200);

    await fs.promises.rm(bystanderDir, { recursive: true, force: true });
  });

  it('aborts deletion when stored files cannot be removed', async () => {
    const session = track(await register('storagefail'));

    const storageError = Object.assign(new Error('Object storage is temporarily unavailable. Please retry.'), {
      code: 'STORAGE_UNAVAILABLE',
      statusCode: 503,
    });
    const spy = jest.spyOn(storageService, 'deletePrefix').mockRejectedValueOnce(storageError);

    try {
      const res = await request(app)
        .delete('/api/v1/auth/account')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ confirmation: 'DELETE', password: PASSWORD });

      expect(res.status).toBe(503);
      // The account must survive so the user can retry; partial file deletion
      // must never be reported as a completed account deletion.
      expect(await prisma.user.findUnique({ where: { id: session.user.id } })).not.toBeNull();
    } finally {
      spy.mockRestore();
    }

    const retry = await request(app)
      .delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ confirmation: 'DELETE', password: PASSWORD });
    expect(retry.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: session.user.id } })).toBeNull();
  });

  it('maps a concurrent P2025 delete to an idempotent success', async () => {
    const session = track(await register('race'));

    const txSpy = jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(
      Object.assign(new Error('Record to delete does not exist.'), { code: 'P2025' })
    );

    try {
      const result = await authService.deleteAccount({
        userId: session.user.id,
        password: PASSWORD,
        confirmation: 'DELETE',
      });
      expect(result).toEqual({ deleted: true, alreadyDeleted: true });
    } finally {
      txSpy.mockRestore();
    }

    // The mocked transaction did not delete the row; clean it up for real.
    const res = await request(app)
      .delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ confirmation: 'DELETE', password: PASSWORD });
    expect(res.status).toBe(200);
  });
});

describe('storage prefix deletion safety', () => {
  it('rejects prefixes that are not exactly a tenant-owned prefix', async () => {
    for (const prefix of ['', '/', 'users', 'users/', 'users/../x/', 'users/u1', 'exports/u1', 'other/u1/']) {
      await expect(storageService.deletePrefix(prefix)).rejects.toMatchObject({
        code: 'INVALID_STORAGE_PREFIX',
      });
    }
  });

  it('deletes only files under the requested tenant prefix', async () => {
    const userId = `test-${unique()}`;
    const otherId = `test-${unique()}`;
    const root = path.join(__dirname, '..', '..', 'uploads');
    const userDir = path.join(root, 'users', userId);
    const otherDir = path.join(root, 'users', otherId);

    await fs.promises.mkdir(userDir, { recursive: true });
    await fs.promises.mkdir(otherDir, { recursive: true });
    await fs.promises.writeFile(path.join(userDir, 'a.txt'), 'a');
    await fs.promises.writeFile(path.join(otherDir, 'b.txt'), 'b');

    const result = await storageService.deletePrefix(`users/${userId}/`);

    expect(result.success).toBe(true);
    expect(fs.existsSync(userDir)).toBe(false);
    expect(fs.existsSync(path.join(otherDir, 'b.txt'))).toBe(true);

    await fs.promises.rm(otherDir, { recursive: true, force: true });
    await fs.promises.rm(userDir, { recursive: true, force: true });
  });
});
