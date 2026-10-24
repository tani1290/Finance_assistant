const cacheService = require('./cacheService');
const { createHttpClient } = require('./httpClient');

// Public news only. Provider keys stay in the query string on the server and
// are never written to logs or the cache.
const http = createHttpClient({ name: 'news', timeoutMs: 8000, retries: 1, maxConcurrent: 4 });

/**
 * Financial News Service (Phase 30 & Phase 31)
 * Integrates Marketaux API for real-time finance, market, and company news.
 * Strictly keeps API keys server-side with controlled TTL caching.
 * ABSOLUTE RULE 1 & 12 COMPLIANCE: Zero fake news. Never silently invent data.
 */

const NEWS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache
const newsCache = new Map();

const getCachedNews = (key) => {
  if (!newsCache.has(key)) return null;
  const entry = newsCache.get(key);
  const age = Date.now() - entry.ts;
  if (age > NEWS_CACHE_TTL_MS) {
    newsCache.delete(key);
    return null;
  }
  return { ...entry.data, cache_age_seconds: Math.round(age / 1000), data_status: 'CACHED' };
};

const setCachedNews = (key, data, ts = Date.now()) => {
  newsCache.set(key, { data, ts });
  // Public news only. Keep the fetch timestamp so another instance reports the
  // real age instead of presenting the item as freshly fetched.
  void cacheService.set(`news:${key}`, { data, ts }, { ttlMs: NEWS_CACHE_TTL_MS });
};

/**
 * Fetch financial news from Marketaux API with Finnhub fallback
 */
const getFinancialNews = async ({ search = '', category = 'general', symbols = '', limit = 10 } = {}) => {
  const cacheKey = `NEWS_${search}_${category}_${symbols}_${limit}`;
  let cached = getCachedNews(cacheKey);
  if (!cached) {
    const shared = await cacheService.get(`news:${cacheKey}`);
    if (shared?.data) {
      newsCache.set(cacheKey, { data: shared.data, ts: shared.ts || Date.now() });
      cached = getCachedNews(cacheKey);
    }
  }
  if (cached) return cached;

  const marketauxKey = process.env.MARKETAUX_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;

  let lastErrorStatus = null;
  let lastErrorMessage = null;

  // 1. Primary: Marketaux API
  if (marketauxKey && marketauxKey !== 'YOUR_MARKETAUX_API_KEY') {
    try {
      const params = {
        api_token: marketauxKey,
        limit: Math.min(limit, 20),
        language: 'en',
      };
      if (search) params.search = search;
      if (symbols) params.symbols = symbols;
      if (category && category !== 'general') {
        params.industries = category;
      }

      const res = await http.get('https://api.marketaux.com/v1/news/all', {
        params,
        timeout: 8000,
      });

      if (res.data?.data && Array.isArray(res.data.data)) {
        const articles = res.data.data.map((item, idx) => ({
          id: item.uuid || `mx-${idx}-${Date.now()}`,
          headline: item.title,
          description: item.description || '',
          source: item.source || 'Marketaux',
          url: item.url,
          imageUrl: item.image_url || null,
          publishedAt: item.published_at || new Date().toISOString(),
          entities: item.entities?.map(e => e.symbol || e.name) || [],
          sentiment: item.sentiment || null,
        }));

        const result = {
          provider: 'Marketaux',
          source: 'Marketaux Financial News API',
          category,
          searchQuery: search,
          articles,
          count: articles.length,
          fetchedAt: new Date().toISOString(),
          data_status: 'LIVE',
          message: articles.length === 0 ? 'No financial news is currently available.' : null,
        };

        if (articles.length > 0) {
          setCachedNews(cacheKey, result);
        }
        return result;
      }
    } catch (err) {
      console.debug('[NewsService] Marketaux fetch notice:', err.message);
      if (err.response?.status === 429) {
        lastErrorStatus = 'RATE_LIMIT';
        lastErrorMessage = 'Marketaux news rate limit reached. Retrying alternative provider.';
      } else if (err.response?.status === 401 || err.response?.status === 403) {
        lastErrorStatus = 'AUTHENTICATION_REQUIRED';
        lastErrorMessage = 'Marketaux API key authentication failure.';
      } else {
        lastErrorStatus = 'PROVIDER_ERROR';
        lastErrorMessage = err.message;
      }
    }
  }

  // 2. Secondary: Finnhub General Market News
  if (finnhubKey && finnhubKey !== 'YOUR_FINNHUB_API_KEY') {
    try {
      const res = await http.get('https://finnhub.io/api/v1/news', {
        params: { category: category === 'general' ? 'general' : category, token: finnhubKey },
        timeout: 7000,
      });

      if (Array.isArray(res.data) && res.data.length > 0) {
        const articles = res.data.slice(0, limit).map((item) => ({
          id: String(item.id),
          headline: item.headline,
          description: item.summary || '',
          source: item.source || 'Finnhub',
          url: item.url,
          imageUrl: item.image || null,
          publishedAt: new Date(item.datetime * 1000).toISOString(),
          entities: item.related ? item.related.split(',') : [],
          sentiment: null,
        }));

        const result = {
          provider: 'Finnhub',
          source: 'Finnhub Financial News API',
          category,
          searchQuery: search,
          articles,
          count: articles.length,
          fetchedAt: new Date().toISOString(),
          data_status: 'LIVE',
          message: articles.length === 0 ? 'No financial news is currently available.' : null,
        };

        if (articles.length > 0) {
          setCachedNews(cacheKey, result);
        }
        return result;
      }
    } catch (err) {
      console.debug('[NewsService] Finnhub news notice:', err.message);
      if (err.response?.status === 429) {
        lastErrorStatus = 'RATE_LIMIT';
      }
    }
  }

  // 3. Truthful fallback state (Rule 1 & 12: Zero fake news. Never invent data.)
  const status = lastErrorStatus || 'UNAVAILABLE';
  let message = 'No financial news is currently available.';
  if (status === 'RATE_LIMIT') {
    message = 'Financial news provider rate limit exceeded. Please try again shortly.';
  } else if (status === 'AUTHENTICATION_REQUIRED') {
    message = 'Financial news provider authentication required. Please verify MARKETAUX_API_KEY.';
  } else if (!marketauxKey && !finnhubKey) {
    message = 'Financial news provider not configured. Configure MARKETAUX_API_KEY in .env.';
  }

  return {
    provider: 'None',
    source: 'External Provider',
    category,
    searchQuery: search,
    articles: [],
    count: 0,
    fetchedAt: new Date().toISOString(),
    data_status: status,
    message,
    error_detail: lastErrorMessage || null,
  };
};

/**
 * Health check for News Service
 */
const checkNewsHealth = async () => {
  const marketauxKey = process.env.MARKETAUX_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const isMarketauxConfigured = !!(marketauxKey && marketauxKey !== 'YOUR_MARKETAUX_API_KEY');
  const isFinnhubConfigured = !!(finnhubKey && finnhubKey !== 'YOUR_FINNHUB_API_KEY');

  return {
    status: isMarketauxConfigured || isFinnhubConfigured ? 'healthy' : 'unconfigured',
    provider: isMarketauxConfigured ? 'Marketaux' : isFinnhubConfigured ? 'Finnhub' : 'None',
    marketauxConfigured: isMarketauxConfigured,
    finnhubConfigured: isFinnhubConfigured,
    cacheEntries: newsCache.size,
    timestamp: new Date().toISOString(),
  };
};

module.exports = {
  getFinancialNews,
  checkNewsHealth,
};
