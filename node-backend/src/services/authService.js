const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
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
  sanitizeUser,
  ensureDemoUserExists,
};
