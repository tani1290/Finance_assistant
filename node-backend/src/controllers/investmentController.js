const prisma = require('../config/database');
const marketService = require('../services/marketService');
const { formatINR } = require('../utils/inr');

/**
 * Investments & Real-Time Market Controller
 * Owner: Jinay Golecha (jinay_golecha)
 */

/**
 * GET /api/v1/investments/portfolio
 */
const getPortfolio = async (req, res, next) => {
  try {
    const userId = req.user.id;
    let portfolio = await prisma.portfolio.findUnique({
      where: { userId },
      include: { investments: true },
    });

    if (!portfolio) {
      portfolio = await prisma.portfolio.create({
        data: { userId, totalInvested: 0, currentValue: 0 },
        include: { investments: true },
      });
    }

    const metals = await marketService.getPreciousMetals();
    const gold24k = metals.gold.karat24.perGram;
    const gold22k = metals.gold.karat22.perGram;
    const silverGram = metals.silver.perGram;

    let totalInvested = 0;
    let currentPortfolioValue = 0;
    const items = [];

    for (const inv of portfolio.investments) {
      const qty = parseFloat(inv.quantity);
      const avgBuy = parseFloat(inv.averageBuyPrice);
      const costBasis = qty * avgBuy;

      let currPrice = avgBuy;
      let quoteName = inv.name || inv.symbol;
      let marketStatus = 'LIVE';
      let timestamp = metals.timestamp;
      let source = 'LIVE';

      if (inv.assetType === 'GOLD' || inv.symbol.toUpperCase().includes('GOLD')) {
        currPrice = inv.symbol.includes('22K') ? gold22k : gold24k;
        quoteName = inv.name || (inv.symbol.includes('22K') ? 'Gold 22K (Physical/SGB)' : 'Gold 24K (99.9% Pure)');
        marketStatus = metals.marketStatus;
      } else if (inv.assetType === 'SILVER' || inv.symbol.toUpperCase().includes('SILVER')) {
        currPrice = silverGram;
        quoteName = inv.name || 'Silver (99.9% Pure)';
        marketStatus = metals.marketStatus;
      } else {
        const quote = await marketService.getQuote(inv.symbol);
        currPrice = quote.price;
        quoteName = inv.name || quote.name || inv.symbol;
        marketStatus = quote.marketStatus;
        timestamp = quote.timestamp;
        source = quote.source;
      }

      const currVal = qty * currPrice;
      const pnl = currVal - costBasis;
      const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

      totalInvested += costBasis;
      currentPortfolioValue += currVal;

      items.push({
        id: inv.id,
        symbol: inv.symbol,
        name: quoteName,
        assetType: inv.assetType,
        quantity: qty,
        averageBuyPrice: avgBuy,
        formattedBuyPrice: formatINR(avgBuy),
        currentPrice: currPrice,
        formattedCurrentPrice: formatINR(currPrice),
        totalCost: costBasis,
        formattedCost: formatINR(costBasis),
        currentValue: currVal,
        formattedCurrentValue: formatINR(currVal),
        pnl,
        formattedPnl: formatINR(pnl),
        pnlPercent: Math.round(pnlPct * 100) / 100,
        marketStatus,
        timestamp,
        source,
      });
    }

    // Update portfolio totals in DB
    await prisma.portfolio.update({
      where: { userId },
      data: { totalInvested, currentValue: currentPortfolioValue },
    });

    const totalPnl = currentPortfolioValue - totalInvested;
    const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    return res.status(200).json({
      success: true,
      data: {
        totalInvested,
        formattedTotalInvested: formatINR(totalInvested),
        currentValue: currentPortfolioValue,
        formattedCurrentValue: formatINR(currentPortfolioValue),
        totalPnl,
        formattedTotalPnl: formatINR(totalPnl),
        totalPnlPercent: Math.round(totalPnlPct * 100) / 100,
        holdings: items,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/investments/buy
 */
const buyInvestment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { symbol, name, assetType = 'STOCK', quantity, buyPrice } = req.body;

    const qty = parseFloat(quantity);
    const price = parseFloat(buyPrice);

    if (!symbol || !qty || !price || qty <= 0 || price <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Symbol, quantity, and buy price are required (all must be positive).' },
      });
    }

    let portfolio = await prisma.portfolio.findUnique({ where: { userId } });
    if (!portfolio) {
      portfolio = await prisma.portfolio.create({
        data: { userId, totalInvested: 0, currentValue: 0 },
      });
    }

    const symbolUpper = symbol.toUpperCase().trim();

    // Upsert investment
    const existing = await prisma.investment.findFirst({
      where: { portfolioId: portfolio.id, symbol: symbolUpper },
    });

    let investment;
    if (existing) {
      const newQty = parseFloat(existing.quantity) + qty;
      const newAvgPrice = (parseFloat(existing.quantity) * parseFloat(existing.averageBuyPrice) + qty * price) / newQty;

      investment = await prisma.investment.update({
        where: { id: existing.id },
        data: { quantity: newQty, averageBuyPrice: newAvgPrice },
      });
    } else {
      investment = await prisma.investment.create({
        data: {
          portfolioId: portfolio.id,
          symbol: symbolUpper,
          name: name || symbolUpper,
          assetType,
          quantity: qty,
          averageBuyPrice: price,
        },
      });
    }

    // Auto-sync portfolio totals
    await syncPortfolioTotals(portfolio.id);

    return res.status(201).json({
      success: true,
      data: {
        id: investment.id,
        symbol: investment.symbol,
        quantity: parseFloat(investment.quantity),
        averageBuyPrice: parseFloat(investment.averageBuyPrice),
        formattedBuyPrice: formatINR(investment.averageBuyPrice),
        totalCost: qty * price,
        formattedTotalCost: formatINR(qty * price),
        message: `Successfully bought ${qty} units of ${symbolUpper} at ${formatINR(price)}/unit!`,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Helper to sync portfolio totalInvested from all holding costs
 */
const syncPortfolioTotals = async (portfolioId) => {
  try {
    const holdings = await prisma.investment.findMany({
      where: { portfolioId },
    });
    const totalInvested = holdings.reduce(
      (sum, h) => sum + (parseFloat(h.quantity) * parseFloat(h.averageBuyPrice)),
      0
    );
    await prisma.portfolio.update({
      where: { id: portfolioId },
      data: { totalInvested },
    });
  } catch (e) {
    console.debug('[PortfolioSync] Notice:', e.message);
  }
};

/**
 * GET /api/v1/investments
 */
const getInvestments = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const portfolio = await prisma.portfolio.findUnique({
      where: { userId },
      include: { investments: true },
    });

    if (!portfolio || !portfolio.investments.length) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const formatted = portfolio.investments.map((inv) => {
      const qty = parseFloat(inv.quantity);
      const buyPrice = parseFloat(inv.averageBuyPrice);
      const totalCost = qty * buyPrice;
      return {
        id: inv.id,
        symbol: inv.symbol,
        name: inv.name || inv.symbol,
        assetType: inv.assetType,
        quantity: qty,
        averageBuyPrice: buyPrice,
        formattedBuyPrice: formatINR(buyPrice),
        totalCost,
        formattedTotalCost: formatINR(totalCost),
        createdAt: inv.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/investments/:id
 */
const updateInvestment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const portfolio = await prisma.portfolio.findUnique({ where: { userId } });
    if (!portfolio) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Portfolio not found.' } });
    }

    const investment = await prisma.investment.findFirst({
      where: { id: req.params.id, portfolioId: portfolio.id },
    });
    if (!investment) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investment not found.' } });
    }

    const { quantity, averageBuyPrice, name } = req.body;
    const newQty = quantity !== undefined ? parseFloat(quantity) : undefined;
    const newPrice = averageBuyPrice !== undefined ? parseFloat(averageBuyPrice) : undefined;

    if ((newQty !== undefined && newQty <= 0) || (newPrice !== undefined && newPrice <= 0)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Quantity and average buy price must be positive numbers.' },
      });
    }

    const updated = await prisma.investment.update({
      where: { id: investment.id },
      data: {
        ...(newQty !== undefined && { quantity: newQty }),
        ...(newPrice !== undefined && { averageBuyPrice: newPrice }),
        ...(name && { name: name.trim() }),
      },
    });

    await syncPortfolioTotals(portfolio.id);

    return res.status(200).json({
      success: true,
      data: {
        ...updated,
        quantity: parseFloat(updated.quantity),
        averageBuyPrice: parseFloat(updated.averageBuyPrice),
        formattedBuyPrice: formatINR(updated.averageBuyPrice),
        message: 'Investment updated successfully.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/investments/:id
 */
const deleteInvestment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const portfolio = await prisma.portfolio.findUnique({ where: { userId } });
    if (!portfolio) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Portfolio not found.' } });
    }

    const investment = await prisma.investment.findFirst({
      where: { id: req.params.id, portfolioId: portfolio.id },
    });
    if (!investment) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investment not found.' } });
    }

    await prisma.investment.delete({ where: { id: investment.id } });
    await syncPortfolioTotals(portfolio.id);

    return res.status(200).json({
      success: true,
      data: { message: `Investment ${investment.symbol} removed and portfolio totals updated.` },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/quote
 */
const getStockQuote = async (req, res, next) => {
  try {
    const symbol = req.query.symbol || 'RELIANCE';
    const quote = await marketService.getQuote(symbol);

    return res.status(200).json({
      success: true,
      data: {
        ...quote,
        formattedPrice: formatINR(quote.price),
        formattedChange: quote.change ? `${quote.change > 0 ? '+' : ''}${formatINR(quote.change)}` : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/history
 */
const getStockHistory = async (req, res, next) => {
  try {
    const symbol = req.query.symbol || 'RELIANCE';
    const timeframe = req.query.timeframe || '1M';
    const history = await marketService.getStockHistory(symbol, timeframe);

    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/search
 */
const searchStocks = async (req, res, next) => {
  try {
    const query = req.query.q || '';
    const results = marketService.searchStocks(query);
    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/popular
 */
const getPopularStocks = async (req, res, next) => {
  try {
    const stocks = marketService.getPopularStocks();
    return res.status(200).json({ success: true, data: stocks });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/metals
 */
const getMetals = async (req, res, next) => {
  try {
    const data = await marketService.getPreciousMetals();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/metals/status
 *
 * Integration health for the precious-metals feed. Returns configuration
 * booleans and cache freshness only — never a credential value.
 */
const getMetalsStatus = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: marketService.getMetalsStatus() });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/metals/pune
 *
 * Pune retail bullion estimates derived from the live spot feed using
 * transparent statutory loadings. `is_live_provider_quote: false` is part of
 * the contract: this is an indicative parity calculation, not a shop quote.
 * Returns 503 when no spot rate is available rather than inventing one.
 */
const getPuneRetailMetals = async (req, res, next) => {
  try {
    const metals = await marketService.getPreciousMetals();
    const puneMarket = metals.puneMarket || metals.pune_market || null;
    if (!puneMarket) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'UNAVAILABLE',
          message: 'Pune retail estimate unavailable because no live or cached spot rate exists.',
        },
      });
    }
    return res.status(200).json({ success: true, data: puneMarket });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/gold
 */
const getGold = async (req, res, next) => {
  try {
    const metals = await marketService.getPreciousMetals();
    return res.status(200).json({
      success: true,
      data: {
        ...metals.gold,
        marketStatus: metals.marketStatus,
        market_status: metals.market_status,
        data_status: metals.data_status,
        dataStatus: metals.dataStatus,
        source: metals.source,
        timestamp: metals.timestamp,
        provider: metals.provider,
        provider_timestamp: metals.provider_timestamp,
        fetched_at: metals.fetched_at,
        usdToInr: metals.usdToInr,
        puneMarket: metals.puneMarket || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/silver
 */
const getSilver = async (req, res, next) => {
  try {
    const metals = await marketService.getPreciousMetals();
    return res.status(200).json({
      success: true,
      data: {
        ...metals.silver,
        marketStatus: metals.marketStatus,
        market_status: metals.market_status,
        data_status: metals.data_status,
        dataStatus: metals.dataStatus,
        source: metals.source,
        timestamp: metals.timestamp,
        provider: metals.provider,
        provider_timestamp: metals.provider_timestamp,
        fetched_at: metals.fetched_at,
        usdToInr: metals.usdToInr,
        puneMarket: metals.puneMarket || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/watchlist
 */
const getWatchlist = async (req, res, next) => {
  try {
    const watchlist = await prisma.marketWatchlist.findMany({
      where: { userId: req.user.id },
      orderBy: { addedAt: 'desc' },
    });

    const withPrices = await Promise.all(
      watchlist.map(async (w) => {
        const quote = await marketService.getQuote(w.symbol);
        return {
          id: w.id,
          symbol: w.symbol,
          name: w.name || quote.name,
          price: quote.price,
          formattedPrice: formatINR(quote.price),
          change: quote.change,
          changePercent: quote.changePercent,
          marketStatus: quote.marketStatus,
          source: quote.source,
        };
      })
    );

    return res.status(200).json({ success: true, data: withPrices });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/market/watchlist
 */
const addToWatchlist = async (req, res, next) => {
  try {
    const { symbol, name } = req.body;
    if (!symbol) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Symbol is required.' } });
    }

    const item = await prisma.marketWatchlist.upsert({
      where: { userId_symbol: { userId: req.user.id, symbol: symbol.toUpperCase() } },
      update: {},
      create: { userId: req.user.id, symbol: symbol.toUpperCase(), name: name || symbol.toUpperCase() },
    });

    return res.status(201).json({ success: true, data: { ...item, message: `${symbol} added to watchlist!` } });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/market/watchlist/:symbol
 */
const removeFromWatchlist = async (req, res, next) => {
  try {
    await prisma.marketWatchlist.deleteMany({
      where: { userId: req.user.id, symbol: req.params.symbol.toUpperCase() },
    });
    return res.status(200).json({ success: true, data: { message: 'Removed from watchlist.' } });
  } catch (error) {
    next(error);
  }
};


/**
 * GET /api/v1/market/news
 */
const getMarketNews = async (req, res, next) => {
  try {
    const category = req.query.category || 'general';
    const news = await marketService.getMarketNews(category);
    return res.status(200).json({ success: true, count: news.length, data: news });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/profile
 */
const getCompanyProfile = async (req, res, next) => {
  try {
    const symbol = req.query.symbol || 'RELIANCE';
    const profile = await marketService.getCompanyProfile(symbol);
    return res.status(200).json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/dashboard
 * Alpha Vantage — full real-time market dashboard (stocks + gold + FX + crude)
 */
const getMarketDashboard = async (req, res, next) => {
  try {
    const data = await marketService.getMarketDashboard();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/technicals?symbol=RELIANCE
 * Alpha Vantage — SMA, EMA, RSI, MACD, Bollinger Bands
 */
const getTechnicals = async (req, res, next) => {
  try {
    const symbol = req.query.symbol || 'RELIANCE';
    const data = await marketService.getTechnicalIndicators(symbol);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/overview?symbol=RELIANCE
 * Alpha Vantage — Company Overview with fundamentals
 */
const getCompanyOverview = async (req, res, next) => {
  try {
    const symbol = req.query.symbol || 'RELIANCE';
    let data = await marketService.fetchCompanyOverview(symbol);
    if (!data) {
      data = await marketService.getCompanyProfile(symbol);
    }
    if (!data) {
      data = {
        symbol: symbol.toUpperCase(),
        name: symbol.toUpperCase(),
        description: 'Company overview is currently unavailable for this instrument.',
      };
    }

    // Alpha Vantage fundamentals don't cover NSE/BSE, so the 52-week range comes
    // back empty. The live quote already knows it — fill it in rather than
    // rendering "--". Copy first so a cached profile is never mutated.
    if (data.week52High == null || data.week52Low == null) {
      try {
        const quote = await marketService.getQuote(symbol);
        if (quote) {
          data = { ...data };
          if (data.week52High == null && quote.week52High != null) data.week52High = quote.week52High;
          if (data.week52Low == null && quote.week52Low != null) data.week52Low = quote.week52Low;
        }
      } catch {
        /* fundamentals enrichment is best-effort */
      }
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/earnings?symbol=RELIANCE
 * Alpha Vantage — Quarterly EPS Earnings
 */
const getEarnings = async (req, res, next) => {
  try {
    const symbol = req.query.symbol || 'RELIANCE';
    const data = await marketService.fetchEarnings(symbol);
    if (!data) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Earnings data not available for this symbol.' } });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/fx?from=USD&to=INR
 * Alpha Vantage — Forex Exchange Rate
 */
const getFXRate = async (req, res, next) => {
  try {
    const from = req.query.from || 'USD';
    const to   = req.query.to   || 'INR';
    const data = await marketService.fetchFXRate(from, to);
    if (!data) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'FX rate unavailable.' } });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/market/commodity?type=WTI
 * Alpha Vantage — Commodity (WTI, BRENT, NATURAL_GAS, COPPER, WHEAT, CORN, GLOBAL_PRICE_OF_GOLD, etc.)
 */
const getCommodity = async (req, res, next) => {
  try {
    const type     = (req.query.type || 'WTI').toUpperCase();
    const interval = req.query.interval || 'monthly';
    const data = await marketService.fetchCommodity(type, interval);
    if (!data) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Commodity data unavailable.' } });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPortfolio,
  getInvestments,
  buyInvestment,
  updateInvestment,
  deleteInvestment,
  getStockQuote,
  getStockHistory,
  searchStocks,
  getPopularStocks,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getMetals,
  getMetalsStatus,
  getPuneRetailMetals,
  getGold,
  getSilver,
  getMarketNews,
  getCompanyProfile,
  // Alpha Vantage enhanced
  getMarketDashboard,
  getTechnicals,
  getCompanyOverview,
  getEarnings,
  getFXRate,
  getCommodity,
};

