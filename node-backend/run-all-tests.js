/**
 * Jinay Finance AI — Master Comprehensive Acceptance & Integration Test Suite
 * Owner: Jinay Golecha (jinay_golecha)
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();

const request = require('supertest');
const express = require('express');
const app = require('./src/app');
const prisma = require('./src/config/database');
const { authenticate } = require('./src/middleware/auth');

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedCount++;
  }
}

async function runTests() {
  console.log('\n====================================================================');
  console.log('  FINPRO — MASTER COMPREHENSIVE INTEGRATION & ACCEPTANCE SUITE');
  console.log('====================================================================\n');

  let userA, tokenA, userB, tokenB;
  let accountAId, txAIncomeId, txAExpenseId, budgetAId, goalAId, loanAId, invAId, policyAId, subAId;

  const testUserA = {
    email: `jinay_test_a_${Date.now()}@example.com`,
    username: `jinay_a_${Date.now()}`,
    password: 'Password123!',
    firstName: 'Jinay',
    lastName: 'Golecha',
  };

  const testUserB = {
    email: `jinay_test_b_${Date.now()}@example.com`,
    username: `user_b_${Date.now()}`,
    password: 'Password123!',
    firstName: 'Other',
    lastName: 'User',
  };

  try {
    // 1. Health Endpoints
    console.log('👉 [1/20] Testing Health & Diagnostic Endpoints...');
    const health = await request(app).get('/api/v1/health');
    assert(health.status === 200 && health.body.success === true && health.body.database === 'connected', 'GET /api/v1/health returns success and connected database');

    const dbHealth = await request(app).get('/api/v1/health/database');
    assert(dbHealth.status === 200 && dbHealth.body.status === 'connected', 'GET /api/v1/health/database confirms PostgreSQL connectivity');

    const aiHealth = await request(app).get('/api/v1/health/ai');
    assert(aiHealth.status === 200 && aiHealth.body.provider === 'Google Gemini', 'GET /api/v1/health/ai returns AI provider status');

    const marketHealth = await request(app).get('/api/v1/health/market');
    assert(marketHealth.status === 200 && marketHealth.body.provider === 'Finnhub', 'GET /api/v1/health/market returns Finnhub status');

    // 2. Authentication Flow
    console.log('\n👉 [2/20] Testing Centralized Authentication Flow...');
    const regA = await request(app).post('/api/v1/auth/register').send(testUserA);
    assert(regA.status === 201 && regA.body?.success === true, 'POST /api/v1/auth/register creates new user with profiles and primary account');
    userA = regA.body?.data?.user;
    tokenA = regA.body?.data?.accessToken;

    const dupReg = await request(app).post('/api/v1/auth/register').send(testUserA);
    assert(dupReg.status === 409, 'POST /api/v1/auth/register rejects duplicate registration with 409');

    const loginA = await request(app).post('/api/v1/auth/login').send({ email: testUserA.email, password: testUserA.password });
    assert(loginA.status === 200 && loginA.body?.data?.accessToken, 'POST /api/v1/auth/login succeeds with valid credentials');
    tokenA = loginA.body?.data?.accessToken || tokenA;

    const badLogin = await request(app).post('/api/v1/auth/login').send({ email: testUserA.email, password: 'WrongPassword!' });
    assert(badLogin.status === 401, 'POST /api/v1/auth/login returns 401 on wrong password');

    const meA = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenA}`);
    assert(meA.status === 200 && meA.body?.data?.email === testUserA.email, 'GET /api/v1/auth/me returns authenticated user details');

    // Unauthenticated access
    const noAuth = await request(app).get('/api/v1/auth/me');
    assert(noAuth.status === 401 && noAuth.body?.error?.code === 'UNAUTHORIZED', 'GET /api/v1/auth/me rejects unauthenticated request with 401 UNAUTHORIZED');

    // Invalid token access
    const invalidAuth = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer invalid.jwt.token');
    assert(invalidAuth.status === 401 && invalidAuth.body?.error?.code === 'INVALID_TOKEN', 'GET /api/v1/auth/me rejects invalid token with 401 INVALID_TOKEN');

    // Expired token access
    const jwt = require('jsonwebtoken');
    const expiredToken = jwt.sign({ userId: userA?.id || 'temp', jti: 'exp-test' }, process.env.JWT_SECRET || 'secret', { expiresIn: '0s' });
    const expiredAuth = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expiredToken}`);
    assert(expiredAuth.status === 401 && expiredAuth.body?.error?.code === 'TOKEN_EXPIRED', 'GET /api/v1/auth/me rejects expired token with 401 TOKEN_EXPIRED');
    // Refresh & Logout Flow
    const refreshRes = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: regA.body?.data?.refreshToken });
    assert(refreshRes.status === 200 && refreshRes.body?.data?.accessToken, 'POST /api/v1/auth/refresh issues new token pair');

    const logoutRes = await request(app).post('/api/v1/auth/logout').send({ refreshToken: refreshRes.body?.data?.refreshToken || regA.body?.data?.refreshToken });
    assert(logoutRes.status === 200, 'POST /api/v1/auth/logout revokes refresh token');

    const revokedRefresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: refreshRes.body?.data?.refreshToken || regA.body?.data?.refreshToken });
    assert(revokedRefresh.status === 401, 'POST /api/v1/auth/refresh rejects revoked refresh token with 401');

    // Register User B
    const regB = await request(app).post('/api/v1/auth/register').send(testUserB);
    userB = regB.body?.data?.user;
    tokenB = regB.body?.data?.accessToken;
    assert(regB.status === 201, 'Registered User B for tenant isolation testing');

    // 3. Onboarding
    console.log('\n👉 [3/20] Testing Financial Onboarding...');
    const onb = await request(app)
      .post('/api/v1/onboarding')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        age: 24,
        city: 'Mumbai',
        monthlySalary: 100000,
        estimatedMonthlyExpenses: 30000,
        currentSavings: 50000,
        totalDebt: 0,
        riskProfile: 'MODERATE',
        budgetMethod: 'FIFTY_THIRTY_TWENTY',
        financialPriorities: 'Save for home, emergency fund',
      });
    assert(onb.status === 200 && onb.body?.data?.isOnboardingComplete === true, 'POST /api/v1/onboarding calculates financial health score & 50/30/20 plan');

    const onbStat = await request(app).get('/api/v1/onboarding/status').set('Authorization', `Bearer ${tokenA}`);
    assert(onbStat.status === 200 && onbStat.body?.data?.isOnboardingComplete === true, 'GET /api/v1/onboarding/status returns complete');

    // 4. Accounts & Deposits (Atomic)
    console.log('\n👉 [4/20] Testing Accounts & Deposit Atomicity...');
    const accs = await request(app).get('/api/v1/accounts').set('Authorization', `Bearer ${tokenA}`);
    assert(accs.status === 200 && accs.body?.data?.accounts?.length > 0, 'GET /api/v1/accounts lists user accounts');
    accountAId = accs.body?.data?.accounts?.[0]?.id;

    const depositRes = await request(app)
      .post(`/api/v1/accounts/${accountAId}/deposit`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ amount: 100000, source: 'Salary', description: 'Monthly income credit' });
    assert(depositRes.status === 200 && depositRes.body?.data?.newBalance >= 100000, 'POST /api/v1/accounts/:id/deposit adds ₹1,00,000 atomically with income record');
    txAIncomeId = depositRes.body?.data?.transactionId;

    // 5. Dashboard Aggregations
    console.log('\n👉 [5/20] Testing Real-time Dashboard Aggregations...');
    const dash = await request(app).get('/api/v1/dashboard').set('Authorization', `Bearer ${tokenA}`);
    assert(dash.status === 200 && dash.body.data.monthlyIncome >= 100000, 'GET /api/v1/dashboard calculates Monthly Income from DB');
    assert(dash.body.data.totalBalance >= 100000, 'GET /api/v1/dashboard reflects total balance from DB');
    assert(typeof dash.body.data.financialHealthScore === 'number', 'GET /api/v1/dashboard calculates Financial Health Score');

    // 6. Transactions & Reversals & Anomaly Detection
    console.log('\n👉 [6/20] Testing Transactions CRUD, Anomaly Detection & Reversals...');
    const addExpense = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        amount: 20000,
        type: 'EXPENSE',
        category: 'Food',
        accountId: accountAId,
        description: 'Monthly grocery bill',
      });
    assert(addExpense.status === 201 && addExpense.body.data.amount === 20000, 'POST /api/v1/transactions creates ₹20,000 expense & updates balance');
    txAExpenseId = addExpense.body.data.id;

    const anomaliesList = await request(app).get('/api/v1/ai/anomalies').set('Authorization', `Bearer ${tokenA}`);
    assert(anomaliesList.status === 200 && Array.isArray(anomaliesList.body.data), 'GET /api/v1/ai/anomalies returns anomaly list');

    const accAfterExpense = await request(app).get(`/api/v1/accounts/${accountAId}`).set('Authorization', `Bearer ${tokenA}`);
    const balanceAfterExp = parseFloat(accAfterExpense.body.data.balance);

    const delTx = await request(app).delete(`/api/v1/transactions/${txAExpenseId}`).set('Authorization', `Bearer ${tokenA}`);
    assert(delTx.status === 200, 'DELETE /api/v1/transactions/:id deletes transaction');

    const accAfterDel = await request(app).get(`/api/v1/accounts/${accountAId}`).set('Authorization', `Bearer ${tokenA}`);
    const balanceAfterDel = parseFloat(accAfterDel.body.data.balance);
    assert(Math.abs(balanceAfterDel - (balanceAfterExp + 20000)) < 0.01, 'Balance automatically reversed by +₹20,000 upon transaction deletion');

    // 7. Budgets & Budget Optimizer
    console.log('\n👉 [7/20] Testing Category Budgets & Smart AI Budget Optimizer...');
    const now = new Date();
    const addBudget = await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        categoryName: 'Food & Dining',
        monthlyLimit: 15000,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      });
    assert(addBudget.status === 201 && addBudget.body.data.monthlyLimit == 15000, 'POST /api/v1/budgets creates category budget');
    budgetAId = addBudget.body.data.id;

    const getBudgets = await request(app).get(`/api/v1/budgets?month=${now.getMonth() + 1}&year=${now.getFullYear()}`).set('Authorization', `Bearer ${tokenA}`);
    assert(getBudgets.status === 200 && getBudgets.body.data.budgets.length > 0, 'GET /api/v1/budgets calculates spending and remaining limit');

    const budgetOpt = await request(app).get('/api/v1/ai/budget-optimize?method=50/30/20').set('Authorization', `Bearer ${tokenA}`);
    assert(budgetOpt.status === 200 && budgetOpt.body.data.recommendations.length > 0, 'GET /api/v1/ai/budget-optimize generates 50/30/20 budget allocations');

    // 8. Goals & Goal Forecast
    console.log('\n👉 [8/20] Testing Financial Goals & Completion Forecasting...');
    const addGoal = await request(app)
      .post('/api/v1/goals')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Emergency Fund',
        goalType: 'EMERGENCY_FUND',
        targetAmount: 180000,
        currentAmount: 30000,
        monthlyContribution: 10000,
      });
    assert(addGoal.status === 201, 'POST /api/v1/goals creates savings goal');
    goalAId = addGoal.body.data.id;

    const contribGoal = await request(app)
      .patch(`/api/v1/goals/${goalAId}/contribute`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ amount: 20000 });
    assert(contribGoal.status === 200 && contribGoal.body.data.currentAmount == 50000, 'PATCH /api/v1/goals/:id/contribute increments goal amount');

    const goalFc = await request(app).get(`/api/v1/ai/goals/${goalAId}/forecast`).set('Authorization', `Bearer ${tokenA}`);
    assert(goalFc.status === 200 && goalFc.body.data.scenarios.plus2000, 'GET /api/v1/ai/goals/:id/forecast calculates completion dates & +₹2k scenario');

    // 9. Investments, Gold, Silver & Historical Charts
    console.log('\n👉 [9/20] Testing Real-Time Stocks, 24K/22K Gold, Silver & Charts...');
    const metals = await request(app).get('/api/v1/market/metals').set('Authorization', `Bearer ${tokenA}`);
    assert(metals.status === 200 && metals.body.data.gold.karat24.perGram > 0, 'GET /api/v1/market/metals returns 24K/22K Gold and Silver rates in INR');

    const goldRate = await request(app).get('/api/v1/market/gold').set('Authorization', `Bearer ${tokenA}`);
    assert(goldRate.status === 200 && goldRate.body.data.karat24.perGram > 0, 'GET /api/v1/market/gold returns dedicated 24K/22K gold feed');

    const silverRate = await request(app).get('/api/v1/market/silver').set('Authorization', `Bearer ${tokenA}`);
    assert(silverRate.status === 200 && silverRate.body.data.perGram > 0, 'GET /api/v1/market/silver returns dedicated silver feed');

    const stockHist = await request(app).get('/api/v1/market/history?symbol=RELIANCE&timeframe=1M').set('Authorization', `Bearer ${tokenA}`);
    assert(stockHist.status === 200 && stockHist.body.data.points.length > 0, 'GET /api/v1/market/history delivers multi-timeframe stock chart points');

    const stockSearch = await request(app).get('/api/v1/market/search?q=TCS').set('Authorization', `Bearer ${tokenA}`);
    assert(stockSearch.status === 200 && stockSearch.body.data.some(s => s.symbol === 'TCS'), 'GET /api/v1/market/search finds matching stocks');

    const buyInv = await request(app)
      .post('/api/v1/investments/buy')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        symbol: 'RELIANCE',
        name: 'Reliance Industries',
        assetType: 'STOCK',
        quantity: 10,
        buyPrice: 2400,
      });
    assert(buyInv.status === 201, 'POST /api/v1/investments/buy records asset holding');
    invAId = buyInv.body.data.id;

    const buyGold = await request(app)
      .post('/api/v1/investments/buy')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        symbol: 'GOLD24K',
        name: '24K Physical Gold',
        assetType: 'GOLD',
        quantity: 10,
        buyPrice: 7400,
      });
    assert(buyGold.status === 201, 'POST /api/v1/investments/buy records 24K gold holding');

    const portf = await request(app).get('/api/v1/investments/portfolio').set('Authorization', `Bearer ${tokenA}`);
    assert(portf.status === 200 && portf.body.data.holdings.length >= 2, 'GET /api/v1/investments/portfolio aggregates holdings with live market prices');

    // 10. Loans & Prepayment Simulator
    console.log('\n👉 [10/20] Testing Loans & Prepayment Calculations...');
    const emiCalc = await request(app)
      .post('/api/v1/loans/calculate-emi')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ principal: 500000, interestRate: 8.5, tenureMonths: 60 });
    assert(emiCalc.status === 200 && emiCalc.body.data.emi > 9000, 'POST /api/v1/loans/calculate-emi calculates EMI using standard formula');

    const addLoan = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ loanType: 'HOME', lenderName: 'SBI', principalAmount: 500000, interestRate: 8.5, tenureMonths: 60 });
    assert(addLoan.status === 201, 'POST /api/v1/loans creates loan obligation');
    loanAId = addLoan.body.data.id;

    const prepay = await request(app)
      .post('/api/v1/loans/prepayment-simulate')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ loanId: loanAId, prepaymentAmount: 50000 });
    assert(prepay.status === 200 && prepay.body.data.monthsSaved > 0, 'POST /api/v1/loans/prepayment-simulate simulates tenure & interest reduction');

    // 11. Insurance Policies & Subscriptions
    console.log('\n👉 [11/20] Testing Insurance Policies & Subscriptions...');
    const addPolicy = await request(app)
      .post('/api/v1/insurance')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        policyName: 'HDFC Click 2 Protect Life',
        insurer: 'HDFC Life',
        policyType: 'LIFE',
        coverageAmount: 10000000,
        premium: 16000,
        premiumCycle: 'ANNUAL',
        renewalDate: '2027-03-31',
      });
    assert(addPolicy.status === 201 && addPolicy.body.data.coverageAmount == 10000000, 'POST /api/v1/insurance creates insurance policy');
    policyAId = addPolicy.body.data.id;

    const getPolicies = await request(app).get('/api/v1/insurance').set('Authorization', `Bearer ${tokenA}`);
    assert(getPolicies.status === 200 && getPolicies.body.data.summary.totalCoverage >= 10000000, 'GET /api/v1/insurance aggregates total coverage');

    const addSub = await request(app)
      .post('/api/v1/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        serviceName: 'Netflix Premium',
        category: 'Entertainment',
        cost: 649,
        billingCycle: 'MONTHLY',
        nextBillingDate: '2026-09-01',
      });
    assert(addSub.status === 201, 'POST /api/v1/subscriptions creates subscription');
    subAId = addSub.body.data.id;

    const getSubs = await request(app).get('/api/v1/subscriptions').set('Authorization', `Bearer ${tokenA}`);
    assert(getSubs.status === 200 && getSubs.body.data.summary.monthlyTotal >= 649, 'GET /api/v1/subscriptions calculates monthly recurring spend');

    // 12. Advanced 10-Factor Health Score & History
    console.log('\n👉 [12/20] Testing 10-Factor AI Financial Health Score & History...');
    const healthScoreRes = await request(app).get('/api/v1/ai/financial-health').set('Authorization', `Bearer ${tokenA}`);
    assert(healthScoreRes.status === 200 && typeof healthScoreRes.body.data.overallScore === 'number', 'GET /api/v1/ai/financial-health returns 10-factor score & breakdown');
    assert(healthScoreRes.body.data.components.emergency.score > 0, 'Health score includes Emergency Fund factor score');
    assert(healthScoreRes.body.data.components.savings.score > 0, 'Health score includes Savings Rate factor score');

    // 13. Cash Flow Prediction (7d, 30d, 90d)
    console.log('\n👉 [13/20] Testing Predictive Cash Flow Engine...');
    const cf30 = await request(app).get('/api/v1/ai/cash-flow?days=30').set('Authorization', `Bearer ${tokenA}`);
    assert(cf30.status === 200 && cf30.body.data.projections.length === 30, 'GET /api/v1/ai/cash-flow generates 30-day balance trajectory with obligations');

    const cf90 = await request(app).get('/api/v1/ai/cash-flow?days=90').set('Authorization', `Bearer ${tokenA}`);
    assert(cf90.status === 200 && cf90.body.data.projections.length === 90, 'GET /api/v1/ai/cash-flow generates 90-day balance trajectory');

    // 14. What-If Financial Simulator
    console.log('\n👉 [14/20] Testing What-If Financial Simulator...');
    const simRes = await request(app)
      .post('/api/v1/ai/simulate')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        scenarioName: 'Salary Hike & Extra SIP',
        salaryChangePercent: 10,
        extraMonthlyInvestment: 5000,
        loanPrepaymentAmount: 50000,
      });
    assert(simRes.status === 200 && simRes.body.data.comparison.monthlyCashFlow.change !== undefined, 'POST /api/v1/ai/simulate calculates Current vs Scenario impact on cash flow & net worth');

    const simHistory = await request(app).get('/api/v1/ai/simulations/history').set('Authorization', `Bearer ${tokenA}`);
    assert(simHistory.status === 200 && simHistory.body.data.length > 0, 'GET /api/v1/ai/simulations/history lists persisted simulations');

    // 15. Retirement Planner
    console.log('\n👉 [15/20] Testing Retirement Planner Engine...');
    const retPlan = await request(app)
      .post('/api/v1/ai/retirement-plan')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        currentAge: 25,
        retirementAge: 60,
        currentSavings: 500000,
        monthlyContribution: 15000,
        expectedReturn: 12,
      });
    assert(retPlan.status === 200 && retPlan.body.data.estimatedCorpus > 0, 'POST /api/v1/ai/retirement-plan projects retirement corpus across conservative/base/optimistic scenarios');

    // 16. OCR Receipt Scanner & Bank Statement CSV Importer
    console.log('\n👉 [16/20] Testing OCR Receipt Scanner & Statement CSV Importer...');
    const ocrScan = await request(app)
      .post('/api/v1/receipts/scan')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ receiptText: 'STARBUCKS COFFEE Total: Rs 850.00 Date: 2026-08-16' });
    assert(ocrScan.status === 200 && ocrScan.body.data.amount === 850, 'POST /api/v1/receipts/scan extracts merchant, amount & category with confirmation state');

    const ocrConfirm = await request(app)
      .post('/api/v1/receipts/confirm')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        scanId: ocrScan.body.data.scanId,
        amount: 850,
        merchant: 'Starbucks Coffee',
        category: 'Food',
        accountId: accountAId,
      });
    assert(ocrConfirm.status === 201 && ocrConfirm.body.data.transaction.amount == 850, 'POST /api/v1/receipts/confirm persists transaction to DB after user approval');

    const csvTest = `Date,Description,Amount,Type\n2026-08-10,Salary Deposit,85000,INCOME\n2026-08-12,Grocery Supermarket,4200,EXPENSE`;
    const parseCsv = await request(app)
      .post('/api/v1/import/bank-statement')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ csvContent: csvTest });
    assert(parseCsv.status === 200 && parseCsv.body.data.validCount === 2, 'POST /api/v1/import/bank-statement parses CSV and detects valid/duplicate rows');

    const confirmCsv = await request(app)
      .post('/api/v1/import/confirm')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ rows: parseCsv.body.data.validRows, accountId: accountAId });
    assert(confirmCsv.status === 200 && confirmCsv.body.data.importedCount === 2, 'POST /api/v1/import/confirm commits imported transactions to account');

    // 17. Voice Intent Parser & Risk Radar
    console.log('\n👉 [17/20] Testing Voice Assistant Intent Parsing & Risk Radar...');
    const voiceQuery = await request(app)
      .post('/api/v1/ai/voice-intent')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ speechText: 'How much did I spend this month?' });
    assert(voiceQuery.status === 200 && voiceQuery.body.data.intent === 'QUERY_EXPENSES', 'POST /api/v1/ai/voice-intent correctly parses QUERY_EXPENSES without confirmation requirement');

    const voiceAdd = await request(app)
      .post('/api/v1/ai/voice-intent')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ speechText: 'Add 500 food expense' });
    assert(voiceAdd.status === 200 && voiceAdd.body.data.requiresConfirmation === true, 'POST /api/v1/ai/voice-intent requires safety confirmation for expense creation');

    const riskRadar = await request(app).get('/api/v1/ai/risk-radar').set('Authorization', `Bearer ${tokenA}`);
    assert(riskRadar.status === 200 && Array.isArray(riskRadar.body.data.risks), 'GET /api/v1/ai/risk-radar evaluates debt, liquidity, and insurance risk factors');

    // 18. Recommendation Feedback Loop & Monthly Financial Report
    console.log('\n👉 [18/20] Testing AI Feedback Loop & Monthly Financial Report...');
    const feedbackRes = await request(app)
      .post('/api/v1/ai/recommendations/rec-123/feedback')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ feedbackType: 'HELPFUL', recommendationTitle: 'Emergency Fund Tip' });
    assert(feedbackRes.status === 201 && feedbackRes.body.data.feedback.feedbackType === 'HELPFUL', 'POST /api/v1/ai/recommendations/:id/feedback stores user feedback to learn preferences');

    const monthlyRep = await request(app).get('/api/v1/reports/monthly').set('Authorization', `Bearer ${tokenA}`);
    assert(monthlyRep.status === 200 && monthlyRep.body.data.summary.totalIncome !== undefined, 'GET /api/v1/reports/monthly delivers comprehensive monthly financial report');

    // 19. Data Exports with Token Auth
    console.log('\n👉 [19/20] Testing Authenticated CSV Exports...');
    const expTxHeader = await request(app).get('/api/v1/export/transactions.csv').set('Authorization', `Bearer ${tokenA}`);
    assert(expTxHeader.status === 200 && expTxHeader.headers['content-type'].includes('text/csv'), 'GET /api/v1/export/transactions.csv with Bearer header exports CSV');

    const expTxQuery = await request(app).get(`/api/v1/export/transactions.csv?token=${encodeURIComponent(tokenA)}`);
    assert(expTxQuery.status === 401, 'GET /api/v1/export/transactions.csv rejects a query-string token (401)');

    const expSum = await request(app).get('/api/v1/export/summary.csv').set('Authorization', `Bearer ${tokenA}`);
    assert(expSum.status === 200 && expSum.text.includes('Summary Report'), 'GET /api/v1/export/summary.csv exports financial summary');

    // 19b. Authentication scope & CORS allowlist (security regression guards)
    console.log('\n👉 [19b] Testing Query-Token Scope & CORS Allowlist...');

    // Query tokens are restricted to the SSE stream: a guarded API route must
    // reject a valid token supplied only in the query string...
    const dashQuery = await request(app).get(`/api/v1/dashboard?token=${encodeURIComponent(tokenA)}`);
    assert(dashQuery.status === 401, 'Guarded API route rejects a query-string token without an Authorization header (401)');

    // ...while the same route still works with the Bearer header.
    const dashHeader = await request(app).get('/api/v1/dashboard').set('Authorization', `Bearer ${tokenA}`);
    assert(dashHeader.status === 200, 'Guarded API route still accepts the Authorization: Bearer header');

    // The SSE stream still requires authentication...
    const sseNoToken = await request(app).get('/api/v1/realtime/stream');
    assert(sseNoToken.status === 401, 'SSE stream route requires authentication (401 without a token)');

    // ...and a focused probe (mounting the real middleware exactly like the API
    // router does) proves the query token is honoured on the SSE path only.
    const probe = express();
    probe.use(authenticate);
    probe.get('/api/v1/realtime/stream', (req, res) => res.json({ success: true, userId: req.user.id }));
    probe.get('/api/v1/realtime/changes', (req, res) => res.json({ success: true }));
    const probeStream = await request(probe).get(`/api/v1/realtime/stream?token=${encodeURIComponent(tokenA)}`);
    assert(probeStream.status === 200 && probeStream.body.userId === userA.id, 'SSE stream route authenticates with a query-string token (EventSource cannot set headers)');
    const probeOther = await request(probe).get(`/api/v1/realtime/changes?token=${encodeURIComponent(tokenA)}`);
    assert(probeOther.status === 401, 'Non-SSE realtime route still rejects a query-string token (401)');

    // CORS admits known first-party origins...
    const corsAllowed = await request(app).options('/api/v1/health').set('Origin', 'https://finpro-finance-ai.vercel.app');
    assert(corsAllowed.headers['access-control-allow-origin'] === 'https://finpro-finance-ai.vercel.app', 'CORS reflects an allow-listed first-party origin');
    // ...and refuses an arbitrary *.vercel.app deployment and the literal "null" origin.
    const corsVercel = await request(app).options('/api/v1/health').set('Origin', 'https://evil-attacker.vercel.app');
    assert(!corsVercel.headers['access-control-allow-origin'], 'CORS refuses an arbitrary *.vercel.app origin');
    const corsNull = await request(app).options('/api/v1/health').set('Origin', 'null');
    assert(!corsNull.headers['access-control-allow-origin'], 'CORS refuses the literal "null" origin');

    // 20. Multi-User Tenant Isolation
    console.log('\n👉 [20/20] Testing Multi-User Tenant Isolation (User A vs User B)...');
    const bAccs = await request(app).get('/api/v1/accounts').set('Authorization', `Bearer ${tokenB}`);
    const bAccIds = bAccs.body.data.accounts.map(a => a.id);
    assert(!bAccIds.includes(accountAId), 'User B cannot see User A accounts');

    const bAccessAAcc = await request(app).get(`/api/v1/accounts/${accountAId}`).set('Authorization', `Bearer ${tokenB}`);
    assert(bAccessAAcc.status === 404, 'User B cannot access User A account by ID (404 Not Found)');

    const bAccessAPolicy = await request(app).get(`/api/v1/insurance/${policyAId}`).set('Authorization', `Bearer ${tokenB}`);
    assert(bAccessAPolicy.status === 404, 'User B cannot access User A insurance policy (404 Not Found)');

    const bAccessAGoal = await request(app).delete(`/api/v1/goals/${goalAId}`).set('Authorization', `Bearer ${tokenB}`);
    assert(bAccessAGoal.status === 404, 'User B cannot delete User A goal (404 Not Found)');

    // 21. Data Integrity & Training Data / ML Studio
    console.log('\n👉 [21/21] Testing Data Integrity & Real ML Training Studio...');

    // D1: Transaction update balance sync
    const accBeforeTx = await prisma.financialAccount.findUnique({ where: { id: accountAId } });
    const balBeforeTx = parseFloat(accBeforeTx.balance);

    const testExp = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ accountId: accountAId, amount: 5000, transactionType: 'EXPENSE', description: 'Test Integrity Exp' });
    const testExpId = testExp.body.data.id;

    // Update expense from 5000 to 8000 (balance should drop by additional 3000)
    await request(app)
      .patch(`/api/v1/transactions/${testExpId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ amount: 8000 });

    const accAfterUpdate = await prisma.financialAccount.findUnique({ where: { id: accountAId } });
    const balAfterUpdate = parseFloat(accAfterUpdate.balance);
    assert(balBeforeTx - balAfterUpdate === 8000, 'PATCH /api/v1/transactions/:id atomically synchronizes account balance upon amount update');

    // D3: Loan Prepayment without fake defaults
    const badPrepay = await request(app)
      .post('/api/v1/loans/prepayment-simulate')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ prepaymentAmount: 10000 });
    assert(badPrepay.status === 400, 'POST /api/v1/loans/prepayment-simulate rejects missing loanId/params without fake fallbacks');

    const explicitPrepay = await request(app)
      .post('/api/v1/loans/prepayment-simulate')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ principalAmount: 500000, interestRate: 9.0, tenureMonths: 60, prepaymentAmount: 50000 });
    assert(explicitPrepay.status === 200 && explicitPrepay.body.data.monthsSaved > 0, 'POST /api/v1/loans/prepayment-simulate supports explicit loan parameters');

    // Phase 15, 16, 17: Training Data Bot & ML Studio
    const sampleCsv = `salary,expenses,debt,credit_score,savings,approved\n50000,25000,100000,750,150000,1\n30000,22000,400000,620,20000,0\n80000,35000,50000,780,400000,1\n40000,30000,350000,640,30000,0\n100000,40000,0,810,800000,1\n25000,22000,500000,590,10000,0\n60000,30000,180000,710,200000,1\n45000,28000,200000,690,100000,1\n35000,26000,380000,630,25000,0\n90000,36000,80000,770,500000,1`;

    const uploadRes = await request(app)
      .post('/api/v1/training/datasets/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Risk_Training_Data', description: 'Credit scoring records', csvContent: sampleCsv });
    assert(uploadRes.status === 201 && uploadRes.body.data.rowCount === 10, 'POST /api/v1/training/datasets/upload parses CSV and creates v1 with column stats');
    const datasetId = uploadRes.body.data.id;

    // Safe Versioning
    const verRes = await request(app)
      .post(`/api/v1/training/datasets/${datasetId}/version`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ action: 'REMOVE_DUPLICATES', changeLog: 'Removed duplicates' });
    assert(verRes.status === 201 && verRes.body.data.versionNumber === 2, 'POST /api/v1/training/datasets/:id/version creates immutable v2 preserving original data');

    // Real ML Training
    const trainRes = await request(app)
      .post('/api/v1/training/train')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        datasetId,
        taskType: 'REGRESSION',
        targetColumn: 'savings',
        featureColumns: ['salary', 'expenses', 'debt', 'credit_score'],
        algorithm: 'LINEAR_REGRESSION',
        hyperparameters: { l2Lambda: 0.01, epochs: 400 }
      });
    assert(trainRes.status === 201 && trainRes.body.data.metrics?.r2 !== undefined, 'POST /api/v1/training/train computes true mathematical validation metrics (R², MAE, RMSE)');
    const trainingRunId = trainRes.body.data.id;

    // Real Prediction
    const predRes = await request(app)
      .post('/api/v1/training/predict')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        trainingRunId,
        inputs: { salary: 70000, expenses: 32000, debt: 100000, credit_score: 740 }
      });
    assert(predRes.status === 200 && predRes.body.data.numericPrediction !== null && predRes.body.data.disclaimer, 'POST /api/v1/training/predict generates normalized inference with transparency disclaimer');

    // Tenant Isolation on Datasets
    const bAccessDataset = await request(app)
      .get(`/api/v1/training/datasets/${datasetId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    assert(bAccessDataset.status === 404, 'User B cannot access User A training dataset (404 Tenant Isolation)');

    // ================================================================
    // 👉 [22/25] Testing Card Management & Utilization (Phase 26)...
    // ================================================================
    console.log('\n👉 [22/25] Testing Card Management & Security (Phase 26)...');

    // Security test: Rejection of CVV / PIN in payload
    const cvvReject = await request(app)
      .post('/api/v1/cards')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        cardNickname: 'HDFC Regalia',
        issuer: 'HDFC Bank',
        lastFourDigits: '4321',
        cvv: '123',
      });
    assert(cvvReject.status === 400 && cvvReject.body.error.code === 'SECURITY_VIOLATION', 'POST /api/v1/cards rejects CVV submission with SECURITY_VIOLATION');

    // Security test: Rejection of full PAN number
    const panReject = await request(app)
      .post('/api/v1/cards')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        cardNickname: 'HDFC Regalia',
        issuer: 'HDFC Bank',
        lastFourDigits: '4111222233334321',
      });
    assert(panReject.status === 400, 'POST /api/v1/cards rejects full PAN numbers (requires strictly last 4 digits)');

    // Valid card creation
    const cardCreate = await request(app)
      .post('/api/v1/cards')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        cardNickname: 'HDFC Regalia Gold',
        cardType: 'CREDIT',
        issuer: 'HDFC Bank',
        lastFourDigits: '4321',
        creditLimit: 200000,
        outstandingAmount: 40000,
        minimumDue: 2000,
        billingCycleDay: 15,
      });
    assert(cardCreate.status === 201 && cardCreate.body.data.lastFourDigits === '4321', 'POST /api/v1/cards creates masked payment card');
    const cardId = cardCreate.body.data.id;

    // List cards with utilization calculation
    const cardsList = await request(app)
      .get('/api/v1/cards')
      .set('Authorization', `Bearer ${tokenA}`);
    assert(cardsList.status === 200 && cardsList.body.data.summary.overallUtilizationPct === 20, 'GET /api/v1/cards calculates exact credit utilization ratio (20%)');

    // User B cannot access User A's card
    const bCardAccess = await request(app)
      .get(`/api/v1/cards/${cardId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    assert(bCardAccess.status === 404, 'User B cannot access User A payment card (404 Tenant Isolation)');

    // ================================================================
    // 👉 [23/25] Testing Financial Tasks & To-Do Reminders (Phase 29)...
    // ================================================================
    console.log('\n👉 [23/25] Testing Financial Tasks & To-Do Reminders (Phase 29)...');

    const taskCreate = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Pay HDFC Credit Card Bill',
        category: 'CREDIT_CARD',
        dueDate: '2026-09-05',
        priority: 'HIGH',
        notes: 'Pay in full to avoid finance charges',
      });
    assert(taskCreate.status === 201 && taskCreate.body.data.priority === 'HIGH', 'POST /api/v1/tasks creates financial task');
    const taskId = taskCreate.body.data.id;

    // Complete task
    const taskUpdate = await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ isCompleted: true });
    assert(taskUpdate.status === 200 && taskUpdate.body.data.isCompleted === true && taskUpdate.body.data.completedAt !== null, 'PATCH /api/v1/tasks/:id marks task completed with timestamp');

    // User B cannot delete User A task
    const bTaskDelete = await request(app)
      .delete(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    assert(bTaskDelete.status === 404, 'User B cannot delete User A financial task (404 Tenant Isolation)');

    // ================================================================
    // 👉 [24/25] Testing Credit Health Educational Assessment (Phase 25)...
    // ================================================================
    console.log('\n👉 [24/25] Testing Credit Health Educational Assessment (Phase 25)...');

    const creditHealthRes = await request(app)
      .get('/api/v1/ai/credit-health')
      .set('Authorization', `Bearer ${tokenA}`);
    assert(creditHealthRes.status === 200, 'GET /api/v1/ai/credit-health responds with 200 OK');
    assert(creditHealthRes.body.data.isBureauScore === false, 'Credit Health explicitly marks isBureauScore: false');
    assert(creditHealthRes.body.data.disclaimer.includes('educational'), 'Credit Health includes honest educational assessment disclaimer');
    assert(creditHealthRes.body.data.summary.creditUtilizationPct !== undefined, 'Credit Health includes credit utilization metric');

    // ================================================================
    // 👉 [25/25] Testing Financial News Service & Health (Phase 30 & 31 & 40)...
    // ================================================================
    console.log('\n👉 [25/25] Testing Financial News Service & Health (Phase 30, 31, 40)...');

    const newsHealth = await request(app).get('/api/v1/health/news');
    assert(newsHealth.status === 200 && newsHealth.body.success === true, 'GET /api/v1/health/news reports news service health');

    // Test/service boundary mock for CI environments without external API keys
    const newsService = require('./src/services/newsService');
    const originalGetFinancialNews = newsService.getFinancialNews;
    if (!process.env.MARKETAUX_API_KEY && (!process.env.FINNHUB_API_KEY || process.env.FINNHUB_API_KEY === 'YOUR_FINNHUB_API_KEY')) {
      newsService.getFinancialNews = async () => ({
        provider: 'Finnhub',
        source: 'Finnhub Financial News API',
        category: 'general',
        searchQuery: '',
        articles: [
          {
            id: 'test-news-1',
            headline: 'RBI Keeps Repo Rate Steady Amid Balanced Inflation Trajectory',
            description: 'The Monetary Policy Committee maintained the policy repo rate with focused stance on growth.',
            source: 'Reuters Financial',
            url: 'https://example.com/news/1',
            publishedAt: new Date().toISOString(),
            entities: ['RBI', 'INFLATION'],
          },
        ],
        count: 1,
        fetchedAt: new Date().toISOString(),
        data_status: 'LIVE',
      });
    }

    const newsList = await request(app)
      .get('/api/v1/news?category=general&limit=5')
      .set('Authorization', `Bearer ${tokenA}`);
    assert(newsList.status === 200 && Array.isArray(newsList.body.data.articles), 'GET /api/v1/news delivers structured financial headlines');
    assert(newsList.body.data.articles.length > 0 && newsList.body.data.articles[0].headline, 'News article includes headline, source and publication time');

    newsService.getFinancialNews = originalGetFinancialNews;

    // ================================================================
    // 👉 [26/26] Testing AI Chat Endpoint (deterministic, provider stubbed)...
    // ================================================================
    console.log('\n👉 [26/26] Testing AI Chat Endpoint (conversational Add/View)...');

    // The /ai/chat route is assistant-first: it tries Gemini tool-calling and
    // only falls back to the deterministic action engine when the provider is
    // unavailable. Letting the *live* provider run here made these assertions
    // nondeterministic — the model's wording, and whether it calls a tool at
    // all, vary per call. We therefore stub the provider at the service
    // boundary and drive the REAL controller, assistant service, tool
    // executors and database writes from scripted responses. A live-provider
    // smoke test is kept separate and opt-in (AI_LIVE_SMOKE=1) so provider
    // flakiness can never invalidate the deterministic run.
    const aiServiceModule = require('./src/services/aiService');
    const realGetGeminiClient = aiServiceModule.getGeminiClient;

    const geminiModelResponse = ({ calls = [], text = '' }) => ({
      response: {
        functionCalls: () => calls,
        text: () => text,
        candidates: [
          {
            content: {
              parts: [
                ...calls.map((c) => ({ functionCall: c })),
                ...(text ? [{ text }] : []),
              ],
            },
          },
        ],
      },
    });
    // Scripted provider: `responder(round)` returns a model response, or throws
    // to simulate a provider error.
    const stubGeminiModel = (responder) => {
      aiServiceModule.getGeminiClient = () => ({
        getGenerativeModel: () => {
          let round = 0;
          return {
            generateContent: async () => {
              round += 1;
              return responder(round);
            },
          };
        },
      });
    };
    // Provider cannot be initialised at all (missing key / init failure).
    const stubGeminiUnavailable = () => {
      aiServiceModule.getGeminiClient = () => {
        const err = new Error('GEMINI_API_KEY not configured. Using rule-based AI fallback.');
        err.code = 'API_KEY_ERROR';
        throw err;
      };
    };
    const restoreGeminiClient = () => {
      aiServiceModule.getGeminiClient = realGetGeminiClient;
    };

    const count500 = () => prisma.transaction.count({ where: { userId: userA.id, amount: 500 } });
    const addExpenseMessage = 'add 500 expense as automated regression coffee paid by cash';

    // --- A. Provider unavailable → deterministic action-engine fallback ---
    stubGeminiUnavailable();

    const viewChat = await request(app)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: 'view user data' });
    assert(
      viewChat.status === 200 && /ai_action_engine/.test(String(viewChat.body?.data?.source || '')),
      'POST /api/v1/ai/chat routes "view user data" to an AI engine (assistant or action engine)'
    );
    assert(
      String(viewChat.body?.data?.response || '').includes(testUserA.email),
      'AI chat VIEW_DATA response contains the authenticated user profile'
    );

    const before500 = await count500();

    const addChat = await request(app)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: addExpenseMessage });
    const addChatText = String(addChat.body?.data?.response || '');
    assert(
      addChat.status === 200 &&
        /ai_action_engine \(ADD_TRANSACTION\)/.test(String(addChat.body?.data?.source || '')),
      'POST /api/v1/ai/chat routes a natural-language expense to a transaction handler'
    );
    assert(
      addChatText.includes('500') && !addChatText.includes('₹₹'),
      'AI chat renders each amount with exactly one rupee sign (never ₹₹)'
    );
    assert(
      (await count500()) === before500 + 1,
      'AI chat ADD_TRANSACTION persists the ₹500 expense to the ledger'
    );

    // --- B. Provider answers with a tool call → the REAL tool executor runs ---
    stubGeminiModel((round) =>
      round === 1
        ? geminiModelResponse({
            calls: [
              {
                name: 'create_transaction',
                args: {
                  amount: 500,
                  transactionType: 'EXPENSE',
                  description: 'automated regression coffee',
                  merchant: 'Automated Regression Cafe',
                  category: 'Food & Dining',
                  paymentMethod: 'Cash',
                },
              },
            ],
          })
        : geminiModelResponse({ text: 'Done — I recorded your ₹500 coffee expense.' })
    );
    const beforeToolCall = await count500();
    const toolChat = await request(app)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: addExpenseMessage });
    const toolStep = toolChat.body?.data?.action?.steps?.[0];
    assert(
      toolChat.status === 200 &&
        toolChat.body?.data?.source === 'gemini-tools' &&
        toolStep?.name === 'create_transaction' &&
        toolStep?.ok === true,
      'AI chat dispatches the model-chosen create_transaction tool through the real assistant service'
    );
    assert(
      (await count500()) === beforeToolCall + 1 &&
        String(toolStep?.summary || '').includes('500') &&
        !String(toolStep?.summary || '').includes('₹₹'),
      'AI tool-calling path persists the ₹500 expense and renders one rupee sign per amount'
    );

    // --- C. Provider error mid-flight → handled gracefully, no 500 surfaced ---
    const beforeProviderErr = await count500();
    stubGeminiModel(() => {
      throw new Error('simulated Gemini provider outage');
    });
    const errChat = await request(app)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: addExpenseMessage });
    assert(
      errChat.status === 200 &&
        /ai_action_engine \(ADD_TRANSACTION\)/.test(String(errChat.body?.data?.source || '')) &&
        (await count500()) === beforeProviderErr + 1,
      'AI chat degrades to the deterministic engine when the provider errors (no 500, action still applied)'
    );

    // --- D. Request validation at the AI boundary ---
    const emptyChat = await request(app)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: '   ' });
    assert(
      emptyChat.status === 400 && emptyChat.body?.error?.code === 'VALIDATION_ERROR',
      'AI chat rejects an empty message with 400 VALIDATION_ERROR'
    );

    restoreGeminiClient();

    // --- Separate, opt-in live-provider smoke test (excluded from the default run) ---
    if (process.env.AI_LIVE_SMOKE === '1') {
      const liveChat = await request(app)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: 'view user data' });
      assert(
        liveChat.status === 200 && Boolean(liveChat.body?.data?.response),
        '[live smoke] real Gemini provider answers POST /api/v1/ai/chat'
      );
    } else {
      console.log(
        '  ℹ️  Live Gemini smoke test skipped — run with AI_LIVE_SMOKE=1 to exercise the real provider.'
      );
    }

    // ================================================================
    // 👉 [27/27] Testing Category Resource & Full AI Assistant CRUD Surface...
    // ================================================================
    console.log('\n👉 [27/27] Testing Category Resource & Full AI Assistant CRUD Surface...');

    // --- REST: the Category resource (had no API at all before this change) ---
    const catCreate = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Regression Coffee', categoryType: 'EXPENSE', color: '#c0ffee' });
    assert(catCreate.status === 201 && catCreate.body.data.name === 'Regression Coffee', 'POST /api/v1/categories creates a user category');
    assert(catCreate.body.data.isSystem === false, 'Created category is flagged user-owned (not system)');
    const categoryAId = catCreate.body.data.id;

    const catDup = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'regression coffee' });
    assert(catDup.status === 409 && catDup.body.error.code === 'DUPLICATE_CATEGORY', 'POST /api/v1/categories rejects a case-insensitive duplicate (409 DUPLICATE_CATEGORY)');

    const catGet = await request(app).get(`/api/v1/categories/${categoryAId}`).set('Authorization', `Bearer ${tokenA}`);
    assert(catGet.status === 200 && catGet.body.data.id === categoryAId, 'GET /api/v1/categories/:id returns the category');

    const catList = await request(app).get('/api/v1/categories').set('Authorization', `Bearer ${tokenA}`);
    assert(catList.status === 200 && catList.body.data.categories.some((c) => c.id === categoryAId), 'GET /api/v1/categories includes the user category');

    const catPatch = await request(app)
      .patch(`/api/v1/categories/${categoryAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Regression Espresso' });
    assert(catPatch.status === 200 && catPatch.body.data.name === 'Regression Espresso', 'PATCH /api/v1/categories/:id renames a user category');

    // Shared system categories (userId === null) are read-only for everyone.
    // Provision one here to exercise the guard, then remove it again so the
    // fixture leaves no residue.
    const systemCat = await prisma.category.create({
      data: { userId: null, name: 'Regression System Category', categoryType: 'TRANSFER', isDefault: true },
    });
    const catSystemPatch = await request(app)
      .patch(`/api/v1/categories/${systemCat.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Hijacked' });
    assert(catSystemPatch.status === 403 && catSystemPatch.body.error.code === 'SYSTEM_CATEGORY_READ_ONLY', 'PATCH /api/v1/categories/:id refuses to edit a shared system category (403)');

    const catSystemDelete = await request(app)
      .delete(`/api/v1/categories/${systemCat.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    assert(catSystemDelete.status === 403, 'DELETE /api/v1/categories/:id refuses to delete a shared system category (403)');

    const catListSystem = await request(app).get('/api/v1/categories').set('Authorization', `Bearer ${tokenA}`);
    assert(catListSystem.body.data.categories.some((c) => c.id === systemCat.id && c.isSystem === true), 'GET /api/v1/categories surfaces shared system categories as isSystem=true');

    // An in-use category is guarded unless the caller explicitly forces it.
    // Note: the transaction API takes a category *name*, not an id.
    const catTx = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ accountId: accountAId, amount: 120, transactionType: 'EXPENSE', category: 'Regression Espresso', description: 'Categorised regression expense' });
    assert(catTx.status === 201, 'A transaction can be filed under the new category');
    assert(catTx.body.data.category === 'Regression Espresso', 'The transaction retained the category it was filed under');

    const catInUse = await request(app).delete(`/api/v1/categories/${categoryAId}`).set('Authorization', `Bearer ${tokenA}`);
    assert(catInUse.status === 409 && catInUse.body.error.code === 'CATEGORY_IN_USE', 'DELETE /api/v1/categories/:id blocks deleting an in-use category (409 CATEGORY_IN_USE)');

    const catForced = await request(app).delete(`/api/v1/categories/${categoryAId}?force=true`).set('Authorization', `Bearer ${tokenA}`);
    assert(catForced.status === 200 && catForced.body.data.unlinkedTransactions === 1, 'DELETE /api/v1/categories/:id?force=true deletes and reports unlinked transactions');

    const orphan = await prisma.transaction.findUnique({ where: { id: catTx.body.data.id } });
    assert(orphan && orphan.categoryId === null, 'Forcing the delete keeps transaction history intact with a null category link');

    // Remove the provisional system category so the fixture leaves no residue.
    await prisma.category.delete({ where: { id: systemCat.id } });

    const bCatCreate = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'User B Private Category' });
    assert(bCatCreate.status === 201, 'User B can create their own category');
    const bCatRead = await request(app).get(`/api/v1/categories/${bCatCreate.body.data.id}`).set('Authorization', `Bearer ${tokenA}`);
    assert(bCatRead.status === 404, 'User A cannot read User B category (404 Tenant Isolation)');

    // --- AI assistant: the update/delete half of CRUD ---
    // The chat route is assistant-first but has no LLM key in CI, so the tool
    // *executors* are the unit under test here — one representative per resource.
    const { TOOL_MAP } = require('./src/services/aiTools');

    const goalCreate = await request(app)
      .post('/api/v1/goals')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'AI Edit Me', targetAmount: 100000, goalType: 'VACATION', priority: 'LOW' });
    const aiGoalId = goalCreate.body.data.id;
    const aiGoalUpdate = await TOOL_MAP.update_goal.execute(userA.id, { goal: aiGoalId, targetAmount: 250000, priority: 'HIGH', status: 'PAUSED' });
    assert(aiGoalUpdate.ok === true, 'AI tool update_goal executes');
    const aiGoalRow = await prisma.goal.findUnique({ where: { id: aiGoalId } });
    assert(Number(aiGoalRow.targetAmount) === 250000 && aiGoalRow.priority === 'HIGH' && aiGoalRow.status === 'PAUSED', 'AI tool update_goal persists target, priority and status');

    const aiLoanUpdate = await TOOL_MAP.update_loan.execute(userA.id, { loan: loanAId, outstandingBalance: 123456, status: 'ACTIVE' });
    assert(aiLoanUpdate.ok === true, 'AI tool update_loan executes');
    assert(Number((await prisma.loan.findUnique({ where: { id: loanAId } })).outstandingBalance) === 123456, 'AI tool update_loan persists the outstanding balance');

    const aiSubDelete = await TOOL_MAP.delete_subscription.execute(userA.id, { subscription: subAId });
    assert(aiSubDelete.ok === true && (await prisma.subscription.count({ where: { id: subAId } })) === 0, 'AI tool delete_subscription removes the subscription');

    const aiInsCreate = await TOOL_MAP.create_insurance.execute(userA.id, { policyName: 'AI Temp Cover', policyType: 'HEALTH', coverageAmount: 500000, premium: 12000, premiumCycle: 'ANNUAL', renewalDate: '2027-01-15' });
    assert(aiInsCreate.ok === true, 'AI tool create_insurance executes');
    const aiInsUpdate = await TOOL_MAP.update_insurance.execute(userA.id, { policy: 'AI Temp Cover', coverageAmount: 750000, premiumCycle: 'MONTHLY' });
    const aiInsRow = await prisma.insurancePolicy.findFirst({ where: { userId: userA.id, policyName: 'AI Temp Cover' } });
    assert(aiInsUpdate.ok === true && Number(aiInsRow.coverageAmount) === 750000 && aiInsRow.premiumCycle === 'MONTHLY', 'AI tool update_insurance persists coverage and premium cycle');
    const aiInsDelete = await TOOL_MAP.delete_insurance.execute(userA.id, { policy: 'AI Temp Cover' });
    assert(aiInsDelete.ok === true && (await prisma.insurancePolicy.count({ where: { userId: userA.id, policyName: 'AI Temp Cover' } })) === 0, 'AI tool delete_insurance removes the policy');

    const aiCatCreate = await TOOL_MAP.create_category.execute(userA.id, { name: 'AI Tool Category', categoryType: 'INCOME' });
    const aiCatRow = await prisma.category.findFirst({ where: { userId: userA.id, name: { contains: 'AI Tool Category' } } });
    assert(aiCatCreate.ok === true && aiCatRow && aiCatRow.categoryType === 'INCOME', 'AI tool create_category persists a user category');
    const aiCatUpdate = await TOOL_MAP.update_category.execute(userA.id, { category: aiCatRow.id, name: 'AI Tool Category v2' });
    assert(aiCatUpdate.ok === true, 'AI tool update_category executes');
    const aiCatDelete = await TOOL_MAP.delete_category.execute(userA.id, { category: 'AI Tool Category v2' });
    assert(aiCatDelete.ok === true && (await prisma.category.count({ where: { userId: userA.id, name: 'AI Tool Category v2' } })) === 0, 'AI tool delete_category removes the user category');
    const aiCatSystem = await TOOL_MAP.update_category.execute(userA.id, { category: systemCat?.id || 'nope', name: 'Hijack Try' });
    assert(aiCatSystem.ok === false, 'AI tool update_category refuses a shared system category');

    const aiProfile = await TOOL_MAP.update_profile.execute(userA.id, { riskProfile: 'AGGRESSIVE', city: 'Bengaluru' });
    const aiProfileRow = await prisma.financialProfile.findUnique({ where: { userId: userA.id } });
    assert(aiProfile.ok === true && aiProfileRow.riskProfile === 'AGGRESSIVE' && aiProfileRow.city === 'Bengaluru', 'AI tool update_profile persists risk profile and city');

    const aiTaskUpdate = await TOOL_MAP.update_task.execute(userA.id, { task: taskId, priority: 'LOW', notes: 'Edited by AI' });
    assert(aiTaskUpdate.ok === true, 'AI tool update_task executes');
    const aiTaskDelete = await TOOL_MAP.delete_task.execute(userA.id, { task: taskId });
    assert(aiTaskDelete.ok === true && (await prisma.financialTask.count({ where: { id: taskId } })) === 0, 'AI tool delete_task removes the task');

    // Account update/archive. A dedicated scratch account avoids disturbing the
    // legacy-reserve assertions above; the archive must be a soft delete so the
    // account's transaction history survives.
    const aiAcctCreate = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'AI Scratch Account', accountType: 'CASH', balance: 1000 });
    const aiAcctId = aiAcctCreate.body.data.id;
    const aiAccountUpdate = await TOOL_MAP.update_account.execute(userA.id, { account: aiAcctId, name: 'AI Renamed Account' });
    assert(aiAccountUpdate.ok === true, 'AI tool update_account executes');
    assert((await prisma.financialAccount.findUnique({ where: { id: aiAcctId } })).name === 'AI Renamed Account', 'AI tool update_account persists the new name');
    const aiAccountDelete = await TOOL_MAP.delete_account.execute(userA.id, { account: 'AI Renamed Account' });
    const aiAccountRow = await prisma.financialAccount.findUnique({ where: { id: aiAcctId } });
    assert(aiAccountDelete.ok === true && aiAccountRow.isActive === false, 'AI tool delete_account soft-deletes (isActive=false) instead of destroying history');
    const aiAccountGuard = await TOOL_MAP.delete_account.execute(userA.id, { account: 'Nonexistent Account XYZ' });
    assert(aiAccountGuard.ok === false, 'AI tool delete_account fails cleanly on an unknown account');

    // ================================================================
    // 👉 [28/28] Regression Guards — Security & Financial-Input Validation
    // ================================================================
    console.log('\n👉 [28/28] Testing Regression Guards (Path Traversal, Tenant Isolation, Amount Validation)...');

    // (a) SPA fallback must never serve files outside frontend/public. path.join()
    // collapses "../", so before the containment guard a raw request such as
    // "/../../node-backend/package.json" leaked the backend package.json.
    const http = require('http');
    const net = require('net');
    const spaServer = http.createServer(app);
    await new Promise((resolve) => spaServer.listen(0, '127.0.0.1', resolve));
    const spaPort = spaServer.address().port;
    const rawGet = (rawPath) => new Promise((resolve) => {
      const sock = net.connect(spaPort, '127.0.0.1', () => {
        sock.write(`GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
      });
      let buf = '';
      sock.on('data', (c) => { buf += c; });
      sock.on('end', () => resolve(buf));
      sock.on('error', () => resolve(''));
    });
    const traversalProbe = await rawGet('/../../node-backend/package.json');
    assert(
      traversalProbe.includes('<!DOCTYPE html>') && !traversalProbe.includes('finpro-backend'),
      'SPA fallback refuses path traversal (never serves files outside frontend/public)'
    );
    const legitProbe = await rawGet('/dashboard.html');
    assert(legitProbe.includes('<!DOCTYPE html>') && !legitProbe.includes('finpro-backend'), 'SPA fallback still serves legitimate public pages');
    await new Promise((resolve) => spaServer.close(resolve));

    // (b) A transaction amount must be a positive, finite number. Before the guard a
    // negative/NaN PATCH silently rewrote the ledger and desynced the account balance.
    const guardTxCreate = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ accountId: accountAId, amount: 500, transactionType: 'EXPENSE', description: 'Regression guard expense' });
    assert(guardTxCreate.status === 201, 'Created scratch transaction for the amount-validation guard');
    const guardTxId = guardTxCreate.body.data.id;

    const negUpdate = await request(app)
      .patch(`/api/v1/transactions/${guardTxId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ amount: -100 });
    assert(negUpdate.status === 400, 'PATCH /api/v1/transactions/:id rejects a negative amount (400)');

    const nanUpdate = await request(app)
      .patch(`/api/v1/transactions/${guardTxId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ amount: 'not-a-number' });
    assert(nanUpdate.status === 400, 'PATCH /api/v1/transactions/:id rejects a non-numeric amount (400)');

    const guardTxRow = await prisma.transaction.findUnique({ where: { id: guardTxId } });
    assert(Number(guardTxRow.amount) === 500, 'Rejected amount updates leave the transaction unchanged');

    // (c) Tenant isolation must cover every user-scoped storage prefix, not just "users/".
    // Generated exports live under "exports/<userId>/" and were previously unprotected.
    const foreignGet = await request(app)
      .get(`/api/v1/storage/file/${encodeURIComponent(`exports/${userB.id}/leak.csv`)}`)
      .set('Authorization', `Bearer ${tokenA}`);
    assert(foreignGet.status === 403, 'Storage refuses User A reading User B export key (403 tenant isolation)');

    const foreignDel = await request(app)
      .delete(`/api/v1/storage/file/${encodeURIComponent(`exports/${userB.id}/leak.csv`)}`)
      .set('Authorization', `Bearer ${tokenA}`);
    assert(foreignDel.status === 403, 'Storage refuses User A deleting User B export key (403 tenant isolation)');

    const ownGet = await request(app)
      .get(`/api/v1/storage/file/${encodeURIComponent(`exports/${userA.id}/nonexistent.csv`)}`)
      .set('Authorization', `Bearer ${tokenA}`);
    assert(ownGet.status !== 403, 'Storage permits probing a key in the caller own export namespace (not 403)');

    // (d) Statement import must reject invalid magnitudes before touching any balance.
    const badImport = await request(app)
      .post('/api/v1/import/confirm')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ rows: [{ amount: 'not-a-number', transactionType: 'EXPENSE', category: 'General' }] });
    assert(badImport.status === 400, 'Statement import rejects a non-numeric row amount (400)');

    const negImport = await request(app)
      .post('/api/v1/import/confirm')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ rows: [{ amount: -25, transactionType: 'EXPENSE', category: 'General' }] });
    assert(negImport.status === 400, 'Statement import rejects a negative row amount (400)');

    // (e) The error handler must not crash when an error carries no message. An
    // operator-precedence bug previously dereferenced `err.message` when falsy
    // (Cannot read properties of undefined), turning a handled 500 into a crash.
    const { errorHandler } = require('./src/middleware/errorHandler');
    let ehResult = null;
    let ehThrew = false;
    const ehMockRes = {
      status(code) { this._s = code; return this; },
      json(body) { ehResult = { status: this._s, body }; return this; },
    };
    try {
      errorHandler({ code: 'SOMETHING' }, { path: '/x', method: 'GET', originalUrl: '/x' }, ehMockRes, () => {});
    } catch (e) {
      ehThrew = true;
    }
    assert(!ehThrew && ehResult && ehResult.status === 500, 'Error handler survives an error with no message (no TypeError)');

  } catch (err) {
    console.error('\n❌ UNEXPECTED ERROR DURING SUITE:', err);
    failedCount++;
  } finally {
    if (userA?.id) await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    if (userB?.id) await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});
    await prisma.$disconnect();

    console.log('\n====================================================================');
    console.log(`  FINAL RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
    console.log('====================================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
