/**
 * FinPro — Bank SMS Detection & Mobile Synchronization Acceptance Test Suite
 * Conforms to Master Engineering Directive Sections 4, 5, 6, 7, 8, 9, 13, 14.
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();

const request = require('supertest');
const app = require('./src/app');
const prisma = require('./src/config/database');
const smsParserService = require('./src/services/smsParserService');

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

async function runSmsMobileTests() {
  console.log('\n====================================================================');
  console.log('  FINPRO — BANK SMS DETECTION & MOBILE SYNC ACCEPTANCE SUITE');
  console.log('====================================================================\n');

  let userA, tokenA, userB, tokenB;
  let accountAId;

  const testUserA = {
    email: `sms_test_a_${Date.now()}@example.com`,
    username: `sms_user_a_${Date.now()}`,
    password: 'Password123!',
    firstName: 'Test',
    lastName: 'UserA',
  };

  const testUserB = {
    email: `sms_test_b_${Date.now()}@example.com`,
    username: `sms_user_b_${Date.now()}`,
    password: 'Password123!',
    firstName: 'Tenant',
    lastName: 'UserB',
  };

  try {
    // 1. Auth Setup
    console.log('👉 [1/6] Registering test users...');
    const regA = await request(app).post('/api/v1/auth/register').send(testUserA);
    assert(regA.status === 201, 'User A registered successfully');
    tokenA = regA.body.data.accessToken;
    userA = regA.body.data.user;

    const regB = await request(app).post('/api/v1/auth/register').send(testUserB);
    assert(regB.status === 201, 'User B registered successfully');
    tokenB = regB.body.data.accessToken;
    userB = regB.body.data.user;

    // Create Account for User A with balance 10,000
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'HDFC Salary Account',
        accountType: 'BANK',
        accountNumberMasked: 'XX1234',
        balance: 10000,
        currency: 'INR'
      });
    assert(accRes.status === 201, 'Created test account with XX1234 ending');
    accountAId = accRes.body.data.id;

    // 2. Parser Unit Test Validation
    console.log('\n👉 [2/6] Validating SMS Parser Engine...');
    const otpMsg = 'Your OTP for transaction of Rs 500 at Swiggy is 482910. Do not share with anyone.';
    const otpClass = smsParserService.classifyMessage(otpMsg);
    assert(!otpClass.isTransaction && otpClass.type === 'OTP', 'Strictly filters out OTP messages');

    const promoMsg = 'Congratulations! Pre-approved personal loan of Rs 5,00,000 at low EMI. Click here to claim.';
    const promoClass = smsParserService.classifyMessage(promoMsg);
    assert(!promoClass.isTransaction && promoClass.type === 'PROMOTIONAL', 'Filters out promotional loan messages');

    const reqMsg = 'PhonePe: User Amit has requested Rs 300 from you. Pay before 5pm.';
    const reqClass = smsParserService.classifyMessage(reqMsg);
    assert(!reqClass.isTransaction && reqClass.type === 'PAYMENT_REQUEST', 'Filters out payment collect requests');

    const balMsg = 'Available balance in A/c XX1234 is Rs 25,400.00 as of 10-Oct-2026.';
    const balClass = smsParserService.classifyMessage(balMsg);
    assert(!balClass.isTransaction && balClass.type === 'BALANCE_ENQUIRY', 'Filters out balance enquiry messages');

    const failMsg = 'Transaction of Rs 1,200.00 on Card ending 1234 DECLINED due to incorrect PIN.';
    const failClass = smsParserService.classifyMessage(failMsg);
    assert(!failClass.isTransaction && failClass.type === 'FAILED', 'Filters out declined/failed transactions');

    // 3. Valid SMS Parsing & Ingestion
    console.log('\n👉 [3/6] Testing Ingestion of Valid Bank Messages...');
    const debitSms = 'Rs. 450.00 debited from A/c XX1234 on 10-Oct-2026 at SWIGGY. Avl Bal Rs 9,550. Ref: SWG987654.';
    const ingestRes1 = await request(app)
      .post('/api/v1/sms/ingest')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ messageText: debitSms, sender: 'HDFCBK' });

    assert(ingestRes1.status === 201, 'POST /api/v1/sms/ingest succeeds (201 Created)');
    assert(parseFloat(ingestRes1.body.data.amount) === 450, 'Parsed amount is exactly 450.00');
    assert(ingestRes1.body.data.suggestedCategory === 'Food & Dining', 'Categorized as Food & Dining via Swiggy');
    assert(ingestRes1.body.data.accountHint === '1234', 'Extracted account hint 1234');
    assert(ingestRes1.body.data.matchedAccountId === accountAId, 'Auto-matched to user account XX1234');
    const pendingDebitId = ingestRes1.body.data.id;

    // Test Salary Credit SMS
    const salarySms = 'Your A/c XX1234 is credited with INR 85,000.00 on 01-OCT-2026 by Salary/AcmeCorp. Avl Bal INR 94,550.';
    const ingestRes2 = await request(app)
      .post('/api/v1/sms/ingest')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ messageText: salarySms, sender: 'HDFCBK' });

    assert(ingestRes2.status === 201, 'Salary credit SMS ingested (201 Created)');
    assert(ingestRes2.body.data.transactionType === 'INCOME', 'Direction correctly classified as INCOME');
    assert(ingestRes2.body.data.suggestedCategory === 'Salary', 'Category correctly classified as Salary');

    // Test Non-transaction rejection over API
    const nonTxRes = await request(app)
      .post('/api/v1/sms/ingest')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ messageText: otpMsg, sender: 'VM-SWIGGY' });
    assert(nonTxRes.status === 422, 'Ingesting OTP returns 422 Unprocessable Entity');

    // 4. Duplicate Ingestion Protection
    console.log('\n👉 [4/6] Testing Duplicate Protection...');
    const dupRes = await request(app)
      .post('/api/v1/sms/ingest')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ messageText: debitSms, sender: 'HDFCBK' });
    assert(dupRes.status === 409, 'Duplicate identical SMS rejected with 409 Conflict');

    // 5. Pending Review, Confirmation, Balance Mutation & Rejection
    console.log('\n👉 [5/6] Testing Confirmation & Ledger Mutation...');
    const listRes = await request(app)
      .get('/api/v1/sms/pending')
      .set('Authorization', `Bearer ${tokenA}`);
    assert(listRes.status === 200, 'GET /api/v1/sms/pending returns 200 OK');
    assert(listRes.body.data.length >= 2, 'Pending list contains ingested candidates');

    // Confirm debit of 450: Account balance was 10000, should become 9550
    const confirmRes = await request(app)
      .post(`/api/v1/sms/pending/${pendingDebitId}/confirm`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ categoryName: 'Team Dining' }); // User customizes category

    assert(confirmRes.status === 200, 'POST /api/v1/sms/pending/:id/confirm succeeds');
    assert(parseFloat(confirmRes.body.accountBalance) === 9550, 'Account balance decremented atomically from 10,000 to 9,550');
    assert(confirmRes.body.data.id !== undefined, 'Canonical Transaction created');

    // Idempotency: confirming again should return 400
    const reconfirmRes = await request(app)
      .post(`/api/v1/sms/pending/${pendingDebitId}/confirm`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    assert(reconfirmRes.status === 400, 'Re-confirming already confirmed transaction rejected with 400');

    // Test Rejection of remaining candidate
    const pendingSalaryId = ingestRes2.body.data.id;
    const rejectRes = await request(app)
      .post(`/api/v1/sms/pending/${pendingSalaryId}/reject`)
      .set('Authorization', `Bearer ${tokenA}`);
    assert(rejectRes.status === 200, 'POST /api/v1/sms/pending/:id/reject updates status to REJECTED');

    // 6. Mobile Device Registration, Sync & Multi-Tenant Isolation
    console.log('\n👉 [6/6] Testing Mobile Sync & Multi-Tenant Isolation...');
    const deviceRes = await request(app)
      .post('/api/v1/mobile/devices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        deviceId: 'pixel-8-test-uuid',
        deviceModel: 'Google Pixel 8',
        osVersion: 'Android 14',
        appVersion: '1.0.0'
      });
    assert(deviceRes.status === 200, 'POST /api/v1/mobile/devices registers mobile client');

    const syncRes = await request(app)
      .get('/api/v1/mobile/sync?deviceId=pixel-8-test-uuid')
      .set('Authorization', `Bearer ${tokenA}`);
    assert(syncRes.status === 200, 'GET /api/v1/mobile/sync delivers unified financial snapshot');
    assert(syncRes.body.data.accounts.length > 0, 'Sync includes active accounts');
    assert(syncRes.body.data.recentTransactions.length > 0, 'Sync includes confirmed canonical transactions');

    // Tenant Isolation: User B cannot access User A's pending SMS
    const crossRes = await request(app)
      .post(`/api/v1/sms/pending/${pendingDebitId}/confirm`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({});
    assert(crossRes.status === 404, 'User B cannot access or confirm User A pending SMS (404 Not Found)');

  } catch (err) {
    console.error('Test execution exception:', err);
    failedCount++;
  }

  console.log('\n====================================================================');
  console.log(`  SMS & MOBILE SUITE: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log('====================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSmsMobileTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
