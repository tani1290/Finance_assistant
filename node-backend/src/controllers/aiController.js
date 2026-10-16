const aiService = require('../services/aiService');
const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');

/**
 * AI Advisor & Recommendation Controller
 * Owner: Jinay Golecha (jinay_golecha)
 */

const ragService = require('../services/ragService');
const aiActionService = require('../services/aiActionService');
const aiAssistantService = require('../services/aiAssistantService');

/**
 * POST /api/v1/ai/chat
 * Real Retrieval-Augmented Generation (RAG) Architecture & Action Execution Engine
 */
const chat = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Message cannot be empty.' },
      });
    }

    // Get recent chat history for context
    const recentHistory = await prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const chatHistory = recentHistory.reverse();

    // Save user message
    await prisma.chatMessage.create({
      data: { userId, role: 'user', content: message.trim() },
    });

    // 1. PRIMARY: LLM tool-calling assistant — can both answer questions and
    //    actually perform any financial action across the whole domain.
    try {
      const assistant = await aiAssistantService.run(userId, message.trim(), chatHistory);
      if (assistant && assistant.response) {
        await prisma.chatMessage.create({
          data: { userId, role: 'assistant', content: assistant.response },
        });

        const acted = (assistant.steps || []).filter((s) => s.ok).map((s) => s.name);

        return res.status(200).json({
          success: true,
          data: {
            response: assistant.response,
            source: assistant.source,
            sources: ['Gemini Function Calling', 'PostgreSQL Database'],
            action: acted.length
              ? {
                  executed: true,
                  type: acted[acted.length - 1],
                  data: null,
                  steps: assistant.steps,
                }
              : null,
            rag: {
              enabled: true,
              sources: ['Live Financial Ledger'],
              retrievedDocCount: (assistant.steps || []).length,
              intents: acted,
              tenantVerified: true,
              model: assistant.model,
            },
          },
        });
      }
    } catch (err) {
      console.warn('[AI] Tool-calling assistant failed, falling back:', err.message);
    }

    // 2. FALLBACK: deterministic action engine for the core intents.
    const actionResult = await aiActionService.tryExecuteAction(userId, message.trim());
    if (actionResult && actionResult.handled) {
      // Save assistant action response
      await prisma.chatMessage.create({
        data: { userId, role: 'assistant', content: actionResult.response },
      });

      return res.status(200).json({
        success: true,
        data: {
          response: actionResult.response,
          source: `ai_action_engine (${actionResult.action})`,
          sources: ['Financial Ledger Engine', 'PostgreSQL Database'],
          action: {
            executed: actionResult.success,
            type: actionResult.action,
            data: actionResult.data || null,
          },
          rag: {
            enabled: true,
            sources: ['Real-time Account Balances & Transactions'],
            retrievedDocCount: 1,
            intents: [actionResult.action],
            tenantVerified: true,
          },
        },
      });
    }

    // 3. Otherwise Execute Real RAG Pipeline: Intent -> Multi-domain User Retriever -> Grounded Context -> LLM / Reasoning
    const result = await ragService.runRAGPipeline(userId, message.trim(), chatHistory);

    // Save assistant response
    await prisma.chatMessage.create({
      data: { userId, role: 'assistant', content: result.response },
    });

    return res.status(200).json({
      success: true,
      data: {
        response: result.response,
        source: result.source,
        sources: result.sources,
        rag: {
          enabled: true,
          sources: result.sources,
          retrievedDocCount: result.retrievedDocCount,
          intents: result.intents,
          tenantVerified: result.tenantVerified,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/ai/history
 */
const getChatHistory = async (req, res, next) => {
  try {
    const messages = await prisma.chatMessage.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    return res.status(200).json({
      success: true,
      data: messages,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/ai/history
 */
const clearChatHistory = async (req, res, next) => {
  try {
    await prisma.chatMessage.deleteMany({ where: { userId: req.user.id } });
    return res.status(200).json({ success: true, data: { message: 'Chat history cleared.' } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/ai/snapshot
 */
const getFinancialSnapshot = async (req, res, next) => {
  try {
    const ctx = await aiService.getUserFinancialContext(req.user.id);

    return res.status(200).json({
      success: true,
      data: {
        healthScore: ctx.healthScore,
        totalBalance: ctx.totalBalance,
        formattedBalance: formatINR(ctx.totalBalance),
        netWorth: ctx.netWorth,
        formattedNetWorth: formatINR(ctx.netWorth),
        incomeThisMonth: ctx.incomeThisMonth,
        formattedIncome: formatINR(ctx.incomeThisMonth),
        expensesThisMonth: ctx.expensesThisMonth,
        formattedExpenses: formatINR(ctx.expensesThisMonth),
        savingsThisMonth: ctx.savingsThisMonth,
        formattedSavings: formatINR(ctx.savingsThisMonth),
        totalDebt: ctx.totalDebt,
        formattedDebt: formatINR(ctx.totalDebt),
        investmentValue: ctx.investmentValue,
        formattedInvestments: formatINR(ctx.investmentValue),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/ai/investment-analysis
 */
const getInvestmentAnalysis = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [portfolio, profile, accounts] = await Promise.all([
      prisma.portfolio.findUnique({
        where: { userId },
        include: { investments: true },
      }),
      prisma.financialProfile.findUnique({ where: { userId } }),
      prisma.financialAccount.findMany({ where: { userId, isActive: true } }),
    ]);

    const holdings = portfolio?.investments || [];
    const totalInvested = holdings.reduce((sum, h) => sum + (parseFloat(h.quantity) * parseFloat(h.averageBuyPrice)), 0);
    const cashBalance = accounts.reduce((sum, a) => sum + parseFloat(a.balance), 0);

    let equityValue = 0;
    let goldValue = 0;
    let cryptoValue = 0;
    let otherValue = 0;

    holdings.forEach(h => {
      const val = parseFloat(h.quantity) * parseFloat(h.averageBuyPrice);
      if (h.assetType === 'STOCK' || h.assetType === 'MUTUAL_FUND' || h.assetType === 'ETF') equityValue += val;
      else if (h.assetType === 'GOLD') goldValue += val;
      else if (h.assetType === 'CRYPTO') cryptoValue += val;
      else otherValue += val;
    });

    const totalAssets = totalInvested + cashBalance;
    const equityPct = totalAssets > 0 ? Math.round((equityValue / totalAssets) * 100) : 0;
    const goldPct = totalAssets > 0 ? Math.round((goldValue / totalAssets) * 100) : 0;
    const cryptoPct = totalAssets > 0 ? Math.round((cryptoValue / totalAssets) * 100) : 0;
    const cashPct = totalAssets > 0 ? Math.round((cashBalance / totalAssets) * 100) : 0;

    const riskProfile = profile?.riskProfile || 'MODERATE';
    const insights = [];

    if (equityPct > 70 && riskProfile === 'CONSERVATIVE') {
      insights.push('Your equity exposure is higher than recommended for a conservative risk profile.');
    } else if (equityPct < 30 && riskProfile === 'AGGRESSIVE') {
      insights.push('Your equity exposure is relatively low for an aggressive long-term wealth creation strategy.');
    }

    if (goldPct < 5) {
      insights.push('Consider holding 5-10% of your portfolio in Gold/Precious Metals for inflation hedging.');
    }

    if (cashPct > 50) {
      insights.push('High cash allocation detected. Consider systematic investment (SIP) to avoid inflation drag.');
    }

    if (insights.length === 0) {
      insights.push('Your asset allocation is balanced across current holdings.');
    }

    return res.status(200).json({
      success: true,
      data: {
        totalInvested,
        formattedTotalInvested: formatINR(totalInvested),
        cashBalance,
        formattedCashBalance: formatINR(cashBalance),
        riskProfile,
        allocation: {
          equity: { percentage: equityPct, value: equityValue, formatted: formatINR(equityValue) },
          gold: { percentage: goldPct, value: goldValue, formatted: formatINR(goldValue) },
          crypto: { percentage: cryptoPct, value: cryptoValue, formatted: formatINR(cryptoValue) },
          cash: { percentage: cashPct, value: cashBalance, formatted: formatINR(cashBalance) },
          other: { percentage: Math.max(0, 100 - (equityPct + goldPct + cryptoPct + cashPct)), value: otherValue, formatted: formatINR(otherValue) },
        },
        diversificationScore: holdings.length >= 5 ? 'Good' : holdings.length >= 2 ? 'Moderate' : 'Low',
        insights,
        disclaimer: 'AI-generated educational guidance. Not guaranteed investment advice.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/ai/insurance-review
 */
const getInsuranceReview = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [policies, profile, loans] = await Promise.all([
      prisma.insurancePolicy.findMany({ where: { userId, isActive: true } }),
      prisma.financialProfile.findUnique({ where: { userId } }),
      prisma.loan.findMany({ where: { userId, status: 'ACTIVE' } }),
    ]);

    const annualSalary = (parseFloat(profile?.monthlySalary || 0)) * 12;
    const recommendedLifeCover = annualSalary > 0 ? annualSalary * 10 : 5000000;
    const totalDebt = loans.reduce((sum, l) => sum + parseFloat(l.outstandingBalance), 0);

    const lifePolicies = policies.filter(p => p.policyType === 'LIFE');
    const healthPolicies = policies.filter(p => p.policyType === 'HEALTH');

    const totalLifeCover = lifePolicies.reduce((sum, p) => sum + parseFloat(p.coverageAmount), 0);
    const totalHealthCover = healthPolicies.reduce((sum, p) => sum + parseFloat(p.coverageAmount), 0);

    const recommendations = [];

    if (annualSalary > 0 && totalLifeCover < (recommendedLifeCover + totalDebt)) {
      recommendations.push(`Life coverage of ${formatINR(totalLifeCover)} is below recommended term cover (${formatINR(recommendedLifeCover + totalDebt)} including active liabilities).`);
    }

    if (totalHealthCover < 500000) {
      recommendations.push('Health coverage is under ₹5,00,000. Consider adequate base health or top-up insurance for family security.');
    }

    if (policies.length === 0) {
      recommendations.push('No active insurance policies registered. Please review essential health and term life protection.');
    }

    return res.status(200).json({
      success: true,
      data: {
        totalLifeCover,
        formattedTotalLifeCover: formatINR(totalLifeCover),
        totalHealthCover,
        formattedTotalHealthCover: formatINR(totalHealthCover),
        recommendedLifeCover: recommendedLifeCover + totalDebt,
        formattedRecommendedLifeCover: formatINR(recommendedLifeCover + totalDebt),
        totalPolicies: policies.length,
        recommendations,
        disclaimer: 'AI educational guidance. Please consult certified insurance advisors for customized policy underwriting.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/ai/recommendations
 */
const getRecommendations = async (req, res, next) => {
  try {
    const recommendations = await prisma.aiRecommendation.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/ai/recommendations/:id/feedback
 * Feature 30: AI Recommendation Feedback (Helpful, Not Helpful, Already Done)
 */
const submitRecommendationFeedback = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { feedbackType, recommendationTitle, comments } = req.body; // HELPFUL, NOT_HELPFUL, ALREADY_DONE

    const feedback = await prisma.aIRecommendationFeedback.create({
      data: {
        userId,
        recommendationId: req.params.id !== 'custom' ? req.params.id : null,
        recommendationTitle: recommendationTitle || 'AI Financial Tip',
        feedbackType: feedbackType || 'HELPFUL',
        comments: comments || null,
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        feedback,
        message: 'Thank you! Your feedback helps us personalize your financial guidance.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/ai/voice-intent
 * Feature 26: AI Voice Assistant with structured intent parsing & confirmation requirements
 */
const parseVoiceIntent = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { speechText } = req.body;

    if (!speechText || speechText.trim().length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Speech text is required.' } });
    }

    const text = speechText.toLowerCase().trim();
    const ctx = await aiService.getUserFinancialContext(userId);

    // 1. Command: Add expense (Requires confirmation!)
    const addExpenseMatch = text.match(/(?:add|record|spent)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d{1,2})?)\s*(?:rupees|for|on)?\s*([a-z\s]+)?/i) || text.match(/(?:add|record)\s*(?:a|an)?\s*(\d+(?:\.\d{1,2})?)\s*([a-z\s]+)?/i);
    if ((text.startsWith('add') || text.startsWith('record') || text.includes('spent ')) && addExpenseMatch && parseFloat(addExpenseMatch[1]) > 0) {
      const amount = parseFloat(addExpenseMatch[1]);
      let rawCat = (addExpenseMatch[2] || 'Food').replace(/^(?:for|on|in|at)\s+/i, '').replace(/expense/i, '').trim();
      let category = rawCat ? rawCat.charAt(0).toUpperCase() + rawCat.slice(1) : 'Food';
      return res.status(200).json({
        success: true,
        data: {
          intent: 'CREATE_EXPENSE',
          requiresConfirmation: true,
          confirmationMessage: `Do you want to record an expense of ${formatINR(amount)} for ${category}?`,
          pendingPayload: {
            amount,
            category,
            transactionType: 'EXPENSE',
          },
        },
      });
    }

    // 2. Query: Spending check
    if (text.includes('how much') || text.includes('what did i spend') || text.includes('total expense') || text.includes('spending')) {
      return res.status(200).json({
        success: true,
        data: {
          intent: 'QUERY_EXPENSES',
          requiresConfirmation: false,
          spokenResponse: `You have spent ${formatINR(ctx.expensesThisMonth)} this month.`,
          data: { expensesThisMonth: ctx.expensesThisMonth },
        },
      });
    }

    // 3. Query: Portfolio check
    if (text.includes('portfolio') || text.includes('investment') || text.includes('invested')) {
      return res.status(200).json({
        success: true,
        data: {
          intent: 'QUERY_PORTFOLIO',
          requiresConfirmation: false,
          spokenResponse: `Your investment portfolio is currently valued at ${formatINR(ctx.investmentValue)}.`,
          data: { investmentValue: ctx.investmentValue },
        },
      });
    }

    // 4. Query: Net worth check
    if (text.includes('net worth') || text.includes('wealth')) {
      return res.status(200).json({
        success: true,
        data: {
          intent: 'QUERY_NET_WORTH',
          requiresConfirmation: false,
          spokenResponse: `Your total net worth is ${formatINR(ctx.netWorth)}.`,
          data: { netWorth: ctx.netWorth },
        },
      });
    }

    // 5. Query: EMI check
    if (text.includes('emi') || text.includes('loan')) {
      return res.status(200).json({
        success: true,
        data: {
          intent: 'QUERY_EMI',
          requiresConfirmation: false,
          spokenResponse: ctx.monthlyEMI > 0 ? `Your monthly EMI obligation is ${formatINR(ctx.monthlyEMI)} with total outstanding debt of ${formatINR(ctx.totalDebt)}.` : 'You have no active loans or EMIs due.',
          data: { monthlyEMI: ctx.monthlyEMI, totalDebt: ctx.totalDebt },
        },
      });
    }

    // General fallback
    const aiResp = await aiService.chat(userId, speechText);
    return res.status(200).json({
      success: true,
      data: {
        intent: 'GENERAL_ASSISTANT',
        requiresConfirmation: false,
        spokenResponse: aiResp.response,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  chat,
  getChatHistory,
  clearChatHistory,
  getFinancialSnapshot,
  getInvestmentAnalysis,
  getInsuranceReview,
  getRecommendations,
  submitRecommendationFeedback,
  parseVoiceIntent,
};
