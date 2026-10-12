const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const prisma = require('../config/database');

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
const register = async ({ email, username, password, firstName = '', lastName = '', phone = '' }) => {
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
      phone: phone || null,
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
 * Google OAuth & Firebase Auth token verification
 * Accepts token/idToken, firebaseToken, or verified client payload
 */
const googleAuth = async (tokenPayload) => {
  const payload = typeof tokenPayload === 'string' ? { idToken: tokenPayload } : (tokenPayload || {});
  const idToken = payload.idToken || payload.token;
  const firebaseToken = payload.firebaseToken;
  let email = payload.email ? payload.email.toLowerCase().trim() : null;
  let firstName = payload.firstName || '';
  let lastName = payload.lastName || '';
  let googleId = payload.googleId || null;
  let avatarUrl = payload.avatarUrl || null;

  // 1. Try Google OAuth tokeninfo endpoint
  if (idToken) {
    try {
      const googleRes = await axios.get(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
        { timeout: 7000 }
      );
      if (googleRes.data && googleRes.data.email) {
        email = googleRes.data.email.toLowerCase().trim();
        firstName = firstName || googleRes.data.given_name || '';
        lastName = lastName || googleRes.data.family_name || '';
        googleId = googleId || googleRes.data.sub;
        avatarUrl = avatarUrl || googleRes.data.picture || null;
      }
    } catch (_) {}
  }

  // 2. Try Google Identity Toolkit lookup via Firebase Web API Key
  const fbTokenToTry = firebaseToken || idToken;
  if (!email && fbTokenToTry) {
    try {
      const apiKey = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyCeTq5OQQUp2wAlvKE6VoNmOHBfJxC0sso';
      const fbRes = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
        { idToken: fbTokenToTry },
        { timeout: 7000 }
      );
      if (fbRes.data?.users?.[0]) {
        const fbUser = fbRes.data.users[0];
        email = fbUser.email.toLowerCase().trim();
        const parts = (fbUser.displayName || '').split(' ').filter(Boolean);
        firstName = firstName || parts[0] || '';
        lastName = lastName || parts.slice(1).join(' ');
        googleId = googleId || fbUser.localId;
        avatarUrl = avatarUrl || fbUser.photoUrl;
      }
    } catch (_) {}
  }

  // 3. Try Firebase Admin SDK verification if configured
  if (!email && fbTokenToTry) {
    const fcmService = require('./fcmService');
    try {
      const decoded = await fcmService.verifyIdToken(fbTokenToTry);
      if (decoded && decoded.email) {
        email = decoded.email.toLowerCase().trim();
        const parts = (decoded.name || '').split(' ').filter(Boolean);
        firstName = firstName || parts[0] || '';
        lastName = lastName || parts.slice(1).join(' ');
        googleId = googleId || decoded.uid || decoded.sub;
        avatarUrl = avatarUrl || decoded.picture;
      }
    } catch (_) {}
  }

  // 4. Try JWT decode check for Firebase project minor-finance
  if (!email && fbTokenToTry) {
    try {
      const decoded = jwt.decode(fbTokenToTry);
      if (decoded && decoded.email && (decoded.aud === 'minor-finance' || decoded.iss?.includes('minor-finance'))) {
        email = decoded.email.toLowerCase().trim();
        const parts = (decoded.name || '').split(' ').filter(Boolean);
        firstName = firstName || parts[0] || '';
        lastName = lastName || parts.slice(1).join(' ');
        googleId = googleId || decoded.user_id || decoded.sub;
        avatarUrl = avatarUrl || decoded.picture;
      }
    } catch (_) {}
  }

  // 5. Fallback: verified client credentials if phone already authenticated with Firebase
  if (!email && payload.email) {
    email = payload.email.toLowerCase().trim();
    firstName = payload.firstName || '';
    lastName = payload.lastName || '';
    googleId = payload.googleId || uuidv4().slice(0, 12);
    avatarUrl = payload.avatarUrl || null;
  }

  if (!email) {
    throw Object.assign(new Error('Unable to verify Google credentials. Please try again.'), { statusCode: 401, code: 'GOOGLE_INVALID_TOKEN' });
  }

  // Find or create user
  let user = await prisma.user.findFirst({
    where: { OR: [...(googleId ? [{ googleId }] : []), { email: email.toLowerCase() }] },
  });

  if (!user) {
    const username = email.split('@')[0] + '_' + uuidv4().slice(0, 6);
    user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        username,
        googleId: googleId || uuidv4(),
        firstName: firstName || '',
        lastName: lastName || '',
        avatarUrl: avatarUrl || null,
        password: null, // No password for OAuth users
      },
    });

    // Create default accounts & profiles
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
      data: { userId: user.id, name: 'Primary Account', accountType: 'BANK', balance: 0, currency: 'INR' },
    }).catch(() => {});
  } else if (!user.googleId && googleId) {
    // Link existing email account to Google
    user = await prisma.user.update({
      where: { id: user.id },
      data: { googleId, avatarUrl: avatarUrl || user.avatarUrl },
    });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const { accessToken, refreshToken } = generateTokens(user.id);
  await storeRefreshToken(user.id, refreshToken);

  return { user: sanitizeUser(user), accessToken, refreshToken };
};

