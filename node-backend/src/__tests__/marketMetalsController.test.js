/**
 * Metals controller — Pune passthrough and honest 503 degradation.
 *
 * `marketService` is mocked so no provider, cache or database is contacted.
 */

jest.mock('../config/database', () => ({}));
jest.mock('../services/marketService', () => ({
  getPreciousMetals: jest.fn(),
  getMetalsStatus: jest.fn(),
}));

const marketService = require('../services/marketService');
const {
  getMetalsStatus,
  getPuneRetailMetals,
  getGold,
} = require('../controllers/investmentController');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const bodyOf = (res) => res.json.mock.calls[0][0];

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /market/metals/pune', () => {
  test('returns the derived Pune block exactly as the service built it', async () => {
    const pune = {
      city: 'Pune',
      selection_status: 'DERIVED_INDICATIVE',
      is_live_provider_quote: false,
      gold: { karat24: { perGram: 5483.57 } },
    };
    marketService.getPreciousMetals.mockResolvedValue({
      puneMarket: pune,
      gold: { karat24: { perGram: 5000 } },
    });

    const res = makeRes();
    await getPuneRetailMetals({}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res)).toEqual({ success: true, data: pune });
  });

  test('answers 503 UNAVAILABLE instead of inventing a fallback rate', async () => {
    marketService.getPreciousMetals.mockResolvedValue({
      puneMarket: null,
      marketStatus: 'UNAVAILABLE',
    });

    const res = makeRes();
    const next = jest.fn();
    await getPuneRetailMetals({}, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(bodyOf(res).success).toBe(false);
    expect(bodyOf(res).error.code).toBe('UNAVAILABLE');
    expect(next).not.toHaveBeenCalled();
  });

  test('supports the snake_case alias without changing the top-level contract', async () => {
    marketService.getPreciousMetals.mockResolvedValue({
      pune_market: { city: 'Pune', selection_status: 'DERIVED_INDICATIVE' },
    });

    const res = makeRes();
    await getPuneRetailMetals({}, res, jest.fn());
    expect(bodyOf(res).data.city).toBe('Pune');
  });
});

describe('GET /market/metals/status', () => {
  test('returns service diagnostics without exposing credentials', async () => {
    marketService.getMetalsStatus.mockReturnValue({
      isConfigured: true,
      credentials: { alphaVantageConfigured: false },
    });

    const res = makeRes();
    await getMetalsStatus({}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res)).toEqual({
      success: true,
      data: { isConfigured: true, credentials: { alphaVantageConfigured: false } },
    });
  });
});

describe('GET /market/gold', () => {
  test('passes puneMarket through alongside the existing gold contract', async () => {
    const pune = { city: 'Pune', selection_status: 'DERIVED_INDICATIVE' };
    marketService.getPreciousMetals.mockResolvedValue({
      gold: { karat24: { perGram: 5483.57 }, karat22: { perGram: 5026.61 } },
      silver: { perGram: 87.73 },
      puneMarket: pune,
      marketStatus: 'OPEN',
      market_status: 'OPEN',
      data_status: 'LIVE',
      dataStatus: 'LIVE',
      source: 'Yahoo',
      timestamp: '22 Oct 2026',
      provider: 'Yahoo',
      provider_timestamp: '2026-10-22T09:00:00.000Z',
      fetched_at: '2026-10-22T09:00:01.000Z',
      usdToInr: 84.1,
    });

    const res = makeRes();
    await getGold({}, res, jest.fn());

    expect(bodyOf(res).data.puneMarket).toEqual(pune);
    expect(bodyOf(res).data.karat24.perGram).toBe(5483.57);
    expect(bodyOf(res).data.usdToInr).toBe(84.1);
  });
});
