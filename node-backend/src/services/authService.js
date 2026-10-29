const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/database');
const storageService = require('./storageService');

const SALT_ROUNDS = 12;

/**
 * Generate access + refresh token pair
 */
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId, jti: uuidv4() },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '60m' }
  );
  const refreshToken = jwt.sign(
    { userId, jti: uuidv4() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
};

/**
 * Store refresh token in DB
 */
const storeRefreshToken = async (userId, token) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await prisma.refreshToken.upsert({
    where: { token },
    update: { expiresAt },
    create: { token, userId, expiresAt },
  });
};

/**
 * Register a new user
 */
const register = async ({ email, username, password, firstName = '', lastName = '' }) => {
  const normalizedEmail = (email || '').toLowerCase().trim();
  const normalizedUsername = (username || '').trim();

  // Check for existing user
  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ email: normalizedEmail }, { username: normalizedUsername }] },
  });
  if (existingUser) {
    if (existingUser.email.toLowerCase() === normalizedEmail) {
      throw Object.assign(new Error('An account with this email already exists.'), { statusCode: 409, code: 'EMAIL_EXISTS' });
    }
    throw Object.assign(new Error('That username is already taken.'), { statusCode: 409, code: 'USERNAME_EXISTS' });
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      username: normalizedUsername,
      password: hashedPassword,
      firstName: (firstName || '').trim(),
      lastName: (lastName || '').trim(),
    },
  });

  // Create Profile and FinancialProfile
  await prisma.profile.create({
    data: { userId: user.id },
  }).catch(() => {});

  await prisma.financialProfile.create({
    data: {
      userId: user.id,
      monthlySalary: 0,
      estimatedMonthlyExpenses: 0,
      currentSavings: 0,
      totalDebt: 0,
    },
  }).catch(() => {});

  // Create default financial account
  await prisma.financialAccount.create({
    data: {
      userId: user.id,
      name: 'Primary Account',
      accountType: 'BANK',
      balance: 0,
      currency: 'INR',
    },
  });

  const { accessToken, refreshToken } = generateTokens(user.id);
  await storeRefreshToken(user.id, refreshToken);

  return { user: sanitizeUser(user), accessToken, refreshToken };
};

/**
 * Login with email/username + password
 */
const login = async ({ emailOrUsername, password }) => {
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: emailOrUsername.toLowerCase().trim() },
        { username: emailOrUsername.trim() },
      ],
    },
  });

  if (!user || !user.password) {
    throw Object.assign(new Error('Invalid email/username or password.'), { statusCode: 401, code: 'INVALID_CREDENTIALS' });
  }

  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    throw Object.assign(new Error('Invalid email/username or password.'), { statusCode: 401, code: 'INVALID_CREDENTIALS' });
  }

  if (!user.isActive) {
    throw Object.assign(new Error('Your account has been deactivated.'), { statusCode: 403, code: 'ACCOUNT_DEACTIVATED' });
  }

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const { accessToken, refreshToken } = generateTokens(user.id);
  await storeRefreshToken(user.id, refreshToken);

  return { user: sanitizeUser(user), accessToken, refreshToken };
};

/**
 * Refresh access token using refresh token
 */
const refreshAccessToken = async (refreshToken) => {
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw Object.assign(new Error('Invalid or expired refresh token.'), { statusCode: 401, code: 'INVALID_REFRESH_TOKEN' });
  }

  // Check it exists in DB (revocation check)
  const storedToken = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
  if (!storedToken || storedToken.expiresAt < new Date()) {
    throw Object.assign(new Error('Refresh token has been revoked or expired.'), { statusCode: 401, code: 'TOKEN_REVOKED' });
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (!user || !user.isActive) {
    throw Object.assign(new Error('User not found.'), { statusCode: 401, code: 'USER_NOT_FOUND' });
  }

  // Rotate: delete old, create new
  await prisma.refreshToken.delete({ where: { token: refreshToken } });
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.id);
  await storeRefreshToken(user.id, newRefreshToken);

  return { accessToken, refreshToken: newRefreshToken };
};

/**
 * Logout — revoke refresh token
 */
const logout = async (refreshToken) => {
  if (refreshToken) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }
  return true;
};

/**
 * Permanently delete a user account and every user-owned record.
 *
 * This is a genuine hard delete, not a deactivation:
 *   - password accounts must re-enter their password (fresh proof of ownership);
 *   - passwordless accounts (for example Google-linked) rely on the valid
 *     access token plus the explicit `DELETE` confirmation, because there is no
 *     local password to verify;
 *   - user files are removed from object storage first, so a storage outage
 *     fails the request instead of deleting the database row while silently
 *     leaving receipts/exports behind;
 *   - every user-owned Prisma relation already declares onDelete: Cascade, so
 *     the single User delete removes financial data atomically.
 *
 * The caller must be authenticated; `userId` comes only from the verified JWT.
 */
