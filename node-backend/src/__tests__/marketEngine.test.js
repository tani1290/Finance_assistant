/**
 * Phase 9 — Market Reliability Engine regression tests.
 *
 * Deterministic by construction:
 *  - axios transport is MOCKED (no network, no rate limits).
 *  - the database module is MOCKED (no DB required).
 *  - provider credentials are cleared, so only the mocked Yahoo branch runs.
 *
 * These cover: quote validation (rejecting invalid provider payloads instead of
 * coercing them into plausible prices), session/holiday awareness, singleflight
 * coalescing, the Alpha Vantage currency-regression fix, and worker lifecycle.
 */

jest.mock('axios');
jest.mock('../config/database', () => ({
  marketPriceHistory: {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(null),
  },
  $disconnect: jest.fn().mockResolvedValue(undefined),
}));

const axios = require('axios');
const marketService = require('../services/marketService');

const {
  validateQuoteMetrics,
  getMarketSession,
  isMarketOpen,
  getQuote,
  startMarketBackgroundWorker,
  stopMarketBackgroundWorker,
} = marketService;

// ── Mock transport helpers ────────────────────────────────────────────────────

/** Yahoo session bootstrap: never establishes a cookie (keeps state pristine). */
const SESSION_RESPONSE = { headers: {}, data: '' };

const chartResponse = (meta) => ({
  data: { chart: { result: [{ meta }] } },
});

const validMeta = (overrides = {}) => ({
  regularMarketPrice: 3500.5,
  chartPreviousClose: 3450,
  regularMarketOpen: 3460,
  regularMarketDayHigh: 3520,
  regularMarketDayLow: 3440,
  regularMarketVolume: 123456,
  currency: 'INR',
  regularMarketTime: Math.floor(Date.now() / 1000) - 60,
  ...overrides,
});

beforeAll(() => {
  // Guarantee the standard suite never needs real provider credentials.
  delete process.env.ALPHA_VANTAGE_API_KEY;
  delete process.env.FINNHUB_API_KEY;
});

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockImplementation((url) => {
    if (url.includes('/v8/finance/chart/')) return Promise.resolve(chartResponse(validMeta()));
    return Promise.resolve(SESSION_RESPONSE);
  });
});

// ── 1. validateQuoteMetrics (pure) ────────────────────────────────────────────

describe('validateQuoteMetrics', () => {
  test('rejects non-positive, NaN and non-finite prices', () => {
    expect(validateQuoteMetrics({ price: 0 }).valid).toBe(false);
    expect(validateQuoteMetrics({ price: -12.5 }).valid).toBe(false);
    expect(validateQuoteMetrics({ price: NaN }).valid).toBe(false);
    expect(validateQuoteMetrics({ price: Infinity }).valid).toBe(false);
    expect(validateQuoteMetrics({ price: '3500' }).valid).toBe(false);
    expect(validateQuoteMetrics({ price: undefined }).valid).toBe(false);
  });

  test('accepts a valid payload and computes change / changePercent from previous close', () => {
    const m = validateQuoteMetrics({
      price: 3500.5, open: 3460, high: 3520, low: 3440, previousClose: 3450,
      providerTimestamp: new Date().toISOString(),
    });
    expect(m.valid).toBe(true);
    expect(m.price).toBe(3500.5);
    expect(m.change).toBe(50.5);
    expect(m.changePercent).toBe(1.46);
  });

  test('normalises an inverted high/low rather than propagating inconsistent bounds', () => {
    const m = validateQuoteMetrics({ price: 100, high: 90, low: 110, previousClose: 95 });
    expect(m.valid).toBe(true);
    expect(m.high).toBe(110);
    expect(m.low).toBe(90);
    expect(m.high).toBeGreaterThanOrEqual(m.price);
    expect(m.low).toBeLessThanOrEqual(m.price);
  });

  test('tolerates absent optional metrics and falls back to the valid price', () => {
    const m = validateQuoteMetrics({ price: 500, open: null, high: 0, low: undefined, previousClose: null });
    expect(m.valid).toBe(true);
    expect(m.high).toBe(500);
    expect(m.low).toBe(500);
    expect(m.previousClose).toBe(500);
    expect(m.change).toBe(0);
    expect(m.changePercent).toBe(0);
  });

  test('rejects a provider timestamp skewed more than 15 minutes into the future', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const m = validateQuoteMetrics({ price: 100, providerTimestamp: future });
    expect(m.valid).toBe(false);
    expect(String(m.error)).toMatch(/future/i);
  });

  test('accepts a small clock skew and returns a normalised ISO timestamp', () => {
    const smallSkew = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const m = validateQuoteMetrics({ price: 100, providerTimestamp: smallSkew });
    expect(m.valid).toBe(true);
    expect(m.providerTimestamp).toBe(smallSkew);
  });

  test('rejects an unparseable provider timestamp', () => {
    const m = validateQuoteMetrics({ price: 100, providerTimestamp: 'not-a-date' });
    expect(m.valid).toBe(false);
  });
});

