/**
 * Phase 10 — AI Advisor controller contract regression tests.
 *
 * The AI Advisor page (ai-advisor.html) binds to two endpoints whose response
 * contracts did not match what the page reads:
 *  - POST /gst/calculate  → the modal sends `rate` and reads `rate` /
 *    `totalAmount` / `totalPayable`; the controller only accepted `gstRatePct`
 *    and returned `grossAmount`, so the calculator rendered "undefined%".
 *  - GET  /credit-score   → the modal reads a flat `res.data.{score, rating,
 *    percentile, factors, bureauIntegration}`; the controller returned the
 *    nested service result, so every field was "undefined".
 *
 * Both controllers are exercised through a minimal Express app. The credit
 * health service is mocked so no database is required, and the GST service is
 * a pure calculator.
 */

jest.mock('../services/creditHealthService', () => ({
  evaluateCreditHealth: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

const gstController = require('../controllers/gstController');
const creditController = require('../controllers/creditHealthController');
const creditHealthService = require('../services/creditHealthService');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post('/gst/calculate', gstController.calculateGST);
  app.get('/credit-score', (req, res, next) => {
    req.user = { id: 'user-1' };
    return creditController.getCreditScore(req, res, next);
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ success: false, error: { message: err.message } }));
  return app;
};

describe('Phase 10 — GST calculator contract', () => {
  const app = buildApp();

  it('accepts the modal `rate` field and returns the aliases it reads', async () => {
    const res = await request(app).post('/gst/calculate').send({ taxableAmount: 1000, rate: 18, isInterState: false });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rate).toBe(18);
    expect(res.body.data.totalAmount).toBe(1180);
    expect(res.body.data.totalPayable).toBe(1180);
    expect(res.body.data.cgst).toBe(90);
    expect(res.body.data.sgst).toBe(90);
    expect(res.body.data.igst).toBe(0);
  });

  it('splits interstate tax as IGST', async () => {
    const res = await request(app).post('/gst/calculate').send({ taxableAmount: 1000, rate: 18, isInterState: true });
    expect(res.body.data.igst).toBe(180);
    expect(res.body.data.cgst).toBe(0);
    expect(res.body.data.sgst).toBe(0);
    expect(res.body.data.igstRate).toBe(18);
  });

  it('still accepts the legacy `gstRatePct` field', async () => {
    const res = await request(app).post('/gst/calculate').send({ taxableAmount: 2000, gstRatePct: 12 });
    expect(res.body.data.rate).toBe(12);
    expect(res.body.data.totalGst).toBe(240);
    expect(res.body.data.grossAmount).toBe(2240);
  });

  it('back-calculates a tax-inclusive amount', async () => {
    const res = await request(app).post('/gst/calculate').send({ taxableAmount: 1180, rate: 18, isTaxInclusive: true });
    expect(res.body.data.taxableAmount).toBe(1000);
    expect(res.body.data.totalGst).toBe(180);
  });

  it('rejects a non-positive taxable amount with 400', async () => {
    const zero = await request(app).post('/gst/calculate').send({ taxableAmount: 0, rate: 18 });
    expect(zero.status).toBe(400);
    const negative = await request(app).post('/gst/calculate').send({ taxableAmount: -100, rate: 18 });
    expect(negative.status).toBe(400);
  });
});

describe('Phase 10 — Credit score response contract', () => {
  const app = buildApp();

  beforeEach(() => {
    creditHealthService.evaluateCreditHealth.mockReset();
  });

  it('flattens the nested service result for the modal', async () => {
    creditHealthService.evaluateCreditHealth.mockResolvedValue({
      success: true,
      timestamp: '2026-01-01T00:00:00.000Z',
      finproIndicator: {
        score: 812,
        scoreTier: 'EXCELLENT',
        methodology: {
          factors: [
            { name: 'Credit Card Utilization', status: 'OPTIMAL', value: '12%' },
            { name: 'Debt-To-Income (DTI) Burden', status: 'COMFORTABLE', value: '22%' },
            { name: 'Cashflow Savings Cushion', status: 'STRONG', value: '30% savings rate' },
            { name: 'Credit Mix Diversity', status: 'DIVERSIFIED', value: '2 Cards, 1 Loans' },
          ],
        },
      },
      officialBureauIntegration: { status: 'NOT_CONFIGURED', officialScoreAvailable: false },
      education: { whatIsCIBIL: 'A 3-digit numeric summary...' },
    });

    const res = await request(app).get('/credit-score');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Flat fields the modal binds to.
    expect(res.body.data.score).toBe(812);
    expect(res.body.data.rating).toBe('EXCELLENT');
    expect(res.body.data.percentile).toBe('75th');
    expect(res.body.data.bureauIntegration.status).toBe('NOT_CONFIGURED');
    expect(res.body.data.factors.debtToIncomeRatio).toBe('22%');
    expect(res.body.data.factors.creditMix).toBe('DIVERSIFIED');
    // The original nested payload is preserved for other consumers.
    expect(res.body.finproIndicator.score).toBe(812);
  });

  it('falls back to safe defaults when the service omits indicator fields', async () => {
    creditHealthService.evaluateCreditHealth.mockResolvedValue({ success: true });

    const res = await request(app).get('/credit-score');
    expect(res.status).toBe(200);
    expect(res.body.data.score).toBe(720);
    expect(res.body.data.rating).toBe('Good');
  });
});
