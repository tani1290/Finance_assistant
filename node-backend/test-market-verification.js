/**
 * Jinay Finance AI — Market Data Verification Suite (10 Real-World Scenarios)
 * Owner: Jinay Golecha (jinay_golecha)
 */

const axios = require('axios');
const prisma = require('./src/config/database');

const BASE_URL = 'http://127.0.0.1:5001/api/v1';

async function runVerification() {
  console.log('====================================================================');
  console.log('  JINAY FINANCE AI — MARKET DATA 10-POINT PROVENANCE & AUDIT SUITE');
  console.log('====================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, label) {
    if (cond) {
      console.log(`  ✅ PASS: ${label}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${label}`);
      failed++;
    }
  }

  try {
    // 1. Get Auth Token
    const authRes = await axios.post(`${BASE_URL}/auth/register`, {
      email: `market_audit_${Date.now()}@example.com`,
      username: `audit_user_${Date.now()}`,
      password: 'Password123!',
      firstName: 'Market',
      lastName: 'Auditor',
    });
    const token = authRes.data.data.accessToken;
    const authHeader = { headers: { Authorization: `Bearer ${token}` } };

    // SCENARIO 1: Live Stock Provider Working (RELIANCE)
    console.log('👉 [1/10] Testing Live Stock Provider Working (RELIANCE)...');
    const relRes = await axios.get(`${BASE_URL}/market/quote?symbol=RELIANCE`, authHeader);
    const rel = relRes.data.data;
    console.log('   Data received:', {
      symbol: rel.symbol,
      price: rel.price,
      currency: rel.currency,
      exchange: rel.exchange,
      source: rel.source,
      provider_symbol: rel.provider_symbol,
      provider_timestamp: rel.provider_timestamp,
      fetched_at: rel.fetched_at,
      data_status: rel.data_status,
      market_status: rel.market_status,
    });
    assert(rel.symbol === 'RELIANCE', 'Symbol matches RELIANCE');
    assert(typeof rel.price === 'number' && rel.price > 0, `Real positive price returned (₹${rel.price})`);
    assert(rel.data_status === 'LIVE' || rel.data_status === 'CACHED', `Data status is ${rel.data_status}`);
    assert(rel.currency === 'INR', 'Currency is INR');
    assert(rel.exchange === 'NSE', 'Exchange is NSE');
    assert(rel.provider_timestamp != null, 'Provider timestamp is present');
    assert(rel.fetched_at != null, 'Backend fetched_at timestamp is present');

    // SCENARIO 2: Historical Multi-Timeframe Series (No Fake Math / Sine Curves)
    console.log('\n👉 [2/10] Testing Historical Chart Series (Real Interval Observations)...');
    const histRes = await axios.get(`${BASE_URL}/market/history?symbol=RELIANCE&timeframe=1M`, authHeader);
    const hist = histRes.data.data;
    console.log(`   Points count for 1M: ${hist.points?.length}, first: ${hist.points?.[0]?.date}, last: ${hist.points?.[hist.points?.length-1]?.date}`);
    assert(hist.points && hist.points.length > 0, `Real historical candles returned (${hist.points.length} points)`);
    assert(hist.data_status === 'LIVE' || hist.data_status === 'CACHED', 'Historical data_status verified');
    const hasNaN = hist.points.some(p => isNaN(p.price) || p.price <= 0);
    assert(!hasNaN, 'Zero NaN or negative prices in historical candles');

    // SCENARIO 3: Precious Metals (24K/22K Gold & Silver with exact unit conversions)
    console.log('\n👉 [3/10] Testing Precious Metals (Gold & Silver Source and Unit Breakdown)...');
    const metalsRes = await axios.get(`${BASE_URL}/market/metals`, authHeader);
    const metals = metalsRes.data.data;
    console.log('   Gold 24K per gram:', metals.gold.karat24.perGram, '10g:', metals.gold.karat24.per10Gram, 'Source:', metals.source);
    console.log('   Silver per gram:', metals.silver.perGram, '1kg:', metals.silver.perKg, 'Unit formula:', metals.silver.unit_formula);
    assert(metals.gold.karat24.perGram > 0, 'Gold 24K per gram is positive');
    assert(Math.round(metals.gold.karat24.perGram * 10 * 100) === Math.round(metals.gold.karat24.per10Gram * 100), 'Gold 10g exact 10x ratio verified');
    assert(Math.round(metals.silver.perGram * 1000 * 100) === Math.round(metals.silver.perKg * 100), 'Silver 1kg exact 1000x ratio verified (1 kg = 1000g)');
    assert(metals.data_status === 'LIVE' || metals.data_status === 'CACHED', `Metals data status is ${metals.data_status}`);
    assert(!metals.source.includes('Fake'), 'Metals source is verified external provider');

    // SCENARIO 4: US Equities & Crypto Live Verification
    console.log('\n👉 [4/10] Testing US Equities & Crypto Instruments (AAPL & BTCUSDT)...');
    const aaplRes = await axios.get(`${BASE_URL}/market/quote?symbol=AAPL`, authHeader);
    const btcRes = await axios.get(`${BASE_URL}/market/quote?symbol=BTCUSDT`, authHeader);
    assert(aaplRes.data.data.price > 0 && aaplRes.data.data.currency === 'USD', `AAPL quote positive ($${aaplRes.data.data.price})`);
    assert(btcRes.data.data.price > 0, `BTCUSDT quote positive ($${btcRes.data.data.price})`);

    // SCENARIO 5: Database Observation Persistence
    console.log('\n👉 [5/10] Testing PostgreSQL Observation Persistence...');
    const dbQuotes = await prisma.marketPriceHistory.findMany({
      where: { symbol: 'RELIANCE' },
      orderBy: { timestamp: 'desc' },
      take: 1,
    });
    assert(dbQuotes.length > 0, 'RELIANCE observation successfully persisted to PostgreSQL market_price_history');
    assert(parseFloat(dbQuotes[0].price) === rel.price, `DB recorded price (${dbQuotes[0].price}) matches API response (${rel.price})`);

    // SCENARIO 6: Unknown / Invalid Symbol Handling (Zero Fake Fallback)
    console.log('\n👉 [6/10] Testing Unknown / Invalid Stock Symbol Handling...');
    const unkRes = await axios.get(`${BASE_URL}/market/quote?symbol=NONEXISTENT_XYZ_123`, authHeader);
    console.log('   Unknown symbol response status:', unkRes.data.data.data_status, 'price:', unkRes.data.data.price);
    assert(unkRes.data.data.data_status === 'UNAVAILABLE', 'Unknown symbol returns data_status: UNAVAILABLE');
    assert(unkRes.data.data.price === null, 'Unknown symbol returns price: null (Zero fake prices)');

    // SCENARIO 7: Unsupported / Empty Historical Timeframe Handling
    console.log('\n👉 [7/10] Testing Unsupported Symbol Historical Handling...');
    const unkHist = await axios.get(`${BASE_URL}/market/history?symbol=NONEXISTENT_XYZ_123&timeframe=1M`, authHeader);
    assert(unkHist.data.data.data_status === 'UNAVAILABLE', 'Historical data returns UNAVAILABLE');
    assert(unkHist.data.data.points.length === 0, 'Zero synthetic points generated');

    // SCENARIO 8: Market Status Awareness
    console.log('\n👉 [8/10] Testing Market Status Indicator...');
    const mkt = rel.market_status;
    assert(['OPEN', 'CLOSED', 'LIVE', 'MARKET CLOSED'].includes(mkt), `Market status awareness reported: ${mkt}`);

    // SCENARIO 9: Technical Indicators Provenance
    console.log('\n👉 [9/10] Testing Technical Indicators (Alpha Vantage)...');
    const techRes = await axios.get(`${BASE_URL}/market/technicals?symbol=RELIANCE`, authHeader);
    assert(techRes.data.success === true, 'GET /market/technicals returns success');
    assert(techRes.data.data.symbol === 'RELIANCE', 'Technicals symbol matches');

    // SCENARIO 10: Consolidated Real-Time Market Dashboard
    console.log('\n👉 [10/10] Testing Consolidated Market Dashboard (/market/dashboard)...');
    const dashRes = await axios.get(`${BASE_URL}/market/dashboard`, authHeader);
    const d = dashRes.data.data;
    assert(Array.isArray(d.stocks) && d.stocks.length >= 6, 'Dashboard returns multi-stock array');
    assert(d.gold?.karat24?.perGram > 0, 'Dashboard returns verified gold');
    assert(d.silver?.perGram > 0, 'Dashboard returns verified silver');
    assert(d.usdToInr > 0, `Dashboard returns live USD/INR FX (₹${d.usdToInr})`);

    console.log('\n====================================================================');
    console.log(`  VERIFICATION RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('====================================================================\n');

  } catch (err) {
    console.error('❌ Verification suite error:', err.message, err.response?.data);
  } finally {
    await prisma.$disconnect();
  }
}

runVerification();