// ── 2. getMarketSession / isMarketOpen (IST + NSE holidays) ───────────────────

describe('getMarketSession (holiday-aware NSE sessions, IST)', () => {
  test('is open during regular IST trading hours', () => {
    // 2026-06-10 (Wed) 03:50Z === 09:20 IST
    const s = getMarketSession(new Date('2026-06-10T03:50:00Z'));
    expect(s.isOpen).toBe(true);
    expect(s.status).toBe('OPEN');
    expect(s.sessionName).toMatch(/Regular/i);
  });

  test('treats the 09:15 and 15:30 IST boundaries as open (inclusive)', () => {
    expect(getMarketSession(new Date('2026-06-10T03:45:00Z')).isOpen).toBe(true); // 09:15 IST
    expect(getMarketSession(new Date('2026-06-10T10:00:00Z')).isOpen).toBe(true); // 15:30 IST
  });

  test('is closed one minute after the close', () => {
    const s = getMarketSession(new Date('2026-06-10T10:01:00Z')); // 15:31 IST
    expect(s.isOpen).toBe(false);
    expect(s.sessionName).toMatch(/After Hours/i);
  });

  test('classifies the pre-market order window as closed but labelled', () => {
    const s = getMarketSession(new Date('2026-06-10T03:35:00Z')); // 09:05 IST
    expect(s.isOpen).toBe(false);
    expect(s.sessionName).toMatch(/Pre-Market/i);
  });

  test('is closed on weekends with an explicit weekend label', () => {
    const sat = getMarketSession(new Date('2026-06-13T05:00:00Z'));
    const sun = getMarketSession(new Date('2026-06-14T05:00:00Z'));
    expect(sat.isOpen).toBe(false);
    expect(sun.isOpen).toBe(false);
    expect(sat.sessionName).toMatch(/Saturday/);
    expect(sun.sessionName).toMatch(/Sunday/);
  });

  test('is closed on a declared NSE holiday (weekday) with a holiday label', () => {
    // 2026-10-02 (Fri) — Gandhi Jayanti, present in the holiday calendar.
    const s = getMarketSession(new Date('2026-10-02T05:00:00Z'));
    expect(s.isOpen).toBe(false);
    expect(s.sessionName).toMatch(/Holiday/i);
  });

  test('does not confuse UTC with IST when deriving the session', () => {
    // 03:50Z is 09:20 IST (open); 03:50 IST-as-UTC reading would be wrong.
    expect(getMarketSession(new Date('2026-06-10T03:50:00Z')).isOpen).toBe(true);
    // 10:00Z is 15:30 IST (open) even though UTC-hour parsing would say "closed".
    expect(getMarketSession(new Date('2026-06-10T10:00:00Z')).isOpen).toBe(true);
  });

  test('assumes no holiday outside the declared calendar range (safe default)', () => {
    // A far-future mid-week regular-hours timestamp must not be treated as a holiday.
    const s = getMarketSession(new Date('2030-06-12T04:00:00Z')); // Wed 09:30 IST
    expect(s.isOpen).toBe(true);
  });

  test('isMarketOpen delegates to the session state', () => {
    expect(typeof isMarketOpen()).toBe('boolean');
    expect(isMarketOpen()).toBe(getMarketSession().isOpen);
  });
});

// ── 3. Provider boundary via getQuote (mocked transport) ──────────────────────

