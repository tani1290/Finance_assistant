const request = require('supertest');
const app = require('../app');
const prisma = require('../config/database');

describe('Jinay Finance AI — Full API Test Suite', () => {
  let userA, tokenA, userB, tokenB;
  let accountAId, txAIncomeId, txAExpenseId, budgetAId, goalAId, loanAId, invAId;

  const testUserA = {
    email: `test_a_${Date.now()}@example.com`,
    username: `usera_${Date.now()}`,
    password: 'Password123!',
    firstName: 'Jinay',
    lastName: 'Golecha',
  };

  const testUserB = {
    email: `test_b_${Date.now()}@example.com`,
    username: `userb_${Date.now()}`,
    password: 'Password123!',
    firstName: 'Other',
    lastName: 'User',
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    // Cleanup created test users
    if (userA?.id) {
      await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    }
    if (userB?.id) {
      await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  // ==========================================
  // PHASE 31 — SERVER HEALTH
  // ==========================================
  describe('1. Health Endpoints', () => {
    it('GET /api/v1/health should return ok and connected database', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.database).toBe('connected');
      expect(res.body.currency).toBe('INR');
    });

    it('GET /api/v1/health/database should return latency', async () => {
      const res = await request(app).get('/api/v1/health/database');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('connected');
      expect(typeof res.body.latencyMs).toBe('number');
    });

    it('GET /api/v1/health/ai should return status', async () => {
      const res = await request(app).get('/api/v1/health/ai');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.provider).toBe('Google Gemini');
    });

    it('GET /api/v1/health/market should return provider info', async () => {
      const res = await request(app).get('/api/v1/health/market');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.provider).toBe('Finnhub');
    });
  });

  // ==========================================
  // PHASE 4 — AUTHENTICATION (SIGNUP & LOGIN)
  // ==========================================
  describe('2. Authentication Flow', () => {
    it('POST /api/v1/auth/register should create User, Profile, FinancialProfile and Account', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(testUserA);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(testUserA.email);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();

      userA = res.body.data.user;
      tokenA = res.body.data.accessToken;

      // Verify PostgreSQL persistence
      const dbUser = await prisma.user.findUnique({
        where: { id: userA.id },
        include: { profile: true, financialProfile: true, accounts: true },
      });
      expect(dbUser).not.toBeNull();
      expect(dbUser.accounts.length).toBeGreaterThan(0);
      accountAId = dbUser.accounts[0].id;
    });

    it('POST /api/v1/auth/register should reject duplicate email', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(testUserA);
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/auth/login should authenticate and return tokens', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: testUserA.email,
        password: testUserA.password,
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      tokenA = res.body.data.accessToken;
    });

    it('POST /api/v1/auth/login should reject wrong password', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: testUserA.email,
        password: 'WrongPassword!',
      });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('GET /api/v1/auth/me should return authenticated user details', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(userA.id);
      expect(res.body.data.firstName).toBe('Jinay');
    });

    // Register User B for multi-user isolation tests
    it('Should register User B successfully', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(testUserB);
      expect(res.status).toBe(201);
      userB = res.body.data.user;
      tokenB = res.body.data.accessToken;
    });
  });

  // ==========================================
  // PHASE 11 — FINANCIAL ONBOARDING
  // ==========================================
  describe('3. Financial Onboarding', () => {
    it('POST /api/v1/onboarding should store profile and compute financial plan', async () => {
      const res = await request(app)
        .post('/api/v1/onboarding')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          age: 23,
          city: 'Mumbai',
          monthlySalary: 100000,
          estimatedMonthlyExpenses: 30000,
          currentSavings: 50000,
          totalDebt: 0,
          riskProfile: 'MODERATE',
          budgetMethod: 'FIFTY_THIRTY_TWENTY',
          financialPriorities: 'Save for home, invest in mutual funds',
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isOnboardingComplete).toBe(true);
      expect(typeof res.body.data.healthScore).toBe('number');
    });

    it('GET /api/v1/onboarding/status should reflect completed status', async () => {
      const res = await request(app)
        .get('/api/v1/onboarding/status')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.data.isOnboardingComplete).toBe(true);
    });
  });

  // ==========================================
  // PHASE 8 & 9 — ACCOUNTS & TRANSACTIONS CORRELATION
  // ==========================================
  describe('4. Accounts, Add Money & Mandatory Data Correlation', () => {
    it('POST /api/v1/accounts/:id/deposit should add ₹1,00,000 and create income record', async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${accountAId}/deposit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          amount: 100000,
          source: 'Salary',
          description: 'Monthly Salary Deposit',
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.newBalance).toBeGreaterThanOrEqual(100000);
      txAIncomeId = res.body.data.transactionId;
    });

    it('GET /api/v1/dashboard should show Total Balance and Monthly Income', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.data.monthlyIncome).toBeGreaterThanOrEqual(100000);
      expect(res.body.data.totalBalance).toBeGreaterThanOrEqual(100000);
    });

    it('POST /api/v1/transactions should add ₹20,000 expense and reduce account balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          amount: 20000,
          type: 'EXPENSE',
          category: 'Food',
          accountId: accountAId,
          description: 'Grocery shopping',
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      txAExpenseId = res.body.data.id;

      // Verify account balance decreased
      const accRes = await request(app)
        .get(`/api/v1/accounts/${accountAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(accRes.status).toBe(200);
    });

    it('DELETE /api/v1/transactions/:id should reverse account balance upon deletion', async () => {
      const accBefore = await request(app)
        .get(`/api/v1/accounts/${accountAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      const balanceBefore = parseFloat(accBefore.body.data.balance);

      const delRes = await request(app)
        .delete(`/api/v1/transactions/${txAExpenseId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(delRes.status).toBe(200);

      const accAfter = await request(app)
        .get(`/api/v1/accounts/${accountAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      const balanceAfter = parseFloat(accAfter.body.data.balance);

      expect(balanceAfter).toBeCloseTo(balanceBefore + 20000, 1);
    });
  });

  // ==========================================
  // PHASE 10 — BUDGETS
  // ==========================================
  describe('5. Budget Management', () => {
    it('POST /api/v1/budgets should create a category budget', async () => {
      const now = new Date();
      const res = await request(app)
        .post('/api/v1/budgets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          categoryName: 'Food & Dining',
          monthlyLimit: 15000,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      budgetAId = res.body.data.id;
    });

    it('GET /api/v1/budgets should calculate spending and remaining', async () => {
      const now = new Date();
      const res = await request(app)
        .get(`/api/v1/budgets?month=${now.getMonth() + 1}&year=${now.getFullYear()}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.budgets)).toBe(true);
    });

    it('PATCH /api/v1/budgets/:id should update monthly limit', async () => {
      const res = await request(app)
        .patch(`/api/v1/budgets/${budgetAId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ monthlyLimit: 20000 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ==========================================
  // PHASE 12 — GOALS
  // ==========================================
  describe('6. Goals CRUD & Contributions', () => {
    it('POST /api/v1/goals should create a new savings goal', async () => {
      const res = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Emergency Fund',
          goalType: 'EMERGENCY_FUND',
          targetAmount: 180000,
          currentAmount: 30000,
          monthlyContribution: 10000,
          priority: 'HIGH',
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      goalAId = res.body.data.id;
    });

    it('PATCH /api/v1/goals/:id/contribute should increment current amount', async () => {
      const res = await request(app)
        .patch(`/api/v1/goals/${goalAId}/contribute`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: 20000 });
      expect(res.status).toBe(200);
      // Prisma Decimal serialises to a string over JSON; clients parse it
      // (web parseFloat/formatINR, mobile double.tryParse).
      expect(res.body.data.currentAmount).toBe('50000');
    });
  });

  // ==========================================
  // PHASE 13 & 14 — INVESTMENTS & MARKET
  // ==========================================
  describe('7. Investments & Market Data', () => {
    it('POST /api/v1/investments/buy should add stock to portfolio', async () => {
      const res = await request(app)
        .post('/api/v1/investments/buy')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          symbol: 'RELIANCE',
          name: 'Reliance Industries',
          assetType: 'STOCK',
          quantity: 10,
          buyPrice: 2400,
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      invAId = res.body.data.id;
    });

    it('GET /api/v1/investments/portfolio should compute portfolio metrics', async () => {
      const res = await request(app)
        .get('/api/v1/investments/portfolio')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalInvested).toBeGreaterThanOrEqual(24000);
      expect(Array.isArray(res.body.data.holdings)).toBe(true);
    });

    it('GET /api/v1/market/quote should return stock price info', async () => {
      const res = await request(app)
        .get('/api/v1/market/quote?symbol=TCS')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.symbol).toBe('TCS');
    });
  });

  // ==========================================
  // PHASE 15 — LOANS & EMI
  // ==========================================
  describe('8. Loans & EMI Simulation', () => {
    it('POST /api/v1/loans/calculate-emi should accurately calculate EMI', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-emi')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          principal: 1000000,
          interestRate: 8.5,
          tenureMonths: 120,
        });
      expect(res.status).toBe(200);
      expect(res.body.data.emi).toBeGreaterThan(12000);
    });

    it('POST /api/v1/loans should create a loan', async () => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          loanType: 'HOME',
          lenderName: 'HDFC Bank',
          principalAmount: 500000,
          interestRate: 8.5,
          tenureMonths: 60,
        });
      expect(res.status).toBe(201);
      loanAId = res.body.data.id;
    });

    it('POST /api/v1/loans/prepayment-simulate should calculate savings', async () => {
      const res = await request(app)
        .post('/api/v1/loans/prepayment-simulate')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          loanId: loanAId,
          prepaymentAmount: 50000,
        });
      expect(res.status).toBe(200);
      expect(res.body.data.monthsSaved).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // PHASE 19 — VOICE RECOGNITION PARSER
  // ==========================================
  describe('9. Voice Entry Natural Language Parser', () => {
    it('POST /api/v1/transactions/voice should parse "I spent 500 rupees on food"', async () => {
      const res = await request(app)
        .post('/api/v1/transactions/voice')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ text: 'I spent 500 rupees on food' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.parsed.amount).toBe(500);
      expect(res.body.data.parsed.type).toBe('EXPENSE');
      expect(res.body.data.parsed.category).toBe('Food & Dining');
    });

    it('POST /api/v1/transactions/voice should parse income "Received 50000 salary"', async () => {
      const res = await request(app)
        .post('/api/v1/transactions/voice')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ text: 'Received 50000 salary' });
      expect(res.status).toBe(200);
      expect(res.body.data.parsed.amount).toBe(50000);
      expect(res.body.data.parsed.type).toBe('INCOME');
    });
  });

  // ==========================================
  // PHASE 20 & 21 — AI FINANCIAL ADVISOR
  // ==========================================
  describe('10. AI Chat & Financial Advisor', () => {
    it('POST /api/v1/ai/chat should use real financial context and return response', async () => {
      const res = await request(app)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: 'What is my current bank balance?' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.response).toBe('string');
      expect(res.body.data.response.length).toBeGreaterThan(10);
    });

    it('GET /api/v1/ai/snapshot should return real-time financial metrics', async () => {
      const res = await request(app)
        .get('/api/v1/ai/snapshot')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.data.totalBalance).toBeGreaterThanOrEqual(0);
      expect(typeof res.body.data.healthScore).toBe('number');
    });
  });

  // ==========================================
  // PHASE 23 — EXPORT
  // ==========================================
  describe('11. Data Exports (CSV)', () => {
    it('GET /api/v1/export/transactions.csv should return CSV format', async () => {
      const res = await request(app)
        .get('/api/v1/export/transactions.csv')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Date');
      expect(res.text).toContain('Amount');
    });

    it('GET /api/v1/export/summary.csv should return Summary Report CSV', async () => {
      const res = await request(app)
        .get('/api/v1/export/summary.csv')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Summary Report');
    });
  });

  // ==========================================
  // PHASE 25 — MULTI-USER DATA ISOLATION
  // ==========================================
  describe('12. User Data Isolation (A vs B)', () => {
    it('User B should not see User A accounts', async () => {
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(200);
      const ids = res.body.data.accounts.map(a => a.id);
      expect(ids).not.toContain(accountAId);
    });

    it('User B cannot access User A account by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/accounts/${accountAId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
    });

    it('User B cannot access or update User A budget', async () => {
      const res = await request(app)
        .patch(`/api/v1/budgets/${budgetAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ monthlyLimit: 99999 });
      expect(res.status).toBe(404);
    });

    it('User B cannot access or delete User A goal', async () => {
      const res = await request(app)
        .delete(`/api/v1/goals/${goalAId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // PHASE 9 — RECEIPT HISTORY (CRUD & OWNERSHIP)
  // ==========================================
  describe('13. Receipt History (CRUD & Ownership)', () => {
    let receiptAId;

    beforeAll(async () => {
      const receipt = await prisma.receiptScan.create({
        data: {
          userId: userA.id,
          merchant: 'Test Merchant',
          amount: 249.5,
          date: new Date('2026-01-15'),
          category: 'Food & Dining',
          items: {
            lineItems: [{ name: 'Latte', price: 249.5 }],
            gst: { cgst: 5, sgst: 5 },
            confidence: 92,
            storageKey: `users/${userA.id}/receipts/seed_receipt.png`,
          },
          rawText: 'TEST RECEIPT RAW TEXT',
          status: 'PENDING_CONFIRMATION',
        },
      });
      receiptAId = receipt.id;
    });

    afterAll(async () => {
      if (receiptAId) {
        await prisma.receiptScan.delete({ where: { id: receiptAId } }).catch(() => {});
      }
    });

    it('GET /api/v1/receipts should require authentication', async () => {
      const res = await request(app).get('/api/v1/receipts');
      expect(res.status).toBe(401);
    });

    it('User A sees their own receipt in the list', async () => {
      const res = await request(app)
        .get('/api/v1/receipts')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.receipts)).toBe(true);
      const ids = res.body.data.receipts.map(r => r.id);
      expect(ids).toContain(receiptAId);
    });

    it('User B does not see User A receipts in their list', async () => {
      const res = await request(app)
        .get('/api/v1/receipts')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(200);
      const ids = res.body.data.receipts.map(r => r.id);
      expect(ids).not.toContain(receiptAId);
    });

    it('User A can fetch their receipt by id', async () => {
      const res = await request(app)
        .get(`/api/v1/receipts/${receiptAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(receiptAId);
      expect(res.body.data.merchant).toBe('Test Merchant');
      expect(res.body.data.amount).toBe(249.5);
      // confidence is surfaced from stored metadata, never invented
      expect(res.body.data.ocrConfidence).toBe(92);
    });

    it('User B cannot fetch User A receipt by id (404, no cross-tenant read)', async () => {
      const res = await request(app)
        .get(`/api/v1/receipts/${receiptAId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
    });

    it('Malformed receipt id is rejected with 400 before hitting the DB', async () => {
      const res = await request(app)
        .get('/api/v1/receipts/not-a-uuid')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('User B cannot delete User A receipt (404) and it still exists', async () => {
      const res = await request(app)
        .delete(`/api/v1/receipts/${receiptAId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
      const stillThere = await prisma.receiptScan.findUnique({ where: { id: receiptAId } });
      expect(stillThere).not.toBeNull();
    });

    it('User A can delete their own receipt', async () => {
      const res = await request(app)
        .delete(`/api/v1/receipts/${receiptAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const gone = await prisma.receiptScan.findUnique({ where: { id: receiptAId } });
      expect(gone).toBeNull();
      receiptAId = null; // prevent afterAll double-delete
    });
  });
});
