const axios = require('axios');

async function testLiveMarket() {
  console.log('Testing Live Market APIs with Finnhub Key on Server...\n');

  try {
    // 1. Health Market (public)
    const h = await axios.get('http://127.0.0.1:5001/api/v1/health/market');
    console.log('✅ Health Market:', h.data);

    // Register/Login to get token
    const timestamp = Date.now();
    let token = null;
    try {
      const reg = await axios.post('http://127.0.0.1:5001/api/v1/auth/register', {
        email: `market_test_${timestamp}@example.com`,
        username: `market_user_${timestamp}`,
        password: 'Password123!',
        firstName: 'Market',
        lastName: 'Tester',
      });
      token = reg.data.data.accessToken;
    } catch {
      const loginRes = await axios.post('http://127.0.0.1:5001/api/v1/auth/login', {
        email: 'jinay@example.com',
        password: 'Password123!',
      });
      token = loginRes.data.data.accessToken;
    }

    const authHeaders = { Authorization: `Bearer ${token}` };

    // 2. Quote AAPL
    const qAAPL = await axios.get('http://127.0.0.1:5001/api/v1/market/quote?symbol=AAPL', { headers: authHeaders });
    console.log('\n✅ Live Quote AAPL (US Stock via Finnhub):', {
      symbol: qAAPL.data.data.symbol,
      price: qAAPL.data.data.price,
      change: qAAPL.data.data.change,
      changePercent: qAAPL.data.data.changePercent,
      provider: qAAPL.data.data.provider,
      source: qAAPL.data.data.source,
    });

    // 3. Quote BTCUSDT
    const qBTC = await axios.get('http://127.0.0.1:5001/api/v1/market/quote?symbol=BTCUSDT', { headers: authHeaders });
    console.log('\n✅ Live Crypto Quote (BTC/USDT via Finnhub):', {
      symbol: qBTC.data.data.symbol,
      price: qBTC.data.data.price,
      change: qBTC.data.data.change,
      source: qBTC.data.data.source,
      provider: qBTC.data.data.provider,
    });

    // 4. Metals
    const metals = await axios.get('http://127.0.0.1:5001/api/v1/market/metals', { headers: authHeaders });
    console.log('\n✅ Precious Metals Rates (MCX / Spot):', {
      gold24k_10g: '₹' + metals.data?.data?.gold?.karat24?.per10Gram?.toLocaleString('en-IN'),
      gold22k_10g: '₹' + metals.data?.data?.gold?.karat22?.per10Gram?.toLocaleString('en-IN'),
      silver_1kg: '₹' + metals.data?.data?.silver?.perKg?.toLocaleString('en-IN'),
      source: metals.data?.data?.source,
    });

    // 5. Market News
    const news = await axios.get('http://127.0.0.1:5001/api/v1/market/news', { headers: authHeaders });
    console.log(`\n✅ Live Financial Market News (${news.data?.count} headlines fetched):`);
    news.data?.data?.slice(0, 3).forEach((n, i) => {
      console.log(`   ${i + 1}. [${n.source}] ${n.headline}`);
      console.log(`      Link: ${n.url}`);
    });

    // 6. Company Profile
    const prof = await axios.get('http://127.0.0.1:5001/api/v1/market/profile?symbol=AAPL', { headers: authHeaders });
    console.log('\n✅ Company Profile & Fundamentals (AAPL):', {
      name: prof.data?.data?.name,
      ticker: prof.data?.data?.ticker,
      industry: prof.data?.data?.finnhubIndustry,
      marketCap: `$${(prof.data?.data?.marketCapitalization / 1000).toFixed(2)}B`,
      weburl: prof.data?.data?.weburl,
    });

    console.log('\n====================================================================');
    console.log('  ALL LIVE MARKET DATA FEATURES SUCCESSFULLY EXTRACTED FROM FINNHUB');
    console.log('====================================================================\n');

  } catch (err) {
    console.error('❌ Error testing market API:', err.message, err.response?.data);
  }
}

testLiveMarket();