const deleteAccount = async ({ userId, password, confirmation }) => {
  if (String(confirmation || '').trim().toUpperCase() !== 'DELETE') {
    throw Object.assign(new Error('Type DELETE to confirm permanent account deletion.'), {
      statusCode: 400,
      code: 'CONFIRMATION_REQUIRED',
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, password: true },
  });

  if (!user) {
    throw Object.assign(new Error('User not found.'), { statusCode: 401, code: 'USER_NOT_FOUND' });
  }

  if (user.password) {
    if (!password) {
      throw Object.assign(new Error('Password is required to delete this account.'), {
        statusCode: 400,
        code: 'PASSWORD_REQUIRED',
      });
    }
    const passwordMatch = await bcrypt.compare(String(password), user.password);
    if (!passwordMatch) {
      throw Object.assign(new Error('Incorrect password.'), {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
    }
  }

  // Remove user-owned objects before deleting the row. Prefixes are validated
  // by StorageService and scoped to this authenticated user only.
  await storageService.deletePrefix(`users/${userId}/`);
  await storageService.deletePrefix(`exports/${userId}/`);

  try {
    await prisma.$transaction([
      prisma.refreshToken.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);
  } catch (error) {
    // A concurrent request may have already committed the deletion. Treat that
    // as success so retries are idempotent rather than a 500.
    if (error && error.code === 'P2025') {
      return { deleted: true, alreadyDeleted: true };
    }
    throw error;
  }

  return { deleted: true, alreadyDeleted: false };
};

/**
 * Strip sensitive fields from user object
 */
const sanitizeUser = (user) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
  phone: user.phone,
  avatarUrl: user.avatarUrl,
  role: user.role,
  isPremium: user.isPremium,
  currency: user.currency,
  timezone: user.timezone,
  createdAt: user.createdAt,
});

/**
 * Verify Google ID token or Firebase ID token.
 * Supports:
 * 1. Firebase ID token via Firebase Admin SDK.
 * 2. Google OAuth ID token via Google OAuth2Client.
 */
const verifyGoogleToken = async (idToken) => {
  if (!idToken || typeof idToken !== 'string') {
    throw Object.assign(new Error('idToken is required.'), { statusCode: 400, code: 'VALIDATION_ERROR' });
  }

  const trimmedToken = idToken.trim();
  let verified = null;

  // 1. Try Firebase Admin ID token verification first
  try {
    const admin = require('firebase-admin');
    const { getAuth } = require('firebase-admin/auth');

    const apps = admin.getApps ? admin.getApps() : (admin.apps || []);
    if (!apps.length) {
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      const projectId = process.env.FIREBASE_PROJECT_ID || 'minor-finance';

      if (serviceAccountJson && serviceAccountJson !== 'YOUR_FIREBASE_SERVICE_ACCOUNT_JSON') {
        const serviceAccount = JSON.parse(serviceAccountJson);
        const cred = admin.cert ? admin.cert(serviceAccount) : (admin.credential && admin.credential.cert ? admin.credential.cert(serviceAccount) : undefined);
        admin.initializeApp({ ...(cred ? { credential: cred } : {}), projectId: serviceAccount.project_id || projectId });
      } else {
        admin.initializeApp({ projectId });
      }
    }

    const decoded = await getAuth().verifyIdToken(trimmedToken);
    const googleSub = decoded.firebase?.identities?.['google.com']?.[0] || decoded.sub || decoded.uid;
    verified = {
      uid: googleSub,
      email: (decoded.email || '').toLowerCase().trim(),
      emailVerified: Boolean(decoded.email_verified),
      name: decoded.name || '',
      picture: decoded.picture || null,
      provider: 'firebase',
    };
  } catch (firebaseErr) {
    // 2. If Firebase verification fails, try Google OAuth ID token verification
    try {
      const { OAuth2Client } = require('google-auth-library');
      const client = new OAuth2Client();
      const ticket = await client.verifyIdToken({
        idToken: trimmedToken,
        audience: [
          process.env.GOOGLE_CLIENT_ID,
          '1024776311502-8jld09q86kqeei2ud56krp4kb2sht67l.apps.googleusercontent.com',
          '1024776311502-02qf5999j49r784gao2nvqjjoi2avvbg.apps.googleusercontent.com',
          '1024776311502-p48ego8rv07r8oe9d8p5g5n8jirb9kkh.apps.googleusercontent.com',
        ].filter(Boolean),
      });
      const payload = ticket.getPayload();
      if (payload) {
        verified = {
          uid: payload.sub,
          email: (payload.email || '').toLowerCase().trim(),
          emailVerified: Boolean(payload.email_verified),
          name: payload.name || '',
          picture: payload.picture || null,
          provider: 'google',
        };
      }
    } catch (googleErr) {
      throw Object.assign(
        new Error('Invalid, expired or unverified Google token.'),
        { statusCode: 401, code: 'INVALID_TOKEN' }
      );
    }
  }

  if (!verified || !verified.email || !verified.emailVerified) {
    throw Object.assign(
      new Error('Google email is required and must be verified by Google.'),
      { statusCode: 400, code: 'UNVERIFIED_EMAIL' }
    );
  }

  return verified;
};

/**
 * Authenticate or register a user via Google identity token
 */
const googleLogin = async ({ idToken }) => {
  const verified = await verifyGoogleToken(idToken);
  const { uid, email, name, picture } = verified;

  // 1. Check if user already exists with this googleId
  let user = await prisma.user.findFirst({
    where: { googleId: uid },
  });

  let isNewUser = false;

  if (!user) {
    // 2. Check if a user exists with this verified email
    const existingUser = await prisma.user.findFirst({
      where: { email },
    });

    if (existingUser) {
      // Security Policy: Reject collision if already linked to a different Google account
      if (existingUser.googleId && existingUser.googleId !== uid) {
        throw Object.assign(
          new Error('This email address is already associated with another Google account.'),
          { statusCode: 409, code: 'ACCOUNT_LINK_CONFLICT' }
        );
      }

      // Security Policy: Prevent Pre-Account Takeover (Pre-ATO).
      // If the account has a password, do not automatically link on unauthenticated OAuth sign-in.
      // The user must sign in with their password first or link from an authenticated session.
      if (existingUser.password !== null) {
        throw Object.assign(
          new Error('An account with this email already exists with password login. Please sign in with your email and password to access or link your account.'),
          { statusCode: 409, code: 'ACCOUNT_EXISTS_WITH_PASSWORD' }
        );
      }

      // Safe linking: Existing passwordless OAuth user without googleId set
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          googleId: uid,
          ...(picture && !existingUser.avatarUrl ? { avatarUrl: picture } : {}),
        },
      });
    } else {
      // 3. First-time Google user: Create new account
      isNewUser = true;
      let baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '') || 'user';
      let username = baseUsername;
      let counter = 1;
      while (await prisma.user.findUnique({ where: { username } })) {
        username = `${baseUsername}${counter++}`;
      }

      const nameParts = (name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || username;
      const lastName = nameParts.slice(1).join(' ') || '';

      user = await prisma.user.create({
        data: {
          email,
          username,
          firstName,
          lastName,
          googleId: uid,
          avatarUrl: picture,
          password: null, // passwordless OAuth user
        },
      });

      // Default profile records
      await prisma.profile.create({ data: { userId: user.id } }).catch(() => {});
      await prisma.financialProfile.create({
        data: {
          userId: user.id,
          monthlySalary: 0,
          estimatedMonthlyExpenses: 0,
          currentSavings: 0,
          totalDebt: 0,
        },
      }).catch(() => {});
      await prisma.financialAccount.create({
        data: {
          userId: user.id,
          name: 'Primary Account',
          accountType: 'BANK',
          balance: 0,
          currency: 'INR',
        },
      });
    }
  }

  if (!user.isActive) {
    throw Object.assign(new Error('This account has been deactivated. Please contact support.'), {
      statusCode: 403,
      code: 'ACCOUNT_DEACTIVATED',
    });
  }

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  }).catch(() => {});

  const { accessToken, refreshToken } = generateTokens(user.id);
  await storeRefreshToken(user.id, refreshToken);

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken,
    isNewUser,
  };
};

