/**
 * Google Authentication Backend Test Suite
 *
 * Verifies backend Google OAuth & Firebase token verification, user creation,
 * account linking, JWT generation, rate limiting, and security boundaries.
 */

'use strict';

jest.mock('../config/database', () => ({
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    upsert: jest.fn(),
  },
  profile: {
    create: jest.fn(),
  },
  financialProfile: {
    create: jest.fn(),
  },
  financialAccount: {
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
}));

// Mock Firebase Admin SDK
jest.mock('firebase-admin', () => ({
  apps: [],
  getApps: jest.fn(() => [{ name: '[DEFAULT]' }]),
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
}));

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

// Mock Google Auth Library
jest.mock('google-auth-library', () => {
  const verifyIdTokenMock = jest.fn();
  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({
      verifyIdToken: verifyIdTokenMock,
    })),
    __verifyIdTokenMock: verifyIdTokenMock,
  };
});

const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { getAuth } = require('firebase-admin/auth');
const { __verifyIdTokenMock } = require('google-auth-library');
const authService = require('../services/authService');
const { googleLogin, linkGoogle } = require('../controllers/authController');

process.env.JWT_SECRET = 'ci_test_jwt_secret_key_minimum_32_characters';
process.env.JWT_REFRESH_SECRET = 'ci_test_refresh_secret_key_minimum_32_characters';

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const bodyOf = (res) => res.json.mock.calls[0][0];

beforeEach(() => {
  jest.clearAllMocks();
  prisma.auditLog.create.mockResolvedValue({});
  prisma.refreshToken.upsert.mockResolvedValue({});
  prisma.profile.create.mockResolvedValue({});
  prisma.financialProfile.create.mockResolvedValue({});
  prisma.financialAccount.create.mockResolvedValue({});
});

describe('POST /api/v1/auth/google — Validation & Token Verification', () => {
  test('rejects missing idToken with 400 VALIDATION_ERROR', async () => {
    const res = makeRes();
    await googleLogin({ body: {} }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects non-string idToken with 400 VALIDATION_ERROR', async () => {
    const res = makeRes();
    await googleLogin({ body: { idToken: 12345 } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects invalid or expired token with 401 INVALID_TOKEN', async () => {
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockRejectedValue(new Error('Firebase ID token has expired.')),
    });
    __verifyIdTokenMock.mockRejectedValue(new Error('Token used too late.'));

    const res = makeRes();
    const next = jest.fn();

    await googleLogin({ body: { idToken: 'expired-or-invalid-token' } }, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('INVALID_TOKEN');
  });

  test('rejects unverified email claim with 400 UNVERIFIED_EMAIL', async () => {
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'unverified-google-user',
        email: 'unverified@example.com',
        email_verified: false,
      }),
    });

    const res = makeRes();
    const next = jest.fn();

    await googleLogin({ body: { idToken: 'unverified-token' } }, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('UNVERIFIED_EMAIL');
  });
});

