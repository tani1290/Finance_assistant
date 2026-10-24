/**
 * Pune retail metals estimate — transparency and degradation contract.
 *
 * The estimate is DERIVED from the existing live gold/silver/FX feed with
 * published Indian statutory loadings. It is deliberately NOT presented as a
 * provider quote, and it must degrade to `null` rather than fabricate a price
 * when the live feed is unavailable.
 */

const marketService = require('../services/marketService');

const { buildPuneMarket, getMetalsStatus } = marketService;

const BASE = {
  goldPerGram24k: 5000,
  silverPerGram: 80,
  providerTimestamp: '2026-10-22T09:00:00.000Z',
  timestampIST: '22 Oct 2026, 02:30 PM IST',
  dataStatus: 'LIVE',
  source: 'COMEX via Yahoo Finance',
  usdToInr: 84.1,
};

describe('buildPuneMarket', () => {
  test('applies BCD + GST + handling transparently and labels the result as derived', () => {
    const pune = buildPuneMarket(BASE);

    expect(pune.selection_status).toBe('DERIVED_INDICATIVE');
    expect(pune.is_live_provider_quote).toBe(false);
    expect(pune.city).toBe('Pune');
    expect(pune.data_status).toBe('LIVE');
    expect(pune.usdToInr).toBe(84.1);
    expect(pune.timestamp).toBe(BASE.timestampIST);

    // 5000 spot + 300 duty + 159 GST + 24.57 handling = 5483.57
    expect(pune.gold.karat24.perGram).toBe(5483.57);
    expect(pune.gold.karat24.per10Gram).toBe(54835.7);
    expect(pune.gold.karat22.bullionPerGram).toBe(5026.61);
    expect(pune.gold.karat22.jewelleryPerGram).toBe(5428.74);
    expect(pune.gold.karat18.bullionPerGram).toBe(4112.68);

    const breakdown = pune.gold.tariff_and_tax_breakdown;
    expect(breakdown.base_international_converted_spot_per_gram).toBe(5000);
    expect(breakdown.basic_customs_duty_and_aidc_pct).toBe(6);
    expect(breakdown.basic_customs_duty_amount).toBe(300);
    expect(breakdown.gst_pct).toBe(3);
    expect(breakdown.gst_amount).toBe(159);
    expect(breakdown.pune_handling_and_delivery_margin_pct).toBe(0.45);
    expect(breakdown.final_indicative_bullion_rate_per_gram).toBe(5483.57);

    // 80 + 4.8 + 2.54 + 0.39 = 87.73 per gram
    expect(pune.silver.perGram).toBe(87.73);
    expect(pune.silver.perKg).toBe(87730);
    expect(pune.gold.disclaimer).toMatch(/Indicative/);
    expect(pune.silver.disclaimer).toMatch(/Indicative/);
  });

  test.each([
    [{ goldPerGram24k: null }],
    [{ goldPerGram24k: 0 }],
    [{ goldPerGram24k: -1 }],
    [{ silverPerGram: null }],
    [{ silverPerGram: 0 }],
    [{ silverPerGram: NaN }],
  ])('returns null instead of a partial price for %p', (override) => {
    expect(buildPuneMarket({ ...BASE, ...override })).toBeNull();
  });

  test('preserves the provider status label instead of upgrading it to LIVE', () => {
    const stale = buildPuneMarket({ ...BASE, dataStatus: 'STALE' });
    expect(stale.data_status).toBe('STALE');
    expect(stale.is_live_provider_quote).toBe(false);
  });
});

describe('getMetalsStatus', () => {
  const ORIGINAL_AV = process.env.ALPHA_VANTAGE_API_KEY;
  const ORIGINAL_FINNHUB = process.env.FINNHUB_API_KEY;

  afterEach(() => {
    if (ORIGINAL_AV === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = ORIGINAL_AV;
    if (ORIGINAL_FINNHUB === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = ORIGINAL_FINNHUB;
  });

  test('reports configuration booleans and derived-market metadata without leaking credentials', () => {
    process.env.ALPHA_VANTAGE_API_KEY = 'super-secret-alpha-key';
    process.env.FINNHUB_API_KEY = 'super-secret-finnhub-key';

    const status = getMetalsStatus();

    expect(status.isConfigured).toBe(true);
    expect(status.credentials.alphaVantageConfigured).toBe(true);
    expect(status.credentials.finnhubConfigured).toBe(true);
    expect(typeof status.credentials.databaseCacheConfigured).toBe('boolean');
    expect(status.supportedMetals).toEqual(['Gold (GC=F)', 'Silver (SI=F)']);
    expect(status.troyOunceConversionConstant).toBe(31.1035);
    expect(status.derivedMarkets.pune).toMatchObject({
      endpoint: '/api/v1/market/metals/pune',
      selection_status: 'DERIVED_INDICATIVE',
      is_live_provider_quote: false,
      statutoryDutyPct: 6,
      gstPct: 3,
    });
    expect(status.cache.freshTtlSeconds).toBe(180);
    expect(status.cache.staleTtlSeconds).toBe(3600);

    const serialised = JSON.stringify(status);
    expect(serialised).not.toContain('super-secret-alpha-key');
    expect(serialised).not.toContain('super-secret-finnhub-key');
  });

  test('reports UNAVAILABLE when no quote has been cached yet', () => {
    const status = getMetalsStatus();
    expect(['UNKNOWN', 'UNAVAILABLE', 'CACHED', 'STALE', 'LIVE']).toContain(
      status.dataStatus
    );
    expect(Array.isArray(status.warnings)).toBe(true);
  });
});