/**
 * Explicitly link a verified Google account to an authenticated user's profile
 */
const linkGoogleAccount = async (userId, { idToken }) => {
  const verified = await verifyGoogleToken(idToken);
  const { uid, email } = verified;

  const currentUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!currentUser || !currentUser.isActive) {
    throw Object.assign(new Error('User not found or account deactivated.'), {
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });
  }

  if (currentUser.googleId === uid) {
    return { user: sanitizeUser(currentUser), alreadyLinked: true };
  }

  if (currentUser.googleId && currentUser.googleId !== uid) {
    throw Object.assign(new Error('This FINpro account is already linked to a different Google account.'), {
      statusCode: 409,
      code: 'ACCOUNT_LINK_CONFLICT',
    });
  }

  // Ensure verified Google email matches this account's email
  if (currentUser.email.toLowerCase() !== email.toLowerCase()) {
    throw Object.assign(new Error('Google account email does not match your FINpro email address.'), {
      statusCode: 400,
      code: 'EMAIL_MISMATCH',
    });
  }

  // Check if this Google ID is already claimed by another user
  const conflictUser = await prisma.user.findFirst({ where: { googleId: uid } });
  if (conflictUser && conflictUser.id !== userId) {
    throw Object.assign(new Error('This Google account is already linked to another FINpro user.'), {
      statusCode: 409,
      code: 'ACCOUNT_LINK_CONFLICT',
    });
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { googleId: uid },
  });

  return { user: sanitizeUser(updatedUser), linked: true };
};

module.exports = {
  register,
  login,
  googleLogin,
  linkGoogleAccount,
  verifyGoogleToken,
  refreshAccessToken,
  logout,
  deleteAccount,
};