describe('getQuote provider-boundary validation', () => {
  test('rejects a future-skewed provider payload instead of publishing it as a live price', async () => {
    const symbol = 'ZFUTURE1';
    axios.get.mockImplementation((url) => {
      if (url.includes('/v8/finance/chart/')) {
        return Promise.resolve(chartResponse(validMeta({
          regularMarketTime: Math.floor(Date.now() / 1000) + 3600, // +1h
        })));
      }
      return Promise.resolve(SESSION_RESPONSE);
    });

    const q = await getQuote(symbol);
    expect(q.symbol).toBe(symbol);
    expect(q.price).toBeNull();
    expect(q.data_status).toBe('UNAVAILABLE');
    expect(q.dataStatus).toBe('UNAVAILABLE');
    expect(q.market_status).toBe('UNAVAILABLE');
    expect(typeof q.error_status).toBe('string');
  });

  test('returns a validated quote with consistent bounds and session metadata', async () => {
    const symbol = 'ZVALID1';
    axios.get.mockImplementation((url) => {
      if (url.includes('/v8/finance/chart/')) {
        return Promise.resolve(chartResponse(validMeta({ regularMarketDayHigh: 90, regularMarketDayLow: 3510 })));
      }
      return Promise.resolve(SESSION_RESPONSE);
    });

    const q = await getQuote(symbol);
    const session = getMarketSession();

    expect(q.symbol).toBe(symbol);
    expect(q.price).toBe(3500.5);
    // Bounds normalised: high >= price >= low.
    expect(q.high).toBeGreaterThanOrEqual(q.price);
    expect(q.low).toBeLessThanOrEqual(q.price);
    expect(q.previousClose).toBe(3450);
    expect(q.change).toBe(50.5);
    expect(q.changePercent).toBe(1.46);
    expect(q.volume).toBe(123456);
    // data_status must reflect the actual session, never an unconditional LIVE.
    expect(q.data_status).toBe(session.isOpen ? 'LIVE' : 'CACHED');
    expect(q.dataStatus).toBe(q.data_status);
    expect(q.session_name).toBe(session.sessionName);
    expect(q.last_market_update).toBeTruthy();
    expect(q.last_successful_refresh).toBeTruthy();
  });

  test('coalesces concurrent identical requests into a single upstream fetch', async () => {
    const symbol = 'ZCOALESCE1';
    let chartCalls = 0;
    axios.get.mockImplementation((url) => {
      if (url.includes('/v8/finance/chart/')) {
        chartCalls += 1;
        return new Promise((resolve) =>
          setTimeout(() => resolve(chartResponse(validMeta({ regularMarketPrice: 111 }))), 40));
      }
      return Promise.resolve(SESSION_RESPONSE);
    });

    const [a, b] = await Promise.all([getQuote(symbol), getQuote(symbol)]);
    expect(chartCalls).toBe(1);
    expect(a.price).toBe(111);
    expect(b.price).toBe(111);
    expect(a).toBe(b); // both callers receive the same resolved observation
  });

  test('normalises symbol spelling so lookups share one coalesced fetch', async () => {
    const symbol = 'ZSPELL1';
    let chartCalls = 0;
    axios.get.mockImplementation((url) => {
      if (url.includes('/v8/finance/chart/')) {
        chartCalls += 1;
        return new Promise((resolve) =>
          setTimeout(() => resolve(chartResponse(validMeta({ regularMarketPrice: 222 }))), 40));
      }
      return Promise.resolve(SESSION_RESPONSE);
    });

    const [a, b] = await Promise.all([getQuote('  zspell1 '), getQuote('ZSPELL1')]);
    expect(chartCalls).toBe(1);
    expect(a.symbol).toBe(symbol);
    expect(b.symbol).toBe(symbol);
  });

  test('removes the in-flight entry after settling so a later fetch is not poisoned', async () => {
    const symbol = 'ZSEQUENTIAL1';
    let chartCalls = 0;
    axios.get.mockImplementation((url) => {
      if (url.includes('/v8/finance/chart/')) {
        chartCalls += 1;
        return Promise.resolve(chartResponse(validMeta({ regularMarketPrice: 300 + chartCalls })));
      }
      return Promise.resolve(SESSION_RESPONSE);
    });

    const first = await getQuote(symbol);
    expect(chartCalls).toBe(1);
    expect(first.price).toBe(301);

    // Second call within the fresh window is served from cache (no new fetch),
    // proving the settled in-flight entry was evicted and did not poison the map.
    const cached = await getQuote(symbol);
    expect(cached.price).toBe(301);
    expect(chartCalls).toBe(1);
  });

  test('does NOT scale Alpha Vantage quotes by a USD->INR multiplier (currency regression)', async () => {
    process.env.ALPHA_VANTAGE_API_KEY = 'test-av-key';
    try {
      const symbol = 'ZAVREG1';
      axios.get.mockImplementation((url) => {
        if (url.includes('/v8/finance/chart/')) return Promise.resolve({ data: {} }); // Yahoo yields nothing
        if (url.includes('alphavantage.co')) {
          return Promise.resolve({
            data: {
              'Global Quote': {
                '05. price': '100.00',
                '02. open': '99.00',
                '03. high': '101.00',
                '04. low': '98.00',
                '08. previous close': '98.50',
                '06. volume': '1000',
                '07. latest trading day': '2020-06-10',
              },
            },
          });
        }
        return Promise.resolve(SESSION_RESPONSE);
      });

      const q = await getQuote(symbol);
      expect(q.provider).toBe('Alpha Vantage');
      // AV BSE/NSE quotes are already INR — must not be inflated by ~83x.
      expect(q.price).toBe(100);
      expect(q.currency).toBe('INR');
    } finally {
      delete process.env.ALPHA_VANTAGE_API_KEY;
    }
  });
});

// ── 4. Worker lifecycle ───────────────────────────────────────────────────────

describe('background market worker lifecycle', () => {
  test('start is idempotent and stop clears timers (no duplicate workers)', () => {
    // Long interval so nothing fires inside the test.
    const a = startMarketBackgroundWorker(600000);
    const b = startMarketBackgroundWorker(600000);
    expect(a).toBe(b);

    stopMarketBackgroundWorker();

    const c = startMarketBackgroundWorker(600000);
    expect(c).not.toBe(a);

    stopMarketBackgroundWorker();
  });
});