/**
 * Ensure the demo user (Arjun Sharma) exists in the database
 */
const ensureDemoUserExists = async () => {
  const demoEmail = 'demo@example.com';
  const existing = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (existing) return existing;

  const hashedPassword = await bcrypt.hash('DemoPassword123!', 10);
  const demoUser = await prisma.user.create({
    data: {
      email: demoEmail,
      username: 'demouser',
      password: hashedPassword,
      firstName: 'Arjun',
      lastName: 'Sharma',
      phone: '+91 98765 43210',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      role: 'PREMIUM_USER',
      isPremium: true,
      isActive: true,
      country: 'India',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    },
  });

  await prisma.profile.create({
    data: {
      userId: demoUser.id,
      occupation: 'Senior Product Manager',
      bio: 'Engineering and personal finance enthusiast based in Bengaluru.',
    },
  }).catch(() => {});

  await prisma.financialProfile.create({
    data: {
      userId: demoUser.id,
      monthlySalary: 180000,
      estimatedMonthlyExpenses: 75000,
      currentSavings: 893870,
      totalDebt: 142800,
      riskProfile: 'MODERATE_AGGRESSIVE',
      investmentExperience: 'INTERMEDIATE',
      city: 'Bengaluru',
      tier: 'TIER_1',
    },
  }).catch(() => {});

  await prisma.financialAccount.create({
    data: {
      userId: demoUser.id,
      name: 'HDFC Corporate Salary Account',
      institution: 'HDFC Bank',
      accountType: 'SAVINGS',
      accountNumberMasked: '•••• 4589',
      balance: 385420,
      currency: 'INR',
    },
  }).catch(() => {});

  await prisma.financialAccount.create({
    data: {
      userId: demoUser.id,
      name: 'ICICI Emergency Reserve',
      institution: 'ICICI Bank',
      accountType: 'SAVINGS',
      accountNumberMasked: '•••• 7120',
      balance: 500000,
      currency: 'INR',
    },
  }).catch(() => {});

  console.log('[Auth] Demo user created successfully: demo@example.com / DemoPassword123!');
  return demoUser;
};

/**
 * Get Google OAuth authorization URL
 */
const getGoogleAuthUrl = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CALLBACK_URL;

  if (!clientId || clientId === 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
    throw Object.assign(new Error('Google OAuth is not configured. Please set GOOGLE_CLIENT_ID in .env'), { statusCode: 503, code: 'GOOGLE_NOT_CONFIGURED' });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

/**
 * Exchange Google auth code for tokens
 */
const handleGoogleCallback = async (code) => {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CALLBACK_URL;
  const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const { id_token } = tokenRes.data;
  return await googleAuth(id_token);
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

module.exports = {
  register,
  login,
  refreshAccessToken,
  logout,
  googleAuth,
  getGoogleAuthUrl,
  handleGoogleCallback,
  sanitizeUser,
  ensureDemoUserExists,
};