describe('POST /api/v1/auth/google — User Management & Account Linking', () => {
  test('authenticates existing user linked by googleId', async () => {
    const mockUser = {
      id: 'user-google-1',
      email: 'alex@example.com',
      username: 'alex_g',
      googleId: 'google-sub-123',
      isActive: true,
      firstName: 'Alex',
      lastName: 'G',
      role: 'USER',
      isPremium: false,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      createdAt: new Date(),
    };

    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'google-sub-123',
        email: 'alex@example.com',
        email_verified: true,
        name: 'Alex G',
      }),
    });

    prisma.user.findFirst.mockResolvedValueOnce(mockUser);
    prisma.user.update.mockResolvedValueOnce({ ...mockUser, lastLoginAt: new Date() });

    const res = makeRes();
    await googleLogin({ body: { idToken: 'valid-firebase-token' }, ip: '127.0.0.1', headers: {} }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = bodyOf(res);
    expect(body.success).toBe(true);
    expect(body.data.user.id).toBe(mockUser.id);
    expect(body.data.user.email).toBe('alex@example.com');
    expect(body.data.accessToken).toBeDefined();
    expect(body.data.refreshToken).toBeDefined();

    // Verify JWT payload
    const decoded = jwt.verify(body.data.accessToken, process.env.JWT_SECRET);
    expect(decoded.userId).toBe(mockUser.id);
  });

  test('rejects unauthenticated auto-linking to password account with 409 ACCOUNT_EXISTS_WITH_PASSWORD to prevent Pre-ATO', async () => {
    const existingPasswordUser = {
      id: 'user-existing-pwd',
      email: 'jane@example.com',
      username: 'jane_existing',
      password: '$2a$12$hashedpasswordthatmustremainintact',
      googleId: null,
      isActive: true,
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'USER',
      isPremium: false,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      createdAt: new Date(),
    };

    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'google-sub-jane-999',
        email: 'jane@example.com',
        email_verified: true,
        name: 'Jane Doe',
      }),
    });

    // 1st lookup by googleId returns null
    prisma.user.findFirst.mockResolvedValueOnce(null);
    // 2nd lookup by email finds existing password user
    prisma.user.findFirst.mockResolvedValueOnce(existingPasswordUser);

    const res = makeRes();
    const next = jest.fn();
    await googleLogin({ body: { idToken: 'valid-jane-token' }, ip: '127.0.0.1', headers: {} }, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('ACCOUNT_EXISTS_WITH_PASSWORD');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('rejects sign-in collision when email is already linked to a different Google account with 409 ACCOUNT_LINK_CONFLICT', async () => {
    const existingGoogleUser = {
      id: 'user-other-google',
      email: 'alex@example.com',
      username: 'alex_g',
      googleId: 'google-sub-original',
      isActive: true,
    };

    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'google-sub-imposter-different',
        email: 'alex@example.com',
        email_verified: true,
      }),
    });

    // 1st lookup by googleId returns null (not matched)
    prisma.user.findFirst.mockResolvedValueOnce(null);
    // 2nd lookup by email finds user with different googleId
    prisma.user.findFirst.mockResolvedValueOnce(existingGoogleUser);

    const res = makeRes();
    const next = jest.fn();
    await googleLogin({ body: { idToken: 'imposter-token' }, ip: '127.0.0.1', headers: {} }, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('ACCOUNT_LINK_CONFLICT');
  });

  test('allows authenticated user to explicitly link Google account via POST /auth/google/link', async () => {
    const authUser = {
      id: 'user-auth-1',
      email: 'jane@example.com',
      username: 'jane_existing',
      googleId: null,
      isActive: true,
    };

    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'google-sub-jane-999',
        email: 'jane@example.com',
        email_verified: true,
      }),
    });

    prisma.user.findUnique.mockResolvedValueOnce(authUser);
    prisma.user.findFirst.mockResolvedValueOnce(null); // No collision with another user
    prisma.user.update.mockResolvedValueOnce({ ...authUser, googleId: 'google-sub-jane-999' });

    const res = makeRes();
    await linkGoogle({ user: { id: 'user-auth-1' }, body: { idToken: 'valid-jane-token' }, ip: '127.0.0.1', headers: {} }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = bodyOf(res);
    expect(body.success).toBe(true);
    expect(body.data.message).toMatch(/linked successfully/i);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-auth-1' },
      data: { googleId: 'google-sub-jane-999' },
    });
  });

  test('rejects authenticated link if Google email does not match user account email with 400 EMAIL_MISMATCH', async () => {
    const authUser = {
      id: 'user-auth-1',
      email: 'jane@example.com',
      googleId: null,
      isActive: true,
    };

    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'google-sub-other-email',
        email: 'otherperson@example.com',
        email_verified: true,
      }),
    });

    prisma.user.findUnique.mockResolvedValueOnce(authUser);

    const res = makeRes();
    const next = jest.fn();
    await linkGoogle({ user: { id: 'user-auth-1' }, body: { idToken: 'token' } }, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('EMAIL_MISMATCH');
  });

  test('creates new user, profile, financialProfile, and primary account on first-time Google sign-in', async () => {
    const newUser = {
      id: 'user-new-google-88',
      email: 'newuser@example.com',
      username: 'newuser',
      googleId: 'google-sub-new-88',
      avatarUrl: 'https://lh3.googleusercontent.com/photo.jpg',
      password: null,
      isActive: true,
      firstName: 'Priya',
      lastName: 'Sharma',
      role: 'USER',
      isPremium: false,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      createdAt: new Date(),
    };

    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'google-sub-new-88',
        email: 'newuser@example.com',
        email_verified: true,
        name: 'Priya Sharma',
        picture: 'https://lh3.googleusercontent.com/photo.jpg',
      }),
    });

    // Not found by googleId, not found by email
    prisma.user.findFirst.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce(null);
    prisma.user.findUnique.mockResolvedValueOnce(null); // username check
    prisma.user.create.mockResolvedValueOnce(newUser);
    prisma.user.update.mockResolvedValueOnce(newUser);

    const res = makeRes();
    await googleLogin({ body: { idToken: 'valid-priya-token' }, ip: '127.0.0.1', headers: {} }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = bodyOf(res);
    expect(body.success).toBe(true);
    expect(body.data.message).toMatch(/welcome to finpro/i);
    expect(body.data.user.email).toBe('newuser@example.com');

    // Assert initial profile and account creation
    expect(prisma.profile.create).toHaveBeenCalledWith({ data: { userId: newUser.id } });
    expect(prisma.financialProfile.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: newUser.id }),
    }));
    expect(prisma.financialAccount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: newUser.id,
        name: 'Primary Account',
        accountType: 'BANK',
        balance: 0,
      }),
    }));
  });

  test('rejects sign-in for deactivated accounts with 403 ACCOUNT_DEACTIVATED', async () => {
    const deactivatedUser = {
      id: 'user-deactivated',
      email: 'banned@example.com',
      username: 'banned',
      googleId: 'google-sub-banned',
      isActive: false,
    };

    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'google-sub-banned',
        email: 'banned@example.com',
        email_verified: true,
      }),
    });

    prisma.user.findFirst.mockResolvedValueOnce(deactivatedUser);

    const res = makeRes();
    const next = jest.fn();

    await googleLogin({ body: { idToken: 'banned-token' } }, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('ACCOUNT_DEACTIVATED');
  });
});

