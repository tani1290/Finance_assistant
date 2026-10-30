/**
 * FinPro — Test Fixtures & Deterministic Seed Data
 */

const timestamp = Date.now();

const testUser = {
  firstName: 'Test',
  lastName: 'User',
  username: `testuser_${timestamp}`,
  email: `testuser_${timestamp}@example.com`,
  password: 'Password123!',
};

const viewports = {
  desktop: { width: 1440, height: 900, name: 'Desktop (1440x900)' },
  laptop: { width: 1280, height: 800, name: 'Laptop (1280x800)' },
  tablet: { width: 768, height: 1024, name: 'Tablet (768x1024)' },
  mobile: { width: 390, height: 844, name: 'Mobile (390x844)' },
  smallMobile: { width: 360, height: 800, name: 'Small mobile (360x800)' },
};

const sampleTransaction = {
  amount: 1250,
  type: 'EXPENSE',
  category: 'Food & Dining',
  merchantName: 'Blue Tokai Coffee',
  paymentMode: 'UPI',
  description: 'Team coffee meeting',
};

const sampleBudget = {
  category: 'Food & Dining',
  amount: 8000,
  period: 'MONTHLY',
};

module.exports = {
  testUser,
  viewports,
  sampleTransaction,
  sampleBudget,
};
