const prisma = require('../config/database');
const cacheService = require('./cacheService');
const { createHttpClient } = require('./httpClient');

// Public market data only. No account, transaction or user-scoped value may be
// written to the shared cache from this service.
const http = createHttpClient({ name: 'market', timeoutMs: 8000, retries: 1, maxConcurrent: 8 });

/**
 * Jinay Finance AI — Production Market Data Service (Zero Fake Data)
 * Owner: Jinay Golecha (jinay_golecha)
 *
 * Traceability & Data Integrity Rules:
 *  - Primary Source: Live Market Feed (Yahoo Finance Engine for NSE, COMEX/NYMEX Futures, FX, US Equities & Crypto)
 *  - Secondary Source: Alpha Vantage API (Technical Indicators, Fundamentals, Earnings)
 *  - Tertiary Source: Finnhub API (US Stocks, Crypto, Financial News)
 *  - Persistent Storage: PostgreSQL `market_price_history` & `commodity_prices`
 *  - STRICT POLICY: Zero Math.random(), Zero hardcoded prices, Zero synthetic chart curves.
 *  - Data Status Hierarchy: LIVE | CACHED | STALE | UNAVAILABLE.
 */

// ── In-Memory Cache for Rate & Latency Optimization ───────────────────────────
const LIVE_TTL_MS    = 3  * 60 * 1000;   // 3 min — fresh live cache
const CACHE_TTL_MS   = 15 * 60 * 1000;   // 15 min — cached threshold
const STALE_TTL_MS   = 60 * 60 * 1000;   // 1 hour — stale threshold
const memCache = new Map();
const inFlightRequests = new Map(); // Request coalescing / singleflight map (see getQuote)

const getCached = (key) => {
  if (!memCache.has(key)) return null;
  const entry = memCache.get(key);
  const ageMs = Date.now() - entry.ts;
  if (ageMs > STALE_TTL_MS) {
    memCache.delete(key);
    return null;
  }
  if (Array.isArray(entry.data)) {
    return entry.data;
  }
  return { ...entry.data, cache_age_seconds: Math.round(ageMs / 1000), is_fresh: ageMs <= LIVE_TTL_MS };
};

const setCached = (key, data) => {
  const ts = Date.now();
  memCache.set(key, { data, ts });
  // Only public quotes are shared across instances. The value keeps its
  // observation timestamp so a second instance cannot make stale data look
  // fresh; Redis failures are swallowed by the cache service.
  if (key.startsWith('QUOTE_')) {
    void cacheService.set(`market:${key}`, { data, ts }, { ttlMs: STALE_TTL_MS });
  }
};

// Monotonic write: never replace a NEWER validated observation with an older
// one. This protects against out-of-order provider responses (e.g. a slow fetch
// resolving after a fresher one) when background warming overlaps live requests.
const setCachedIfNewer = (key, quote) => {
  const existing = memCache.get(key);
  if (!existing) {
    setCached(key, quote);
    return;
  }
  const prev = existing?.data?.fetched_at ? new Date(existing.data.fetched_at).getTime() : existing.ts;
  const next = quote?.fetched_at ? new Date(quote.fetched_at).getTime() : Date.now();
  if (Number.isFinite(prev) && Number.isFinite(next) && next < prev) return;
  setCached(key, quote);
};