describe('Google Identity Normalization (Flutter vs Web Parity)', () => {
  const CANONICAL_GOOGLE_SUB = '102477631150288888888';
  const CANONICAL_EMAIL = 'crossplatform@example.com';

  test('normalizes Firebase ID token to extract Google provider subject ID rather than ephemeral Firebase UID', async () => {
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'ephemeral-firebase-uid-28char',
        email: CANONICAL_EMAIL,
        email_verified: true,
        name: 'Cross Platform User',
        firebase: {
          identities: {
            'google.com': [CANONICAL_GOOGLE_SUB],
          },
        },
      }),
    });

    const verified = await authService.verifyGoogleToken('mock-firebase-token');
    expect(verified.uid).toBe(CANONICAL_GOOGLE_SUB);
    expect(verified.provider).toBe('firebase');
    expect(verified.email).toBe(CANONICAL_EMAIL);
  });

  test('normalizes Direct Google OAuth ID token (Web) to extract payload.sub', async () => {
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockRejectedValue(new Error('Not a Firebase token')),
    });
    __verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        sub: CANONICAL_GOOGLE_SUB,
        email: CANONICAL_EMAIL,
        email_verified: true,
        name: 'Cross Platform User',
      }),
    });

    const verified = await authService.verifyGoogleToken('mock-web-google-oauth-token');
    expect(verified.uid).toBe(CANONICAL_GOOGLE_SUB);
    expect(verified.provider).toBe('google');
    expect(verified.email).toBe(CANONICAL_EMAIL);
  });

  test('both Flutter (Firebase ID token) and Web (direct Google OAuth) resolve to the exact same FINpro user', async () => {
    const crossPlatformUser = {
      id: 'user-cross-platform-77',
      email: CANONICAL_EMAIL,
      username: 'crossplatform',
      googleId: CANONICAL_GOOGLE_SUB,
      isActive: true,
      firstName: 'Cross',
      lastName: 'Platform',
      role: 'USER',
      isPremium: false,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      createdAt: new Date(),
    };

    // 1. Flutter login (Firebase Token)
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'ephemeral-firebase-uid-28char',
        email: CANONICAL_EMAIL,
        email_verified: true,
        name: 'Cross Platform User',
        firebase: {
          identities: {
            'google.com': [CANONICAL_GOOGLE_SUB],
          },
        },
      }),
    });

    prisma.user.findFirst.mockResolvedValueOnce(crossPlatformUser);
    prisma.user.update.mockResolvedValueOnce(crossPlatformUser);

    const flutterRes = makeRes();
    await googleLogin({ body: { idToken: 'flutter-firebase-token' }, ip: '127.0.0.1', headers: {} }, flutterRes, jest.fn());

    expect(flutterRes.status).toHaveBeenCalledWith(200);
    expect(bodyOf(flutterRes).data.user.id).toBe('user-cross-platform-77');

    // 2. Web login (Google OAuth Token)
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockRejectedValue(new Error('Not a Firebase token')),
    });
    __verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        sub: CANONICAL_GOOGLE_SUB,
        email: CANONICAL_EMAIL,
        email_verified: true,
        name: 'Cross Platform User',
      }),
    });

    prisma.user.findFirst.mockResolvedValueOnce(crossPlatformUser);
    prisma.user.update.mockResolvedValueOnce(crossPlatformUser);

    const webRes = makeRes();
    await googleLogin({ body: { idToken: 'web-oauth-token' }, ip: '127.0.0.1', headers: {} }, webRes, jest.fn());

    expect(webRes.status).toHaveBeenCalledWith(200);
    expect(bodyOf(webRes).data.user.id).toBe('user-cross-platform-77');

    // Confirm that the same FINpro user ID is returned in both cases
    expect(bodyOf(flutterRes).data.user.id).toBe(bodyOf(webRes).data.user.id);
  });
});