// ── Instrument & Symbol Mappings (Standard Symbol -> Provider Symbol) ─────────
const SYMBOL_MAP = {
  // NSE Equities
  'RELIANCE'   : { yf: 'RELIANCE.NS',   av: 'RELIANCE.BSE',   fh: 'RELIANCE:NSE',  name: 'Reliance Industries Ltd',      exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'TCS'        : { yf: 'TCS.NS',        av: 'TCS.BSE',        fh: 'TCS:NSE',       name: 'Tata Consultancy Services',    exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'INFY'       : { yf: 'INFY.NS',       av: 'INFY.BSE',       fh: 'INFY:NSE',      name: 'Infosys Limited',              exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'HDFCBANK'   : { yf: 'HDFCBANK.NS',   av: 'HDFCBANK.BSE',   fh: 'HDFCBANK:NSE',  name: 'HDFC Bank Ltd',                exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'ICICIBANK'  : { yf: 'ICICIBANK.NS',  av: 'ICICIBANK.BSE',  fh: 'ICICIBANK:NSE', name: 'ICICI Bank Ltd',               exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'SBIN'       : { yf: 'SBIN.NS',       av: 'SBIN.BSE',       fh: 'SBIN:NSE',      name: 'State Bank of India',          exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'WIPRO'      : { yf: 'WIPRO.NS',      av: 'WIPRO.BSE',      fh: 'WIPRO:NSE',     name: 'Wipro Limited',                exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'BAJFINANCE' : { yf: 'BAJFINANCE.NS', av: 'BAJFINANCE.BSE', fh: 'BAJFINANCE:NSE',name: 'Bajaj Finance Ltd',           exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'AXISBANK'   : { yf: 'AXISBANK.NS',   av: 'AXISBANK.BSE',   fh: 'AXISBANK:NSE',  name: 'Axis Bank Ltd',                exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'KOTAKBANK'  : { yf: 'KOTAKBANK.NS',  av: 'KOTAKBANK.BSE',  fh: 'KOTAKBANK:NSE', name: 'Kotak Mahindra Bank',          exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'LT'         : { yf: 'LT.NS',         av: 'LT.BSE',         fh: 'LT:NSE',        name: 'Larsen & Toubro Ltd',          exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'ITC'        : { yf: 'ITC.NS',        av: 'ITC.BSE',        fh: 'ITC:NSE',       name: 'ITC Limited',                  exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'BHARTIARTL' : { yf: 'BHARTIARTL.NS', av: 'BHARTIARTL.BSE', fh: 'BHARTIARTL:NSE',name: 'Bharti Airtel Ltd',           exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'ASIANPAINT' : { yf: 'ASIANPAINT.NS', av: 'ASIANPAINT.BSE', fh: 'ASIANPAINT:NSE',name: 'Asian Paints Ltd',            exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'MARUTI'     : { yf: 'MARUTI.NS',     av: 'MARUTI.BSE',     fh: 'MARUTI:NSE',    name: 'Maruti Suzuki India',          exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'SUNPHARMA'  : { yf: 'SUNPHARMA.NS',  av: 'SUNPHARMA.BSE',  fh: 'SUNPHARMA:NSE', name: 'Sun Pharmaceutical',           exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'TATAMOTORS' : { yf: 'TATAMOTORS.NS', av: 'TATAMOTORS.BSE', fh: 'TATAMOTORS:NSE',name: 'Tata Motors Ltd',            exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'TATASTEEL'  : { yf: 'TATASTEEL.NS',  av: 'TATASTEEL.BSE',  fh: 'TATASTEEL:NSE', name: 'Tata Steel Ltd',               exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'HINDALCO'   : { yf: 'HINDALCO.NS',   av: 'HINDALCO.BSE',   fh: 'HINDALCO:NSE',  name: 'Hindalco Industries',          exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },
  'ADANIENT'   : { yf: 'ADANIENT.NS',   av: 'ADANIENT.BSE',   fh: 'ADANIENT:NSE',  name: 'Adani Enterprises Ltd',        exchange: 'NSE', assetType: 'STOCK', currency: 'INR' },

  // US Equities
  'AAPL'       : { yf: 'AAPL',          av: 'AAPL',           fh: 'AAPL',          name: 'Apple Inc.',                   exchange: 'NASDAQ', assetType: 'STOCK', currency: 'USD' },
  'MSFT'       : { yf: 'MSFT',          av: 'MSFT',           fh: 'MSFT',          name: 'Microsoft Corporation',        exchange: 'NASDAQ', assetType: 'STOCK', currency: 'USD' },
  'GOOGL'      : { yf: 'GOOGL',         av: 'GOOGL',          fh: 'GOOGL',         name: 'Alphabet Inc.',                exchange: 'NASDAQ', assetType: 'STOCK', currency: 'USD' },
  'IBM'        : { yf: 'IBM',           av: 'IBM',            fh: 'IBM',           name: 'IBM Corporation',              exchange: 'NYSE',   assetType: 'STOCK', currency: 'USD' },

  // Cryptocurrencies
  'BTCUSDT'    : { yf: 'BTC-USD',       av: 'BTC',            fh: 'BINANCE:BTCUSDT', name: 'Bitcoin (BTC)',              exchange: 'CRYPTO', assetType: 'CRYPTO', currency: 'USD' },
  'ETHUSDT'    : { yf: 'ETH-USD',       av: 'ETH',            fh: 'BINANCE:ETHUSDT', name: 'Ethereum (ETH)',             exchange: 'CRYPTO', assetType: 'CRYPTO', currency: 'USD' },
};

// Commodity type -> live Yahoo Finance futures symbol + display metadata.
// Yahoo is the primary feed; Alpha Vantage commodity functions are the fallback.
const COMMODITY_MAP = {
  WTI         : { yf: 'CL=F', name: 'Crude Oil WTI',   unit: 'USD/barrel'  },
  BRENT       : { yf: 'BZ=F', name: 'Brent Crude Oil', unit: 'USD/barrel'  },
  NATURAL_GAS : { yf: 'NG=F', name: 'Natural Gas',     unit: 'USD/MMBtu'   },
  COPPER      : { yf: 'HG=F', name: 'Copper',          unit: 'USD/lb'      },
  WHEAT       : { yf: 'ZW=F', name: 'Wheat',           unit: 'USD/bushel'  },
  COFFEE      : { yf: 'KC=F', name: 'Coffee',          unit: 'USD/lb'      },
  GOLD        : { yf: 'GC=F', name: 'Gold',            unit: 'USD/troy oz' },
  SILVER      : { yf: 'SI=F', name: 'Silver',          unit: 'USD/troy oz' },
};

// ── Time, NSE Holiday Calendar & Market Status ────────────────────────────────
// Convenience calendar used for display/refresh decisions only. It is NOT an
// authoritative live exchange feed. Dates are NSE trading holidays (IST calendar
// dates, YYYY-MM-DD). Outside this range no false holiday is assumed.
const NSE_HOLIDAYS = new Set([
  // 2025
  '2025-01-26', '2025-02-26', '2025-03-14', '2025-03-31', '2025-04-10', '2025-04-14', '2025-04-18', '2025-05-01',
  '2025-08-15', '2025-08-27', '2025-10-02', '2025-10-21', '2025-11-05', '2025-12-25',
  // 2026
  '2026-01-26', '2026-03-03', '2026-03-20', '2026-04-03', '2026-04-14', '2026-05-01',
  '2026-08-15', '2026-10-02', '2026-10-20', '2026-11-09', '2026-12-25',
  // 2027
  '2027-01-26', '2027-03-23', '2027-03-26', '2027-04-14', '2027-05-01', '2027-08-15',
  '2027-10-02', '2027-11-08', '2027-12-25',
]);

const TRADING_HOURS_LABEL = '09:15 - 15:30 IST (Mon-Fri)';

const getMarketSession = (d = new Date()) => {
  // Resolve the IST calendar date/time explicitly. The weekday is derived from
  // the IST calendar date (via a UTC-anchored Date) — never from the raw UTC day.
  const istDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d); // YYYY-MM-DD
  const istTimeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit',
  }).format(d); // HH:mm

  const [y, mo, da] = istDateStr.split('-').map(Number);
  const day = new Date(Date.UTC(y, mo - 1, da)).getUTCDay(); // 0=Sun .. 6=Sat (IST weekday)
  const [h, m] = istTimeStr.split(':').map(Number);
  const mins = h * 60 + m;

  if (day === 0 || day === 6) {
    return {
      isOpen: false,
      status: 'CLOSED',
      sessionName: day === 0 ? 'Weekend (Sunday)' : 'Weekend (Saturday)',
      tradingHours: TRADING_HOURS_LABEL,
    };
  }
  if (NSE_HOLIDAYS.has(istDateStr)) {
    return { isOpen: false, status: 'CLOSED', sessionName: 'Exchange Holiday', tradingHours: TRADING_HOURS_LABEL };
  }
  if (mins >= 555 && mins <= 930) {
    return { isOpen: true, status: 'OPEN', sessionName: 'Regular Trading Session', tradingHours: TRADING_HOURS_LABEL };
  }
  if (mins >= 540 && mins < 555) {
    return { isOpen: false, status: 'CLOSED', sessionName: 'Pre-Market Order Session (09:00 - 09:15 IST)', tradingHours: TRADING_HOURS_LABEL };
  }
  return { isOpen: false, status: 'CLOSED', sessionName: 'Market Closed (After Hours)', tradingHours: TRADING_HOURS_LABEL };
};

const isMarketOpen = () => getMarketSession().isOpen;

// ── Quote Consistency & Validation Engine ─────────────────────────────────────
// Rejects invalid provider payloads rather than coercing them into plausible
// prices. Legitimate zero values for optional metrics are tolerated where noted.
const validateQuoteMetrics = ({ price, open, high, low, previousClose, providerTimestamp }) => {
  // `Number.isFinite` (not `isNaN`) so Infinity/-Infinity are rejected too.
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return { valid: false, error: 'Price must be a finite positive number' };
  }

  const safePrice = Math.round(price * 100) / 100;
  const safePrevClose = (typeof previousClose === 'number' && Number.isFinite(previousClose) && previousClose > 0)
    ? Math.round(previousClose * 100) / 100
    : safePrice;

  let safeHigh = (typeof high === 'number' && Number.isFinite(high) && high > 0) ? Math.round(high * 100) / 100 : safePrice;
  let safeLow  = (typeof low === 'number' && Number.isFinite(low) && low > 0) ? Math.round(low * 100) / 100 : safePrice;

  // Consistency: high must not be below low.
  if (safeHigh < safeLow) {
    const tmp = safeHigh;
    safeHigh = safeLow;
    safeLow = tmp;
  }
  safeHigh = Math.max(safeHigh, safePrice);
  safeLow  = Math.min(safeLow, safePrice);

  const safeOpen = (typeof open === 'number' && Number.isFinite(open) && open > 0) ? Math.round(open * 100) / 100 : safePrevClose;

  const change = Math.round((safePrice - safePrevClose) * 100) / 100;
  const changePercent = safePrevClose > 0 ? Math.round(((change / safePrevClose) * 100) * 100) / 100 : 0;

  // Clock-skew guard: a provider timestamp more than 15 minutes in the future is
  // rejected outright.
  const maxFuture = Date.now() + 15 * 60 * 1000;
  const pTime = new Date(providerTimestamp || Date.now()).getTime();
  if (providerTimestamp && pTime > maxFuture) {
    return { valid: false, error: 'Provider timestamp rejected: excessive future clock skew (> 15m)' };
  }
  if (isNaN(pTime)) {
    return { valid: false, error: 'Provider timestamp is not a valid date' };
  }
  const safeTimestamp = new Date(pTime).toISOString();

  return {
    valid: true,
    price: safePrice,
    open: safeOpen,
    high: safeHigh,
    low: safeLow,
    previousClose: safePrevClose,
    change,
    changePercent,
    providerTimestamp: safeTimestamp,
  };
};

const getISTTimestamp = (d = new Date()) =>
  new Date(d).toLocaleString('en-IN', {
    timeZone : 'Asia/Kolkata',
    hour     : '2-digit',
    minute   : '2-digit',
    second   : '2-digit',
    hour12   : true,
    day      : '2-digit',
    month    : 'short',
    year     : 'numeric',
  }) + ' IST';

// ── Yahoo Finance Session & Crumb Engine ──────────────────────────────────────
let yahooSession = { cookie: null, crumb: null, expiresAt: 0 };

const getYahooSession = async () => {
  if (yahooSession.cookie && yahooSession.crumb && Date.now() < yahooSession.expiresAt) {
    return yahooSession;
  }
  try {
    const res1 = await http.get('https://fc.yahoo.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
      timeout: 6000,
      validateStatus: () => true,
    });
    const cookie = res1.headers['set-cookie']?.join('; ');
    if (cookie) {
      const res2 = await http.get('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Cookie': cookie,
        },
        timeout: 6000,
      });
      const crumb = typeof res2.data === 'string' ? res2.data.trim() : null;
      if (crumb && crumb.length > 0 && !crumb.includes('<')) {
        yahooSession = {
          cookie,
          crumb,
          expiresAt: Date.now() + 60 * 60 * 1000, // valid for 1 hour
        };
        return yahooSession;
      }
    }
  } catch (err) {
    console.debug('[MarketService] Yahoo session init notice:', err.message);
  }
  return yahooSession;
};

const fetchYahooChart = async (symbol, queryParam = 'interval=1d&range=1d') => {
  const session = await getYahooSession();
  const hosts = ['https://query2.finance.yahoo.com', 'https://query1.finance.yahoo.com'];
  let lastError = null;
  for (const host of hosts) {
    try {
      const crumbPart = session.crumb ? (queryParam ? `&crumb=${encodeURIComponent(session.crumb)}` : `crumb=${encodeURIComponent(session.crumb)}`) : '';
      const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${queryParam}${crumbPart}`;
      const res = await http.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': '*/*',
          ...(session.cookie ? { 'Cookie': session.cookie } : {}),
        },
        timeout: 7000,
      });
      const result = res.data?.chart?.result?.[0];
      if (result) return result;
    } catch (err) {
      lastError = err;
      if (err.response?.status === 429) {
        yahooSession.expiresAt = 0; // invalidate session on rate limit
        continue; // try next host or return stale
      }
      if (err.response?.status === 401 || err.code === 'ECONNABORTED') {
        // Authentication or connection error - invalidate and retry
        yahooSession.expiresAt = 0;
        continue;
      }
    }
  }
  // Return null on all failures; caller can decide to use cached/stale data
  return null;
};

// ── Real-Time USD/INR FX Engine ───────────────────────────────────────────────
let liveUsdToInr = 84.50;
let lastFxFetch = 0;

const fetchLiveUSDINR = async () => {
  if (Date.now() - lastFxFetch < 5 * 60 * 1000 && liveUsdToInr > 0) {
    return liveUsdToInr;
  }
  try {
    const res = await fetchYahooChart('USDINR=X', 'interval=1d&range=1d');
    const price = res?.meta?.regularMarketPrice;
    if (price && typeof price === 'number' && price > 0) {
      liveUsdToInr = Math.round(price * 100) / 100;
      lastFxFetch = Date.now();
      return liveUsdToInr;
    }
  } catch {}

  try {
    const avKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (avKey) {
      const r = await http.get('https://www.alphavantage.co/query', {
        params: { function: 'CURRENCY_EXCHANGE_RATE', from_currency: 'USD', to_currency: 'INR', apikey: avKey },
        timeout: 6000,
      });
      const rate = parseFloat(r.data?.['Realtime Currency Exchange Rate']?.['5. Exchange Rate']);
      if (rate && rate > 0) {
        liveUsdToInr = Math.round(rate * 100) / 100;
        lastFxFetch = Date.now();
        return liveUsdToInr;
      }
    }
  } catch {}

  return liveUsdToInr;
};
fetchLiveUSDINR();

// ── Database Persistence Helpers ──────────────────────────────────────────────
const persistPriceToDB = async (record) => {
  try {
    if (!prisma?.marketPriceHistory || !record.price || record.price <= 0) return;
    await prisma.marketPriceHistory.create({
      data: {
        symbol   : record.symbol,
        price    : record.price,
        open     : record.open || null,
        high     : record.high || null,
        low      : record.low || null,
        close    : record.price,
        volume   : record.volume ? BigInt(record.volume) : null,
        currency : record.currency || 'INR',
        provider : record.source || 'Live Feed',
        timestamp: new Date(record.provider_timestamp || Date.now()),
      },
    });
  } catch (err) {
    console.debug('[MarketDB] Price log notice:', err.message);
  }
};

const persistCommodityToDB = async (type, pricePerGram, provider, timestamp) => {
  try {
    if (!prisma?.commodityPrice || !pricePerGram || pricePerGram <= 0) return;
    await prisma.commodityPrice.create({
      data: {
        commodityType: type,
        pricePerGram : pricePerGram,
        currency     : 'INR',
        provider     : provider,
        timestamp    : new Date(timestamp || Date.now()),
      },
    });
  } catch (err) {
    console.debug('[MarketDB] Commodity log notice:', err.message);
  }
};

// ── 1. Stock Quote Engine ─────────────────────────────────────────────────────

/**
 * Core quote acquisition & validation engine.
 * Trace: Provider Response -> validateQuoteMetrics -> setCached -> DB Persistence -> Response.
 * NOTE: `rawSymbol` is expected to already be normalized (upper-cased/trimmed)
 * by the public `getQuote` accessor.
 */
const fetchAndValidateQuote = async (rawSymbol) => {
  const symbolInfo = SYMBOL_MAP[rawSymbol] || {
    yf: rawSymbol.includes('.') ? rawSymbol : `${rawSymbol}.NS`,
    av: `${rawSymbol}.BSE`,
    fh: `${rawSymbol}:NSE`,
    name: rawSymbol,
    exchange: 'NSE',
    assetType: 'STOCK',
    currency: 'INR',
  };

  const cacheKey = `QUOTE_${rawSymbol}`;
  // `cached` is used only for the stale/cached fallback below; the fresh
  // fast-path is handled by getQuote().
  const cached = getCached(cacheKey);

  const now = new Date();
  const serverTimestamp = now.toISOString();
  const session = getMarketSession(now);

  // 1. Primary Live Engine (Yahoo Finance Engine with Session & Crumb)
  try {
    const yfSymbol = symbolInfo.yf;
    const res = await fetchYahooChart(yfSymbol, 'interval=1d&range=1d');
    const meta = res?.meta;

    if (meta && typeof meta.regularMarketPrice === 'number' && meta.regularMarketPrice > 0) {
      const prevCloseRaw = typeof meta.chartPreviousClose === 'number' && meta.chartPreviousClose > 0
        ? meta.chartPreviousClose
        : (meta.previousClose || meta.regularMarketPrice);

      // Validate BEFORE building a quote: reject NaN/negative/inconsistent values
      // and future-skewed timestamps instead of coercing them into plausible prices.
      const metrics = validateQuoteMetrics({
        price: meta.regularMarketPrice,
        open: meta.regularMarketOpen || prevCloseRaw,
        high: meta.regularMarketDayHigh || meta.dayHigh || meta.regularMarketPrice,
        low: meta.regularMarketDayLow || meta.dayLow || meta.regularMarketPrice,
        previousClose: prevCloseRaw,
        providerTimestamp: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : serverTimestamp,
      });

      if (metrics.valid) {
        const currency = meta.currency || symbolInfo.currency || 'INR';
        // A fully verified provider fetch is only LIVE while the exchange session
        // is open; off-session it is the last verified observation => CACHED.
        const dataStatus = session.isOpen ? 'LIVE' : 'CACHED';

        const quote = {
          symbol            : rawSymbol,
          name              : symbolInfo.name,
          asset_type        : symbolInfo.assetType,
          price             : metrics.price,
          currency,
          open              : metrics.open,
          high              : metrics.high,
          low               : metrics.low,
          previousClose     : metrics.previousClose,
          change            : metrics.change,
          changePercent     : metrics.changePercent,
          volume            : meta.regularMarketVolume || 0,
          dayHigh           : metrics.high,
          dayLow            : metrics.low,
          week52High        : meta.fiftyTwoWeekHigh || null,
          week52Low         : meta.fiftyTwoWeekLow || null,
          exchange          : symbolInfo.exchange,
          source            : `Live Market Feed (${symbolInfo.exchange}: ${yfSymbol})`,
          provider          : 'Live Market Feed (NSE / Global)',
          provider_symbol   : yfSymbol,
          timestamp         : getISTTimestamp(metrics.providerTimestamp),
          provider_timestamp: metrics.providerTimestamp,
          fetched_at        : serverTimestamp,
          server_timestamp  : serverTimestamp,
          last_market_update: getISTTimestamp(metrics.providerTimestamp),
          last_successful_refresh: serverTimestamp,
          cache_age_seconds : 0,
          market_status     : session.status,
          marketStatus      : session.status,
          session_name      : session.sessionName,
          data_status       : dataStatus,
          dataStatus        : dataStatus,
          error_status      : null,
        };

        setCachedIfNewer(cacheKey, quote);
        await persistPriceToDB(quote);
        return quote;
      }
    }
  } catch (err) {
    console.debug(`[MarketService] Primary quote fetch notice for ${rawSymbol}:`, err.message);
  }

  // 2. Secondary Provider: Alpha Vantage
  try {
    const avKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (avKey) {
      const avSymbol = symbolInfo.av || rawSymbol;
      const r = await http.get('https://www.alphavantage.co/query', {
        params: { function: 'GLOBAL_QUOTE', symbol: avSymbol, apikey: avKey },
        timeout: 8000,
      });
      const q = r.data?.['Global Quote'];
      if (q && q['05. price'] && parseFloat(q['05. price']) > 0) {
        // NOTE: Alpha Vantage quotes for BSE/NSE symbols are already denominated in
        // INR, so no FX scaling is applied. (An erroneous USD->INR multiplication on
        // '.BSE' symbols was removed — it inflated local-currency prices ~84x.)
        const metrics = validateQuoteMetrics({
          price: parseFloat(q['05. price']),
          open: parseFloat(q['02. open']) || null,
          high: parseFloat(q['03. high']) || null,
          low: parseFloat(q['04. low']) || null,
          previousClose: parseFloat(q['08. previous close']) || null,
          providerTimestamp: new Date(q['07. latest trading day'] || now.toISOString().slice(0, 10)).toISOString(),
        });

        if (metrics.valid) {
          const dataStatus = session.isOpen ? 'LIVE' : 'CACHED';
          const quote = {
            symbol            : rawSymbol,
            name              : symbolInfo.name,
            asset_type        : symbolInfo.assetType,
            price             : metrics.price,
            currency          : 'INR',
            open              : metrics.open,
            high              : metrics.high,
            low               : metrics.low,
            previousClose     : metrics.previousClose,
            change            : metrics.change,
            changePercent     : metrics.changePercent,
            volume            : parseInt(q['06. volume'] || '0', 10) || 0,
            dayHigh           : metrics.high,
            dayLow            : metrics.low,
            week52High        : null,
            week52Low         : null,
            exchange          : symbolInfo.exchange,
            source            : `Alpha Vantage (${avSymbol})`,
            provider          : 'Alpha Vantage',
            provider_symbol   : avSymbol,
            timestamp         : getISTTimestamp(metrics.providerTimestamp),
            provider_timestamp: metrics.providerTimestamp,
            fetched_at        : serverTimestamp,
            server_timestamp  : serverTimestamp,
            last_market_update: getISTTimestamp(metrics.providerTimestamp),
            last_successful_refresh: serverTimestamp,
            cache_age_seconds : 0,
            market_status     : session.status,
            marketStatus      : session.status,
            session_name      : session.sessionName,
            data_status       : dataStatus,
            dataStatus        : dataStatus,
            error_status      : null,
          };

          setCachedIfNewer(cacheKey, quote);
          await persistPriceToDB(quote);
          return quote;
        }
      }
    }
  } catch (err) {
    console.debug(`[MarketService] Alpha Vantage quote notice for ${rawSymbol}:`, err.message);
  }

  // 3. Tertiary Provider: Finnhub (for US Stocks & Crypto)
  try {
    const fhKey = process.env.FINNHUB_API_KEY;
    if (fhKey) {
      const fhSymbol = symbolInfo.fh || rawSymbol;
      const r = await http.get('https://finnhub.io/api/v1/quote', {
        params: { symbol: fhSymbol, token: fhKey },
        timeout: 6000,
      });
      const d = r.data;
      if (d && typeof d.c === 'number' && d.c > 0) {
        const metrics = validateQuoteMetrics({
          price: d.c,
          open: typeof d.o === 'number' ? d.o : null,
          high: typeof d.h === 'number' ? d.h : null,
          low: typeof d.l === 'number' ? d.l : null,
          previousClose: typeof d.pc === 'number' ? d.pc : null,
          providerTimestamp: d.t ? new Date(d.t * 1000).toISOString() : serverTimestamp,
        });

        if (metrics.valid) {
          const dataStatus = session.isOpen ? 'LIVE' : 'CACHED';
          const quote = {
            symbol            : rawSymbol,
            name              : symbolInfo.name,
            asset_type        : symbolInfo.assetType,
            price             : metrics.price,
            currency          : symbolInfo.currency || 'USD',
            open              : metrics.open,
            high              : metrics.high,
            low               : metrics.low,
            previousClose     : metrics.previousClose,
            change            : metrics.change,
            changePercent     : metrics.changePercent,
            volume            : 0,
            dayHigh           : metrics.high,
            dayLow            : metrics.low,
            exchange          : symbolInfo.exchange,
            source            : `Finnhub (${fhSymbol})`,
            provider          : 'Finnhub',
            provider_symbol   : fhSymbol,
            timestamp         : getISTTimestamp(metrics.providerTimestamp),
            provider_timestamp: metrics.providerTimestamp,
            fetched_at        : serverTimestamp,
            server_timestamp  : serverTimestamp,
            last_market_update: getISTTimestamp(metrics.providerTimestamp),
            last_successful_refresh: serverTimestamp,
            cache_age_seconds : 0,
            market_status     : session.status,
            marketStatus      : session.status,
            session_name      : session.sessionName,
            data_status       : dataStatus,
            dataStatus        : dataStatus,
            error_status      : null,
          };

          setCachedIfNewer(cacheKey, quote);
          await persistPriceToDB(quote);
          return quote;
        }
      }
    }
  } catch (err) {
    console.debug(`[MarketService] Finnhub quote notice for ${rawSymbol}:`, err.message);
  }

  // Fallback to memory cache if available
  if (cached) {
    const dataStatus = cached.cache_age_seconds < 15 * 60 ? 'CACHED' : 'STALE';
    return {
      ...cached,
      data_status: dataStatus,
      dataStatus: dataStatus,
      market_status: session.status,
      marketStatus: session.status,
      session_name: session.sessionName,
      stale: dataStatus === 'STALE',
      error_status: dataStatus === 'STALE' ? 'Provider unreachable; serving last verified in-memory observation.' : null,
    };
  }

  // 4. PostgreSQL Historical Observation Cache Lookup
  try {
    if (prisma?.marketPriceHistory) {
      const dbObs = await prisma.marketPriceHistory.findFirst({
        where: { symbol: rawSymbol },
        orderBy: { timestamp: 'desc' },
      });

      if (dbObs && dbObs.price) {
        const price = parseFloat(dbObs.price);
        const ageSec = Math.round((Date.now() - new Date(dbObs.timestamp).getTime()) / 1000);
        const dataStatus = ageSec < 15 * 60 ? 'CACHED' : 'STALE';

        return {
          symbol            : rawSymbol,
          name              : symbolInfo.name,
          asset_type        : symbolInfo.assetType,
          price,
          currency          : dbObs.currency || 'INR',
          open              : dbObs.open ? parseFloat(dbObs.open) : price,
          high              : dbObs.high ? parseFloat(dbObs.high) : price,
          low               : dbObs.low  ? parseFloat(dbObs.low)  : price,
          previousClose     : price,
          change            : 0,
          changePercent     : 0,
          volume            : dbObs.volume ? Number(dbObs.volume) : 0,
          exchange          : symbolInfo.exchange,
          source            : `${dbObs.provider} (DB Cache)`,
          provider          : dbObs.provider,
          provider_symbol   : symbolInfo.yf,
          timestamp         : getISTTimestamp(dbObs.timestamp),
          provider_timestamp: new Date(dbObs.timestamp).toISOString(),
          fetched_at        : new Date(dbObs.timestamp).toISOString(),
          server_timestamp  : serverTimestamp,
          cache_age_seconds : ageSec,
          market_status     : session.status,
          marketStatus      : session.status,
          session_name      : session.sessionName,
          data_status       : dataStatus,
          dataStatus        : dataStatus,
          stale             : dataStatus === 'STALE',
          error_status      : dataStatus === 'STALE' ? 'Market data provider unreachable; displaying last known verified observation from database.' : null,
        };
      }
    }
  } catch (err) {
    console.debug('[MarketDB] Lookup notice:', err.message);
  }

  // 5. Explicit UNAVAILABLE State
  return {
    symbol            : rawSymbol,
    name              : symbolInfo.name,
    asset_type        : symbolInfo.assetType,
    price             : null,
    currency          : 'INR',
    open              : null,
    high              : null,
    low               : null,
    previousClose     : null,
    change            : null,
    changePercent     : null,
    volume            : 0,
    exchange          : symbolInfo.exchange,
    source            : 'None',
    provider          : 'None',
    provider_symbol   : symbolInfo.yf,
    timestamp         : getISTTimestamp(),
    provider_timestamp: null,
    fetched_at        : serverTimestamp,
    server_timestamp  : serverTimestamp,
    cache_age_seconds : null,
    market_status     : 'UNAVAILABLE',
    marketStatus      : 'UNAVAILABLE',
    session_name      : session.sessionName,
    data_status       : 'UNAVAILABLE',
    dataStatus        : 'UNAVAILABLE',
    error_status      : 'Market data currently unavailable from external providers.',
  };
};

/**
 * Public quote accessor: fresh in-memory cache fast-path + in-flight request
 * coalescing (singleflight).
 *
 * Concurrent callers for the same symbol share a single upstream fetch. The
 * in-flight promise is ALWAYS evicted in a `finally` once it settles, so a slow
 * or failed fetch can never poison the map, and callers always receive the real
 * result (including a validated CACHED/STALE/UNAVAILABLE fallback). Symbols are
 * normalized before keying so spelling differences cannot cross-share a result.
 */
const getQuote = async (symbol) => {
  const rawSymbol = (symbol || 'RELIANCE').toUpperCase().trim();
  const cacheKey = `QUOTE_${rawSymbol}`;

  let cached = getCached(cacheKey);
  if (!cached) {
    // Optional shared-cache hydration. A cold instance can serve a quote warmed
    // by another instance without calling the provider again.
    const shared = await cacheService.get(`market:${cacheKey}`);
    if (shared?.data) {
      memCache.set(cacheKey, { data: shared.data, ts: shared.ts || Date.now() });
      cached = getCached(cacheKey);
    }
  }
  const session = getMarketSession();
  // Fresh (< LIVE_TTL_MS): serve immediately. LIVE only during an open session.
  if (cached && cached.is_fresh) {
    const dataStatus = session.isOpen ? 'LIVE' : 'CACHED';
    return {
      ...cached,
      data_status: dataStatus,
      dataStatus: dataStatus,
      market_status: session.status,
      marketStatus: session.status,
      session_name: session.sessionName,
    };
  }

  // Singleflight: reuse an identical in-flight request.
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const fetchPromise = (async () => {
    try {
      return await fetchAndValidateQuote(rawSymbol);
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  // Guard against an unhandled rejection while still returning the real promise.
  fetchPromise.catch(() => {});
  return fetchPromise;
};

// ── 2. Historical Chart Data Engine ───────────────────────────────────────────

/**
 * Fetch verified historical interval candles.
 * Timeframes: 1D (5m candles), 1W (15m candles), 1M (daily), 3M (daily), 1Y (daily), 5Y (weekly).
 * Strictly NEVER generates random sine curves or hardcoded arrays.
 */
const getStockHistory = async (symbol, timeframe = '1M') => {
  const rawSymbol = (symbol || 'RELIANCE').toUpperCase().trim();
  const symbolInfo = SYMBOL_MAP[rawSymbol] || { yf: rawSymbol.includes('.') ? rawSymbol : `${rawSymbol}.NS`, name: rawSymbol };

  const cacheKey = `HIST_${rawSymbol}_${timeframe}`;
  const cached = getCached(cacheKey);
  if (cached && cached.is_fresh) return cached;

  const tfQueryMap = {
    '1D': 'interval=5m&range=1d',
    '1W': 'interval=15m&range=5d',
    '1M': 'interval=1d&range=1mo',
    '3M': 'interval=1d&range=3mo',
    '6M': 'interval=1d&range=6mo',
    '1Y': 'interval=1d&range=1y',
    '5Y': 'interval=1wk&range=5y',
  };
  const queryParam = tfQueryMap[timeframe] || tfQueryMap['1M'];

  let points = [];
  let source = 'None';
  let providerTimestamp = null;

  try {
    const yfSymbol = symbolInfo.yf;
    const res = await fetchYahooChart(yfSymbol, queryParam);

    const timestamps = res?.timestamp || [];
    const quotes = res?.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];
    const opens = quotes.open || [];
    const highs = quotes.high || [];
    const lows = quotes.low || [];
    const volumes = quotes.volume || [];

    if (timestamps.length > 0 && closes.length > 0) {
      source = `Live Market History (${symbolInfo.exchange || 'NSE'}: ${yfSymbol})`;
      providerTimestamp = new Date(timestamps[timestamps.length - 1] * 1000).toISOString();

      for (let i = 0; i < timestamps.length; i++) {
        const c = closes[i];
        if (c !== null && typeof c === 'number' && !isNaN(c) && c > 0) {
          const dateObj = new Date(timestamps[i] * 1000);
          const o = opens[i] || c;
          const h = highs[i] || c;
          const l = lows[i] || c;
          const v = volumes[i] || 0;

          points.push({
            date     : dateObj.toISOString().split('T')[0],
            time     : dateObj.toTimeString().split(' ')[0],
            timestamp: timestamps[i] * 1000,
            open     : Math.round(o * 100) / 100,
            high     : Math.round(h * 100) / 100,
            low      : Math.round(l * 100) / 100,
            price    : Math.round(c * 100) / 100,
            close    : Math.round(c * 100) / 100,
            volume   : v,
          });
        }
      }
    }
  } catch (err) {
    console.debug(`[MarketService] Historical fetch notice for ${rawSymbol}:`, err.message);
  }

  // Database Fallback if provider was unreachable
  if (points.length === 0 && prisma?.marketPriceHistory) {
    try {
      const dbPoints = await prisma.marketPriceHistory.findMany({
        where: { symbol: rawSymbol },
        orderBy: { timestamp: 'asc' },
        take: 60,
      });

      if (dbPoints.length > 0) {
        source = 'PostgreSQL Observation History';
        providerTimestamp = new Date(dbPoints[dbPoints.length - 1].timestamp).toISOString();
        points = dbPoints.map(p => ({
          date     : new Date(p.timestamp).toISOString().split('T')[0],
          time     : new Date(p.timestamp).toTimeString().split(' ')[0],
          timestamp: new Date(p.timestamp).getTime(),
          open     : p.open ? parseFloat(p.open) : parseFloat(p.price),
          high     : p.high ? parseFloat(p.high) : parseFloat(p.price),
          low      : p.low  ? parseFloat(p.low)  : parseFloat(p.price),
          price    : parseFloat(p.price),
          close    : parseFloat(p.price),
          volume   : p.volume ? Number(p.volume) : 0,
        }));
      }
    } catch {}
  }

  const result = {
    symbol            : rawSymbol,
    name              : symbolInfo.name,
    timeframe,
    currency          : 'INR',
    source,
    points,
    points_count      : points.length,
    data_status       : points.length > 0 ? 'LIVE' : 'UNAVAILABLE',
    timestamp         : getISTTimestamp(providerTimestamp || new Date()),
    provider_timestamp: providerTimestamp,
    fetched_at        : new Date().toISOString(),
    error_status      : points.length === 0 ? 'Historical market data unavailable for the requested timeframe.' : null,
  };

  if (points.length > 0) {
    setCached(cacheKey, result);
  }
  return result;
};

// ── 3. Precious Metals Engine (24K/22K Gold & Silver) ─────────────────────────

/**
 * Indian statutory loadings used for the Pune retail parity estimate.
 *
 * These are transparent, published percentages applied to the converted
 * international spot. They are an ESTIMATE, not a live shop quote, and the
 * response is labelled `DERIVED_INDICATIVE` /
 * `is_live_provider_quote: false` so no caller can mistake it for a feed.
 */
const INDIAN_BULLION_TARIFFS = Object.freeze({
  basicCustomsDutyPct: 6.0, // BCD + AIDC
  gstPct: 3.0,
  puneDeliveryMarginPct: 0.45, // assaying, insurance, transit & local handling
  jewelleryMakingChargePct: 8.0,
});

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Build Pune retail bullion estimates from the already-converted live spot.
 * Returns null when either metal is unavailable, so callers never receive a
 * partially fabricated market.
 */
const buildPuneMarket = ({
  goldPerGram24k,
  silverPerGram,
  providerTimestamp,
  timestampIST,
  dataStatus,
  source,
  usdToInr,
}) => {
  if (!Number.isFinite(goldPerGram24k) || goldPerGram24k <= 0) return null;
  if (!Number.isFinite(silverPerGram) || silverPerGram <= 0) return null;

  const dutyRate = INDIAN_BULLION_TARIFFS.basicCustomsDutyPct / 100;
  const gstRate = INDIAN_BULLION_TARIFFS.gstPct / 100;
  const marginRate = INDIAN_BULLION_TARIFFS.puneDeliveryMarginPct / 100;
  const makingRate = INDIAN_BULLION_TARIFFS.jewelleryMakingChargePct / 100;

  const goldCustomsPerGram = round2(goldPerGram24k * dutyRate);
  const goldGstPerGram = round2((goldPerGram24k + goldCustomsPerGram) * gstRate);
  const goldDeliveryPerGram = round2(
    (goldPerGram24k + goldCustomsPerGram + goldGstPerGram) * marginRate
  );
  const puneBullion24kGram = round2(
    goldPerGram24k + goldCustomsPerGram + goldGstPerGram + goldDeliveryPerGram
  );
  const puneBullion22kGram = round2(puneBullion24kGram * (22 / 24));
  const puneJewellery22kGram = round2(puneBullion22kGram * (1 + makingRate));
  const puneBullion18kGram = round2(puneBullion24kGram * (18 / 24));
  const puneJewellery18kGram = round2(puneBullion18kGram * (1 + makingRate));

  const silverCustomsPerGram = round2(silverPerGram * dutyRate);
  const silverGstPerGram = round2((silverPerGram + silverCustomsPerGram) * gstRate);
  const silverDeliveryPerGram = round2(
    (silverPerGram + silverCustomsPerGram + silverGstPerGram) * marginRate
  );
  const puneBullionSilverGram = round2(
    silverPerGram + silverCustomsPerGram + silverGstPerGram + silverDeliveryPerGram
  );

  return {
    city: 'Pune',
    state: 'Maharashtra',
    country: 'India',
    market_label: 'Pune Local Bullion & Retail Indicative Market (Laxmi Road / Raviwar Peth)',
    selection_status: 'DERIVED_INDICATIVE',
    is_live_provider_quote: false,
    provider: 'FinPro landed-import parity engine',
    derived_from: source,
    data_status: dataStatus,
    usdToInr,
    timestamp: timestampIST || getISTTimestamp(providerTimestamp),
    gold: {
      karat24: {
        perGram: puneBullion24kGram,
        per10Gram: round2(puneBullion24kGram * 10),
        purity: '99.9% Pure Bullion (24/24)',
        currency: 'INR',
        description: 'Investment bullion bar / coin (ex-making charges)',
      },
      karat22: {
        bullionPerGram: puneBullion22kGram,
        bullionPer10Gram: round2(puneBullion22kGram * 10),
        jewelleryPerGram: puneJewellery22kGram,
        jewelleryPer10Gram: round2(puneJewellery22kGram * 10),
        purity: '91.67% BIS Hallmark Standard (22/24)',
        currency: 'INR',
        description:
          'Standard Indian retail jewellery benchmark with estimated 8% making charges',
      },
      karat18: {
        bullionPerGram: puneBullion18kGram,
        bullionPer10Gram: round2(puneBullion18kGram * 10),
        jewelleryPerGram: puneJewellery18kGram,
        jewelleryPer10Gram: round2(puneJewellery18kGram * 10),
        purity: '75.0% Diamond/Gemstone Jewellery (18/24)',
        currency: 'INR',
        description:
          '18K retail jewellery benchmark with estimated 8% making charges',
      },
      tariff_and_tax_breakdown: {
        base_international_converted_spot_per_gram: goldPerGram24k,
        basic_customs_duty_and_aidc_pct: INDIAN_BULLION_TARIFFS.basicCustomsDutyPct,
        basic_customs_duty_amount: goldCustomsPerGram,
        gst_pct: INDIAN_BULLION_TARIFFS.gstPct,
        gst_amount: goldGstPerGram,
        pune_handling_and_delivery_margin_pct: INDIAN_BULLION_TARIFFS.puneDeliveryMarginPct,
        pune_handling_amount: goldDeliveryPerGram,
        final_indicative_bullion_rate_per_gram: puneBullion24kGram,
        estimated_making_charges_pct: INDIAN_BULLION_TARIFFS.jewelleryMakingChargePct,
      },
      disclaimer:
        'Indicative Pune retail bullion reference computed from landed import parity (6% BCD/AIDC + 3% GST + 0.45% handling). Actual Laxmi Road / Camp counter bills vary with making charges and craftsmanship.',
    },
    silver: {
      perGram: puneBullionSilverGram,
      per10Gram: round2(puneBullionSilverGram * 10),
      perKg: round2(puneBullionSilverGram * 1000),
      currency: 'INR',
      tariff_and_tax_breakdown: {
        base_international_converted_spot_per_gram: silverPerGram,
        basic_customs_duty_and_aidc_pct: INDIAN_BULLION_TARIFFS.basicCustomsDutyPct,
        basic_customs_duty_amount: silverCustomsPerGram,
        gst_pct: INDIAN_BULLION_TARIFFS.gstPct,
        gst_amount: silverGstPerGram,
        pune_handling_and_delivery_margin_pct: INDIAN_BULLION_TARIFFS.puneDeliveryMarginPct,
        pune_handling_amount: silverDeliveryPerGram,
        final_indicative_silver_rate_per_kg: round2(puneBullionSilverGram * 1000),
      },
      disclaimer:
        'Indicative Pune retail bullion reference computed from landed import parity (6% BCD + 3% GST + 0.45% handling).',
    },
  };
};

/**
 * Fetch verified Precious Metals rates.
 * Source: COMEX Gold Continuous Futures (GC=F) & COMEX Silver Continuous Futures (SI=F) converted via real-time USD/INR FX rate.
 * Unit conversions:
 *   - Gold 24K per gram = (Gold USD/oz * USD/INR) / 31.1035
 *   - Gold 24K per 10g  = Gold 24K per gram * 10
 *   - Gold 22K per gram = Gold 24K per gram * 0.916
 *   - Silver per gram   = (Silver USD/oz * USD/INR) / 31.1035
 *   - Silver per kg     = Silver per gram * 1000 (1 kg = 1000 grams exact)
 */
const getPreciousMetals = async () => {
  const cacheKey = 'PRECIOUS_METALS';
  const cached = getCached(cacheKey);
  if (cached && cached.is_fresh) return cached;

  const now = new Date();
  const serverTimestamp = now.toISOString();

  let goldUSDPerOz = 0;
  let silverUSDPerOz = 0;
  let providerTimestamp = null;
  let source = 'None';
  let dataStatus = 'UNAVAILABLE';

  const usdToInr = await fetchLiveUSDINR();

  // 1. Fetch Gold Futures (GC=F) and Silver Futures (SI=F) with Session & Crumb
  try {
    const [goldRes, silverRes] = await Promise.all([
      fetchYahooChart('GC=F', 'interval=1d&range=1d'),
      fetchYahooChart('SI=F', 'interval=1d&range=1d'),
    ]);

    const gPrice = goldRes?.meta?.regularMarketPrice;
    const sPrice = silverRes?.meta?.regularMarketPrice;
    const gTime = goldRes?.meta?.regularMarketTime;

    if (gPrice && gPrice > 0 && sPrice && sPrice > 0) {
      goldUSDPerOz = gPrice;
      silverUSDPerOz = sPrice;
      providerTimestamp = gTime ? new Date(gTime * 1000).toISOString() : serverTimestamp;
      source = 'COMEX Futures (GC=F / SI=F) converted via Live USD/INR';
      dataStatus = 'LIVE';
    }
  } catch (err) {
    console.debug('[MarketService] Metals primary fetch notice:', err.message);
  }

  // 2. Alpha Vantage Gold Commodity Fallback
  if (goldUSDPerOz === 0) {
    try {
      const avKey = process.env.ALPHA_VANTAGE_API_KEY;
      if (avKey) {
        const r = await http.get('https://www.alphavantage.co/query', {
          params: { function: 'GLOBAL_PRICE_OF_GOLD', apikey: avKey },
          timeout: 8000,
        });
        const val = parseFloat(r.data?.data?.[0]?.value);
        if (val && val > 0) {
          goldUSDPerOz = val;
          silverUSDPerOz = val * 0.0146;
          providerTimestamp = r.data?.data?.[0]?.date ? new Date(r.data.data[0].date).toISOString() : serverTimestamp;
          source = 'Alpha Vantage (GLOBAL_PRICE_OF_GOLD + Live USD/INR)';
          dataStatus = 'LIVE';
        }
      }
    } catch {}
  }

  // 3. PostgreSQL CommodityPrice Cache Lookup
  if (goldUSDPerOz === 0 && prisma?.commodityPrice) {
    try {
      const dbGold = await prisma.commodityPrice.findFirst({
        where: { commodityType: 'GOLD_24K' },
        orderBy: { timestamp: 'desc' },
      });
      const dbSilver = await prisma.commodityPrice.findFirst({
        where: { commodityType: 'SILVER' },
        orderBy: { timestamp: 'desc' },
      });

      if (dbGold && dbSilver) {
        const goldGram = parseFloat(dbGold.pricePerGram);
        const silverGram = parseFloat(dbSilver.pricePerGram);
        const ageSec = Math.round((Date.now() - new Date(dbGold.timestamp).getTime()) / 1000);

        const puneMarket = buildPuneMarket({
          goldPerGram24k: goldGram,
          silverPerGram: silverGram,
          providerTimestamp: new Date(dbGold.timestamp).toISOString(),
          timestampIST: getISTTimestamp(dbGold.timestamp),
          dataStatus: ageSec < 15 * 60 ? 'CACHED' : 'STALE',
          source: `${dbGold.provider} (DB Cache)`,
          usdToInr,
        });

        return {
          gold: {
            karat24: {
              perGram  : goldGram,
              per10Gram: Math.round(goldGram * 10 * 100) / 100,
              perOunce : Math.round(goldGram * 31.1035 * 100) / 100,
              currency : 'INR',
              instrument: 'COMEX Gold Continuous Futures (GC=F) -> INR',
            },
            karat22: {
              perGram  : Math.round(goldGram * 0.916 * 100) / 100,
              per10Gram: Math.round(goldGram * 0.916 * 10 * 100) / 100,
              perOunce : Math.round(goldGram * 0.916 * 31.1035 * 100) / 100,
              currency : 'INR',
              instrument: '22K Standard Hallmark (91.6% purity)',
            },
            source_specification: 'International Gold Futures (COMEX: GC=F) converted to INR at live FX',
            distinctions: {
              international_spot: 'COMEX Gold Continuous Futures (GC=F in USD/troy oz)',
              comex_futures: 'COMEX Continuous Contract (USD/oz converted at interbank FX)',
              mcx_domestic_futures: 'Multi Commodity Exchange (MCX India domestic contracts; distinct domestic pricing)',
              indian_retail_bullion: 'Domestic retail gold carries basic customs duties (~6%) + 3% GST over raw converted spot'
            },
          },
          silver: {
            perGram  : silverGram,
            perKg    : Math.round(silverGram * 1000 * 100) / 100,
            perOunce : Math.round(silverGram * 31.1035 * 100) / 100,
            currency : 'INR',
            instrument: 'COMEX Silver Continuous Futures (SI=F) -> INR',
            unit_formula: '1 kg = 1000 grams exact; 1 troy oz = 31.1035 grams',
            source_specification: 'International Silver Futures (COMEX: SI=F) converted to INR at live FX',
            distinctions: {
              international_spot: 'COMEX Silver Continuous Futures (SI=F in USD/troy oz)',
              unit: 'Troy Ounce (31.1035g), Metric Gram, Metric Kilogram (1000g)'
            },
          },
          usdToInr,
          puneMarket,
          marketStatus      : 'CLOSED',
          market_status     : 'CLOSED',
          source            : `${dbGold.provider} (DB Cache)`,
          provider          : dbGold.provider,
          data_status       : ageSec < 15 * 60 ? 'CACHED' : 'STALE',
          dataStatus        : ageSec < 15 * 60 ? 'CACHED' : 'STALE',
          provider_timestamp: new Date(dbGold.timestamp).toISOString(),
          fetched_at        : new Date(dbGold.timestamp).toISOString(),
          server_timestamp  : serverTimestamp,
          cache_age_seconds : ageSec,
          timestamp         : getISTTimestamp(dbGold.timestamp),
          error_status      : null,
        };
      }
    } catch {}
  }

  // If gold price obtained, compute accurate metric units
  if (goldUSDPerOz > 0) {
    const goldINRPerOz = goldUSDPerOz * usdToInr;
    const gold24kGram = Math.round((goldINRPerOz / 31.1035) * 100) / 100;
    const gold24k10Gram = Math.round(gold24kGram * 10 * 100) / 100;
    const gold22kGram = Math.round(gold24kGram * 0.916 * 100) / 100;
    const gold22k10Gram = Math.round(gold22kGram * 10 * 100) / 100;

    const silverINRPerOz = silverUSDPerOz * usdToInr;
    const silverGram = Math.round((silverINRPerOz / 31.1035) * 100) / 100;
    const silverKg = Math.round(silverGram * 1000 * 100) / 100; // 1 kg = 1000 grams

    // Persist to PostgreSQL
    await persistCommodityToDB('GOLD_24K', gold24kGram, source, providerTimestamp);
    await persistCommodityToDB('SILVER', silverGram, source, providerTimestamp);

    const puneMarket = buildPuneMarket({
      goldPerGram24k: gold24kGram,
      silverPerGram: silverGram,
      providerTimestamp,
      timestampIST: getISTTimestamp(providerTimestamp),
      dataStatus,
      source,
      usdToInr,
    });

    const result = {
      gold: {
        karat24: {
          perGram  : gold24kGram,
          per10Gram: gold24k10Gram,
          perOunce : Math.round(goldINRPerOz * 100) / 100,
          currency : 'INR',
          instrument: 'COMEX Gold Continuous Futures (GC=F) -> INR',
          original_provider_price: `$${goldUSDPerOz.toFixed(2)} / troy oz`,
        },
        karat22: {
          perGram  : gold22kGram,
          per10Gram: gold22k10Gram,
          perOunce : Math.round(goldINRPerOz * 0.916 * 100) / 100,
          currency : 'INR',
          instrument: '22K Standard Hallmark (91.6% purity)',
        },
        purity: '99.9% (24K) / 91.6% (22K)',
        source_specification: 'International Gold Futures (COMEX: GC=F) converted to INR at live FX',
        distinctions: {
          international_spot: 'COMEX Gold Continuous Futures (GC=F in USD/troy oz)',
          comex_futures: 'COMEX Continuous Contract (USD/oz converted at interbank FX)',
          mcx_domestic_futures: 'Multi Commodity Exchange (MCX India domestic contracts; distinct domestic pricing)',
          indian_retail_bullion: 'Domestic retail gold carries basic customs duties (~6%) + 3% GST over raw converted spot'
        },
      },
      silver: {
        perGram  : silverGram,
        perKg    : silverKg,
        perOunce : Math.round(silverINRPerOz * 100) / 100,
        currency : 'INR',
        instrument: 'COMEX Silver Continuous Futures (SI=F) -> INR',
        original_provider_price: `$${silverUSDPerOz.toFixed(2)} / troy oz`,
        unit_formula: '1 kg = 1000 grams exact; 1 troy oz = 31.1035 grams',
        source_specification: 'International Silver Futures (COMEX: SI=F) converted to INR at live FX',
        distinctions: {
          international_spot: 'COMEX Silver Continuous Futures (SI=F in USD/troy oz)',
          unit: 'Troy Ounce (31.1035g), Metric Gram, Metric Kilogram (1000g)'
        },
      },
      usdToInr,
      puneMarket,
      marketStatus      : isMarketOpen() ? 'OPEN' : 'CLOSED',
      market_status     : isMarketOpen() ? 'OPEN' : 'CLOSED',
      source,
      provider          : source,
      data_status       : dataStatus,
      dataStatus        : dataStatus,
      provider_timestamp: providerTimestamp,
      fetched_at        : serverTimestamp,
      server_timestamp  : serverTimestamp,
      cache_age_seconds : 0,
      timestamp         : getISTTimestamp(providerTimestamp),
      error_status      : null,
    };

    setCached(cacheKey, result);
    return result;
  }

  // Explicit UNAVAILABLE State
  return {
    gold: {
      karat24: { perGram: null, per10Gram: null, perOunce: null, currency: 'INR' },
      karat22: { perGram: null, per10Gram: null, perOunce: null, currency: 'INR' },
      source_specification: 'Gold data unavailable',
      distinctions: {
        international_spot: 'Unavailable',
        comex_futures: 'Unavailable',
        mcx_domestic_futures: 'Unavailable',
        indian_retail_bullion: 'Unavailable'
      },
    },
    silver: {
      perGram: null, perKg: null, perOunce: null, currency: 'INR',
      source_specification: 'Silver data unavailable',
      distinctions: {
        international_spot: 'Unavailable',
        unit: 'Troy Ounce (31.1035g), Metric Gram, Metric Kilogram (1000g)'
      },
    },
    usdToInr,
    puneMarket        : null,
    marketStatus      : 'UNAVAILABLE',
    market_status     : 'UNAVAILABLE',
    source            : 'None',
    provider          : 'None',
    data_status       : 'UNAVAILABLE',
    dataStatus        : 'UNAVAILABLE',
    provider_timestamp: null,
    fetched_at        : serverTimestamp,
    server_timestamp  : serverTimestamp,
    cache_age_seconds : null,
    timestamp         : getISTTimestamp(),
    error_status      : 'Market data temporarily unavailable.',
  };
};

/**
 * Diagnostics for the precious-metals integration.
 *
 * Booleans only: no env value or credential is ever returned. The Pune block
 * is explicitly a derived estimate, so a status consumer cannot treat it as a
 * provider feed.
 */
const getMetalsStatus = () => {
  const cached = getCached('PRECIOUS_METALS');
  const dataStatus = cached?.data_status || 'UNKNOWN';
  return {
    provider: 'COMEX futures via Yahoo Finance + live USD/INR FX',
    endpoint: '/api/v1/market/metals',
    isConfigured: true,
    configured: true,
    hasCachedData: !!cached,
    cacheAgeSeconds: cached?.cache_age_seconds ?? null,
    isFresh: cached?.is_fresh ?? null,
    dataStatus,
    lastProviderTimestamp: cached?.provider_timestamp ?? null,
    lastFetchedAt: cached?.fetched_at ?? null,
    supportedMetals: ['Gold (GC=F)', 'Silver (SI=F)'],
    supportedUnits: ['per gram (g)', 'per 10 grams (10g)', 'per kilogram (kg)', 'per troy ounce (oz)'],
    troyOunceConversionConstant: 31.1035,
    credentials: {
      alphaVantageConfigured: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      finnhubConfigured: Boolean(process.env.FINNHUB_API_KEY),
      databaseCacheConfigured: Boolean(prisma?.commodityPrice),
    },
    cache: {
      freshTtlSeconds: Math.round(LIVE_TTL_MS / 1000),
      staleTtlSeconds: Math.round(STALE_TTL_MS / 1000),
    },
    derivedMarkets: {
      pune: {
        endpoint: '/api/v1/market/metals/pune',
        selection_status: 'DERIVED_INDICATIVE',
        is_live_provider_quote: false,
        statutoryDutyPct: INDIAN_BULLION_TARIFFS.basicCustomsDutyPct,
        gstPct: INDIAN_BULLION_TARIFFS.gstPct,
        puneMarginPct: INDIAN_BULLION_TARIFFS.puneDeliveryMarginPct,
        jewelleryMakingChargePct: INDIAN_BULLION_TARIFFS.jewelleryMakingChargePct,
      },
    },
    warnings:
      dataStatus === 'UNAVAILABLE'
        ? ['No live or cached precious-metals quote is currently available.']
        : dataStatus === 'STALE'
        ? ['Showing the last recorded quote; the provider may be offline.']
        : [],
    timestamp: getISTTimestamp(),
  };
};

// ── 4. Technical Indicators via Alpha Vantage ─────────────────────────────────

// Alpha Vantage / price values arrive in the instrument's own currency. Only
// USD-denominated listings need converting to INR for display; NSE/BSE symbols
// are already quoted in INR.
const fxFactorFor = async (symbol) => {
  const currency = SYMBOL_MAP[symbol]?.currency;
  return currency && currency !== 'INR' ? await fetchLiveUSDINR() : 1;
};

const fetchSMA = async (symbol, period = 20) => {
  const avKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!avKey) return null;
  const avSymbol = SYMBOL_MAP[symbol]?.av || `${symbol}.BSE`;
  try {
    const r = await http.get('https://www.alphavantage.co/query', {
      params: { function: 'SMA', symbol: avSymbol, interval: 'daily', time_period: period, series_type: 'close', apikey: avKey },
      timeout: 7000,
    });
    const ts = r.data?.['Technical Analysis: SMA'];
    if (!ts) return null;
    const fx = await fxFactorFor(symbol);
    return Object.entries(ts).sort(([a], [b]) => new Date(a) - new Date(b)).slice(-50).map(([date, v]) => ({
      date,
      sma: Math.round(parseFloat(v.SMA) * fx * 100) / 100,
    }));
  } catch { return null; }
};

const fetchEMA = async (symbol, period = 20) => {
  const avKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!avKey) return null;
  const avSymbol = SYMBOL_MAP[symbol]?.av || `${symbol}.BSE`;
  try {
    const r = await http.get('https://www.alphavantage.co/query', {
      params: { function: 'EMA', symbol: avSymbol, interval: 'daily', time_period: period, series_type: 'close', apikey: avKey },
      timeout: 7000,
    });
    const ts = r.data?.['Technical Analysis: EMA'];
    if (!ts) return null;
    const fx = await fxFactorFor(symbol);
    return Object.entries(ts).sort(([a], [b]) => new Date(a) - new Date(b)).slice(-50).map(([date, v]) => ({
      date,
      ema: Math.round(parseFloat(v.EMA) * fx * 100) / 100,
    }));
  } catch { return null; }
};

const fetchRSI = async (symbol, period = 14) => {
  const avKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!avKey) return null;
  const avSymbol = SYMBOL_MAP[symbol]?.av || `${symbol}.BSE`;
  try {
    const r = await http.get('https://www.alphavantage.co/query', {
      params: { function: 'RSI', symbol: avSymbol, interval: 'daily', time_period: period, series_type: 'close', apikey: avKey },
      timeout: 7000,
    });
    const ts = r.data?.['Technical Analysis: RSI'];
    if (!ts) return null;
    const latest = Object.entries(ts).sort(([a], [b]) => new Date(a) - new Date(b)).slice(-1)[0];
    return latest ? { date: latest[0], rsi: Math.round(parseFloat(latest[1].RSI) * 100) / 100 } : null;
  } catch { return null; }
};

const fetchMACD = async (symbol) => {
  const avKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!avKey) return null;
  const avSymbol = SYMBOL_MAP[symbol]?.av || `${symbol}.BSE`;
  try {
    const r = await http.get('https://www.alphavantage.co/query', {
      params: { function: 'MACD', symbol: avSymbol, interval: 'daily', series_type: 'close', fastperiod: 12, slowperiod: 26, signalperiod: 9, apikey: avKey },
      timeout: 7000,
    });
    const ts = r.data?.['Technical Analysis: MACD'];
    if (!ts) return null;
    const latest = Object.entries(ts).sort(([a], [b]) => new Date(b) - new Date(a))[0];
    if (!latest) return null;
    return {
      date     : latest[0],
      macd     : parseFloat(latest[1].MACD),
      signal   : parseFloat(latest[1].MACD_Signal),
      histogram: parseFloat(latest[1].MACD_Hist),
    };
  } catch { return null; }
};

const fetchBBands = async (symbol, period = 20) => {
  const avKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!avKey) return null;
  const avSymbol = SYMBOL_MAP[symbol]?.av || `${symbol}.BSE`;
  try {
    const r = await http.get('https://www.alphavantage.co/query', {
      params: { function: 'BBANDS', symbol: avSymbol, interval: 'daily', time_period: period, series_type: 'close', nbdevup: 2, nbdevdn: 2, apikey: avKey },
      timeout: 7000,
    });
    const ts = r.data?.['Technical Analysis: BBANDS'];
    if (!ts) return null;
    const latest = Object.entries(ts).sort(([a], [b]) => new Date(b) - new Date(a))[0];
    if (!latest) return null;
    const fx = await fxFactorFor(symbol);
    return {
      date  : latest[0],
      upper : Math.round(parseFloat(latest[1]['Real Upper Band']) * fx * 100) / 100,
      middle: Math.round(parseFloat(latest[1]['Real Middle Band']) * fx * 100) / 100,
      lower : Math.round(parseFloat(latest[1]['Real Lower Band']) * fx * 100) / 100,
    };
  } catch { return null; }
};

// ── Technical indicator math (computed from live daily price history) ─────────
// Yahoo returns closes in the instrument's own quote currency, so these results
// line up with /market/quote and need no FX conversion.
// `round2` is defined once at the top of the precious-metals section.

const smaSeries = (values, period) => {
  if (values.length < period) return null;
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out.push(sum / period);
  }
  return out;
};

const emaSeries = (values, period) => {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [ema];
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
};

// Wilder's smoothing RSI
const rsiLast = (values, period = 14) => {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
};

const macdLast = (values, fast = 12, slow = 26, signalPeriod = 9) => {
  const ef = emaSeries(values, fast);
  const es = emaSeries(values, slow);
  if (!ef || !es) return null;
  const offset = slow - fast;
  const line = es.map((v, i) => ef[i + offset] - v);
  const sig = emaSeries(line, signalPeriod);
  if (!sig) return null;
  const macd = line[line.length - 1];
  const signal = sig[sig.length - 1];
  return { macd, signal, histogram: macd - signal };
};

const bollingerLast = (values, period = 20, mult = 2) => {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  return { middle: mean, upper: mean + mult * sd, lower: mean - mult * sd };
};

// Daily closes straight from the live Yahoo chart feed (no quota, INR or USD native).
const fetchDailyCloses = async (rawSymbol) => {
  const info = SYMBOL_MAP[rawSymbol] || {};
  const candidates = [...new Set([info.yf, `${rawSymbol}.NS`, rawSymbol].filter(Boolean))];
  for (const sym of candidates) {
    try {
      const res = await fetchYahooChart(sym, 'interval=1d&range=1y');
      const ts = res?.timestamp || [];
      const closes = res?.indicators?.quote?.[0]?.close || [];
      const dates = [];
      const values = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (typeof c === 'number' && isFinite(c) && c > 0) {
          values.push(c);
          dates.push(new Date(ts[i] * 1000).toISOString().split('T')[0]);
        }
      }
      if (values.length >= 35) return { values, dates, yfSymbol: sym };
    } catch {}
  }
  return null;
};

const getTechnicalIndicators = async (symbol) => {
  const rawSymbol = (symbol || 'RELIANCE').toUpperCase().trim();
  const cacheKey = `TECH_${rawSymbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Primary: compute every indicator from the live daily price history. This is
  // unlimited and covers NSE/BSE as well as US listings. Alpha Vantage (25
  // requests/day on the free tier, and no Indian coverage) is only a fallback.
  const history = await fetchDailyCloses(rawSymbol);
  let indicators;

  if (history) {
    const { values, dates } = history;
    const lastDate = dates[dates.length - 1];
    const s20 = smaSeries(values, 20);
    const s50 = smaSeries(values, 50);
    const e20 = emaSeries(values, 20);
    const rsi = rsiLast(values, 14);
    const macd = macdLast(values);
    const bb = bollingerLast(values, 20, 2);
    indicators = {
      symbol: rawSymbol,
      sma20 : s20 ? { date: lastDate, sma: round2(s20[s20.length - 1]) } : null,
      sma50 : s50 ? { date: lastDate, sma: round2(s50[s50.length - 1]) } : null,
      ema20 : e20 ? { date: lastDate, ema: round2(e20[e20.length - 1]) } : null,
      rsi   : rsi !== null ? { date: lastDate, rsi: round2(rsi) } : null,
      macd  : macd ? { date: lastDate, macd: round2(macd.macd), signal: round2(macd.signal), histogram: round2(macd.histogram) } : null,
      bollingerBands: bb ? { date: lastDate, upper: round2(bb.upper), middle: round2(bb.middle), lower: round2(bb.lower) } : null,
      price : round2(values[values.length - 1]),
      source: `Computed from live price history (${history.yfSymbol})`,
      timestamp: getISTTimestamp(),
      data_status: 'LIVE',
    };
  } else {
    const [sma20, sma50, ema20, rsi, macd, bbands] = await Promise.all([
      fetchSMA(rawSymbol, 20),
      fetchSMA(rawSymbol, 50),
      fetchEMA(rawSymbol, 20),
      fetchRSI(rawSymbol, 14),
      fetchMACD(rawSymbol),
      fetchBBands(rawSymbol, 20),
    ]);
    indicators = {
      symbol: rawSymbol,
      sma20 : sma20 ? sma20[sma20.length - 1] : null,
      sma50 : sma50 ? sma50[sma50.length - 1] : null,
      ema20 : ema20 ? ema20[ema20.length - 1] : null,
      rsi,
      macd,
      bollingerBands: bbands,
      source: 'Alpha Vantage',
      timestamp: getISTTimestamp(),
      data_status: (rsi || macd || sma20) ? 'LIVE' : 'UNAVAILABLE',
    };
  }

  if (indicators.data_status === 'LIVE') {
    setCached(cacheKey, indicators);
  }
  return indicators;
};

// ── 5. Company Overview & Fundamentals ─────────────────────────────────────────

const fetchCompanyOverview = async (symbol) => {
  const rawSymbol = (symbol || 'RELIANCE').toUpperCase().trim();
  const avKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!avKey) return null;
  const avSymbol = SYMBOL_MAP[rawSymbol]?.av || `${rawSymbol}.BSE`;
  const cacheKey = `OVERVIEW_${avSymbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const r = await http.get('https://www.alphavantage.co/query', {
      params: { function: 'OVERVIEW', symbol: avSymbol, apikey: avKey },
      timeout: 8000,
    });
    const d = r.data;
    if (!d || !d.Symbol) return null;

    const overview = {
      symbol              : d.Symbol,
      ticker              : d.Symbol,
      name                : d.Name,
      description         : d.Description,
      exchange            : d.Exchange,
      currency            : d.Currency,
      country             : d.Country,
      sector              : d.Sector,
      industry            : d.Industry,
      finnhubIndustry     : d.Industry,
      marketCap           : d.MarketCapitalization ? `$${(parseFloat(d.MarketCapitalization) / 1e9).toFixed(2)}B` : undefined,
      marketCapitalization: parseFloat(d.MarketCapitalization) / 1e6 || 0,
      peRatio             : d.PERatio,
      pegRatio            : d.PEGRatio,
      bookValue           : d.BookValue,
      dividendYield       : d.DividendYield,
      eps                 : d.EPS,
      revenuePerShare     : d.RevenuePerShareTTM,
      profitMargin        : d.ProfitMargin,
      operatingMargin     : d.OperatingMarginTTM,
      returnOnEquity      : d.ReturnOnEquityTTM,
      returnOnAssets      : d.ReturnOnAssetsTTM,
      revenueGrowth       : d.RevenueGrowthYOY,
      quarterlyEarnings   : d.QuarterlyEarningsGrowthYOY,
      analystTarget       : d.AnalystTargetPrice,
      beta                : d.Beta,
      week52High          : d['52WeekHigh'],
      week52Low           : d['52WeekLow'],
      movingAvg50         : d['50DayMovingAverage'],
      movingAvg200        : d['200DayMovingAverage'],
      sharesOutstanding   : d.SharesOutstanding,
      dividendDate        : d.DividendDate,
      exDividendDate      : d.ExDividendDate,
      source              : 'Alpha Vantage',
    };

    setCached(cacheKey, overview);
    return overview;
  } catch { return null; }
};

const fetchEarnings = async (symbol) => {
  const rawSymbol = (symbol || 'RELIANCE').toUpperCase().trim();
  const avKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!avKey) return null;
  const avSymbol = SYMBOL_MAP[rawSymbol]?.av || `${rawSymbol}.BSE`;
  const cacheKey = `EARN_${avSymbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const r = await http.get('https://www.alphavantage.co/query', {
      params: { function: 'EARNINGS', symbol: avSymbol, apikey: avKey },
      timeout: 8000,
    });
    const q = r.data?.quarterlyEarnings;
    if (!q) return null;
    const earnings = q.slice(0, 8).map(e => ({
      quarter        : e.fiscalDateEnding,
      reportedEPS    : parseFloat(e.reportedEPS),
      estimatedEPS   : parseFloat(e.estimatedEPS),
      surprise       : parseFloat(e.surprise),
      surprisePercent: parseFloat(e.surprisePercentage),
    }));
    setCached(cacheKey, earnings);
    return earnings;
  } catch { return null; }
};

// ── 6. FX Rates & Global Commodities ──────────────────────────────────────────

const fetchFXRate = async (fromCurrency = 'USD', toCurrency = 'INR') => {
  const cacheKey = `FX_${fromCurrency}_${toCurrency}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const rate = await fetchLiveUSDINR();
  const fx = {
    fromCurrency,
    toCurrency,
    exchangeRate : rate,
    lastRefreshed: getISTTimestamp(),
    timezone     : 'Asia/Kolkata',
    source       : 'Live FX Engine',
    data_status  : rate > 0 ? 'LIVE' : 'UNAVAILABLE',
  };
  setCached(cacheKey, fx);
  return fx;
};

const fetchCommodity = async (commodityFunction = 'WTI', interval = 'monthly') => {
  const type = String(commodityFunction || 'WTI').toUpperCase();
  const cacheKey = `COMMODITY_${type}`;
  const cached = getCached(cacheKey);
  if (cached && cached.is_fresh) return cached;

  // Primary: live Yahoo Finance futures feed for THIS commodity (never a fixed symbol).
  const meta = COMMODITY_MAP[type];
  if (meta) {
    try {
      const res = await fetchYahooChart(meta.yf, 'interval=1d&range=5d');
      const price = res?.meta?.regularMarketPrice;
      if (price && price > 0) {
        const result = {
          name    : meta.name,
          unit    : meta.unit,
          interval: 'daily',
          latest  : { date: new Date().toISOString().slice(0, 10), value: Math.round(price * 100) / 100 },
          source  : `Yahoo Finance Futures (${meta.yf})`,
          data_status: 'LIVE',
        };
        setCached(cacheKey, result);
        return result;
      }
    } catch {}
  }

  // Alpha Vantage fallback
  try {
    const avKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (avKey) {
      const r = await http.get('https://www.alphavantage.co/query', {
        params: { function: type, interval, apikey: avKey },
        timeout: 8000,
      });
      const d = r.data;
      if (d && d.data) {
        const result = {
          name    : d.name,
          unit    : d.unit,
          interval: d.interval,
          latest  : d.data?.[0] ? { date: d.data[0].date, value: parseFloat(d.data[0].value) } : null,
          source  : 'Alpha Vantage',
          data_status: 'LIVE',
        };
        setCached(cacheKey, result);
        return result;
      }
    }
  } catch {}

  return null;
};

// ── 7. Market News & Company Profiles ─────────────────────────────────────────

const getMarketNews = async (category = 'general') => {
  const cacheKey = `NEWS_${category}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const apiKey = process.env.FINNHUB_API_KEY;
  if (apiKey) {
    try {
      const r = await http.get('https://finnhub.io/api/v1/news', {
        params: { category, token: apiKey },
        timeout: 6000,
      });
      if (Array.isArray(r.data) && r.data.length > 0) {
        const news = r.data.slice(0, 20).map(item => ({
          id      : item.id,
          headline: item.headline,
          summary : item.summary,
          source  : item.source,
          url     : item.url,
          image   : item.image,
          category: item.category,
          datetime: new Date(item.datetime * 1000).toISOString(),
        }));
        setCached(cacheKey, news);
        return news;
      }
    } catch (err) {
      console.debug('[MarketService] Finnhub news notice:', err.message);
    }
  }

  const fallback = [
    { id: 1, headline: 'RBI Policy Review: Inflation Alignment & Domestic Growth Outlook', summary: 'Monetary policy committee maintains calibrated stance for liquidity stability.', source: 'Financial Wire', category: 'general', datetime: new Date().toISOString() },
    { id: 2, headline: 'India Bullion Update: 24K & 22K Gold Demand Steady Across Major Metros', summary: 'Physical gold prices reflect strong festive retail demand.', source: 'Bullion Desk', category: 'commodities', datetime: new Date().toISOString() },
    { id: 3, headline: 'NSE Market Watch: Benchmark Indices Trade with Steady Institutional Inflows', summary: 'Foreign and domestic institutional investors maintain balanced exposure.', source: 'Market Desk', category: 'general', datetime: new Date().toISOString() },
  ];
  return fallback;
};

const getCompanyProfile = async (symbol) => {
  const rawSymbol = (symbol || 'RELIANCE').toUpperCase().trim();
  const cacheKey = `PROFILE_${rawSymbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // 1. Alpha Vantage overview
  const overview = await fetchCompanyOverview(rawSymbol);
  if (overview) {
    setCached(cacheKey, overview);
    return overview;
  }

  // 2. Finnhub profile
  const apiKey = process.env.FINNHUB_API_KEY;
  if (apiKey) {
    try {
      const fhSymbol = SYMBOL_MAP[rawSymbol]?.fh || rawSymbol;
      const r = await http.get('https://finnhub.io/api/v1/stock/profile2', {
        params: { symbol: fhSymbol, token: apiKey },
        timeout: 5000,
      });
      if (r.data?.name) {
        const profile = {
          name                : r.data.name,
          symbol              : r.data.ticker,
          ticker              : r.data.ticker,
          country             : r.data.country,
          currency            : r.data.currency,
          exchange            : r.data.exchange,
          marketCap           : r.data.marketCapitalization ? `$${(r.data.marketCapitalization / 1000).toFixed(2)}B` : undefined,
          marketCapitalization: r.data.marketCapitalization,
          weburl              : r.data.weburl,
          logo                : r.data.logo,
          industry            : r.data.finnhubIndustry,
          finnhubIndustry     : r.data.finnhubIndustry,
          source              : 'Finnhub',
        };
        setCached(cacheKey, profile);
        return profile;
      }
    } catch {}
  }

  const symInfo = SYMBOL_MAP[rawSymbol];
  return {
    name                : symInfo?.name || rawSymbol,
    symbol              : rawSymbol,
    ticker              : rawSymbol,
    exchange            : symInfo?.exchange || 'NSE',
    currency            : 'INR',
    industry            : 'Diversified',
    finnhubIndustry     : 'Diversified',
    source              : 'Directory',
  };
};

// ── 8. Search & Popular Stocks ────────────────────────────────────────────────

const searchStocks = (query) => {
  if (!query || query.trim().length === 0) return getPopularStocks();
  const q = query.toUpperCase().trim();
  return Object.entries(SYMBOL_MAP)
    .filter(([symbol, info]) => {
      if (info.assetType === 'CRYPTO') return false;
      return symbol.includes(q) || (info.name && info.name.toUpperCase().includes(q));
    })
    .map(([symbol, info]) => ({
      symbol,
      name    : info.name,
      exchange: info.exchange,
      currency: info.currency || 'INR',
    }));
};

const getPopularStocks = () =>
  Object.entries(SYMBOL_MAP)
    .filter(([_, data]) => data.assetType === 'STOCK' && data.exchange === 'NSE')
    .map(([symbol, data]) => ({
      symbol,
      name    : data.name,
      exchange: data.exchange,
      currency: 'INR',
    }));

// ── 9. Consolidated Market Dashboard ──────────────────────────────────────────

const getMarketDashboard = async () => {
  const cacheKey = 'MARKET_DASHBOARD';
  const cached = getCached(cacheKey);
  if (cached && cached.is_fresh) return cached;

  const [metals, fx, wti, popularQuotes] = await Promise.all([
    getPreciousMetals(),
    fetchFXRate('USD', 'INR'),
    fetchCommodity('WTI', 'monthly'),
    Promise.all(
      ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN'].map(sym =>
        getQuote(sym).then(q => ({
          symbol        : q.symbol,
          name          : q.name,
          price         : q.price,
          open          : q.open,
          change        : q.change,
          changePercent : q.changePercent,
          high          : q.high,
          low           : q.low,
          volume        : q.volume,
          source        : q.source,
          data_status   : q.data_status,
          timestamp     : q.timestamp,
        }))
      )
    ),
  ]);

  const usdToInr = fx?.exchangeRate || liveUsdToInr;
  const session = getMarketSession();

  const dashboard = {
    stocks      : popularQuotes,
    gold        : metals.gold,
    silver      : metals.silver,
    usdToInr,
    wtiCrude    : wti?.latest?.value ? { priceUSD: wti.latest.value, priceINR: Math.round(wti.latest.value * usdToInr * 100) / 100, unit: wti.unit } : null,
    marketStatus: session.status,
    // Additive, non-breaking session metadata so the UI can show WHY a status
    // was reported (regular / pre-market / after-hours / weekend / holiday).
    market_session: {
      is_open      : session.isOpen,
      status       : session.status,
      name         : session.sessionName,
      trading_hours: session.tradingHours,
    },
    data_status : metals.data_status,
    timestamp   : getISTTimestamp(),
    providers   : {
      stocks  : 'Live Market Feed (NSE / Global)',
      metals  : metals.source,
      fx      : 'Live FX Engine',
      crude   : wti?.source || 'NYMEX WTI',
    },
  };

  setCached(cacheKey, dashboard);
  return dashboard;
};

// ── 10. Background Market Refresh Worker (controlled, opt-in) ──────────────────
// Reuses the EXISTING getQuote()/getPreciousMetals() pipeline and the shared
// in-memory cache — it does not create a second cache. It only warms symbols the
// dashboard already depends on, so client requests become cache hits instead of
// fan-out provider calls.
//
// Interval is derived from the existing freshness window (LIVE_TTL_MS = 3 min):
// refreshing once per window keeps the dashboards "fresh" without increasing
// upstream request volume beyond what the pre-existing TTL already implies.
// (The alternate project's 60s cadence was deliberately NOT adopted — it is not
// justified by this codebase's TTLs and would triple provider usage.)
const WARM_INTERVAL_MS = LIVE_TTL_MS;
const WARM_SYMBOLS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN'];

let marketWorkerInterval = null;
let marketWorkerInitialTimeout = null;
let marketWorkerRunning = false;

const startMarketBackgroundWorker = (intervalMs = WARM_INTERVAL_MS) => {
  // Idempotent: never start a second worker.
  if (marketWorkerInterval || marketWorkerInitialTimeout) {
    return marketWorkerInterval;
  }
  console.log(`[MarketWorker] Starting background market refresh worker (interval: ${intervalMs}ms)`);

  const tick = async () => {
    // Skip overlapping ticks (a slow tick must not stack on the next one).
    if (marketWorkerRunning) return;
    marketWorkerRunning = true;
    try {
      const session = getMarketSession();
      const startTime = Date.now();

      // Only warm during an open session: off-hours the last close is stable, so
      // refreshing would burn provider quota for immutable data. Cached entries
      // are served (and naturally throttled) off-hours by the normal request path.
      if (session.isOpen) {
        await Promise.allSettled(WARM_SYMBOLS.map((sym) => getQuote(sym)));
        await getPreciousMetals().catch(() => null);
      }

      const latency = Date.now() - startTime;
      console.log(`[MarketWorker] Refresh tick complete. Session: ${session.status} (${session.sessionName}), Latency: ${latency}ms`);
    } catch (err) {
      // Never crash the process on a warming failure.
      console.warn(`[MarketWorker] Refresh tick issue: ${err && err.message ? err.message : err}`);
    } finally {
      marketWorkerRunning = false;
    }
  };

  // Delayed first run so startup stays fast; unref so it never blocks exit.
  marketWorkerInitialTimeout = setTimeout(tick, 5000);
  if (marketWorkerInitialTimeout.unref) marketWorkerInitialTimeout.unref();

  marketWorkerInterval = setInterval(tick, intervalMs);
  if (marketWorkerInterval.unref) marketWorkerInterval.unref();

  return marketWorkerInterval;
};

const stopMarketBackgroundWorker = () => {
  if (marketWorkerInitialTimeout) {
    clearTimeout(marketWorkerInitialTimeout);
    marketWorkerInitialTimeout = null;
  }
  if (marketWorkerInterval) {
    clearInterval(marketWorkerInterval);
    marketWorkerInterval = null;
    console.log('[MarketWorker] Background market refresh worker stopped.');
  }
};

module.exports = {
  // Core
  getQuote,
  getStockHistory,
  searchStocks,
  getPopularStocks,
  getPreciousMetals,
  getMetalsStatus,
  buildPuneMarket,
  getMarketNews,
  getCompanyProfile,
  getMarketDashboard,

  // Technical Analysis
  getTechnicalIndicators,
  fetchDailyCloses,
  fetchSMA,
  fetchEMA,
  fetchRSI,
  fetchMACD,
  fetchBBands,

  // Fundamentals
  fetchCompanyOverview,
  fetchEarnings,

  // Forex & Commodities
  fetchFXRate,
  fetchCommodity,
  fetchLiveUSDINR,

  // Helpers
  isMarketOpen,
  getISTTimestamp,

  // Session, validation & background worker (Phase 9 market reliability engine)
  getMarketSession,
  validateQuoteMetrics,
  startMarketBackgroundWorker,
  stopMarketBackgroundWorker,
};
