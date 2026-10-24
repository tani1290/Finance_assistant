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
const aiConfirmation = require('../services/aiConfirmationService');
const { TOOL_MAP } = require('../services/aiTools');

// Deterministic fallback intents that change data. VIEW_DATA stays read-only.
const LEGACY_MUTATING_INTENTS = new Set(['ADD_TRANSACTION', 'DELETE_TRANSACTION', 'EDIT_TRANSACTION']);

function confirmationPayload(prepared, extra = {}) {
  return {
    response: prepared.message,
    source: 'ai_confirmation_gate',
    pendingConfirmation: true,
    confirmation: prepared.confirmation,
    sources: ['Financial Ledger Engine'],
    action: {
      executed: false,
      type: prepared.confirmation.toolName,
      requiresConfirmation: true,
      data: null,
    },
    ...extra,
  };
}

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
            pendingConfirmation: Boolean(assistant.pendingConfirmation),
            confirmation: assistant.confirmation || null,
            action: assistant.pendingConfirmation
              ? {
                  executed: false,
                  type: assistant.confirmation?.toolName || null,
                  requiresConfirmation: true,
                  data: null,
                  steps: assistant.steps,
                }
              : acted.length
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

    // 2. FALLBACK: deterministic action engine for the core intents. Anything
    //    that mutates data must be proposed and confirmed, never executed from
    //    the chat text alone.
    const intent = aiActionService.parseActionIntent(message.trim());
    if (intent && LEGACY_MUTATING_INTENTS.has(intent.type)) {
      const prepared = await aiConfirmation.createProposal({
        userId,
        toolName: `legacy:${intent.type}`,
        args: { message: message.trim() },
      });

      await prisma.chatMessage.create({
        data: { userId, role: 'assistant', content: prepared.message },
      });

      return res.status(200).json({
        success: true,
        data: confirmationPayload(prepared, {
          rag: {
            enabled: true,
            sources: ['Financial Ledger Engine'],
            retrievedDocCount: 1,
            intents: [intent.type],
            tenantVerified: true,
          },
        }),
      });
    }

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
          pendingConfirmation: false,
          confirmation: null,
          action: {
            executed: actionResult.success === true,
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
    // Fetch newest-first so `take` caps the *most recent* 50 messages, then
    // reverse to hand the client ascending order. Ordering ascending with a
    // take would silently return the oldest 50 once a conversation grows past
    // the cap, so the client would restore a stale opening instead of the
    // current thread.
    const messages = await prisma.chatMessage.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    messages.reverse();

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
        profileMonthlySalary: ctx.profileMonthlySalary,
        incomeBasis: 'RECORDED_LEDGER_TRANSACTIONS',
        period: ctx.period,
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

/**
 * POST /api/v1/ai/actions/confirm
 * Body: { token, decision: 'CONFIRM' | 'CANCEL' }
 *
 * The token is the one returned by /ai/chat. It is bound server-side to this
 * user, this tool and these exact arguments, stored hashed, and consumed once.
 */
const resolveAction = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { token, decision } = req.body || {};
    const choice = String(decision || 'CONFIRM').toUpperCase();

    if (!['CONFIRM', 'CANCEL'].includes(choice)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'decision must be CONFIRM or CANCEL.' },
      });
    }

    // Chat history is useful but must never change the outcome of a decision
    // that has already been committed to the database.
    const persistAssistantMessage = async (content) => {
      try {
        await prisma.chatMessage.create({
          data: { userId, role: 'assistant', content },
        });
        return true;
      } catch (err) {
        console.warn('[AI-CONFIRM] Could not save assistant message:', err.message);
        return false;
      }
    };

    if (choice === 'CANCEL') {
      const cancelled = await aiConfirmation.cancelProposal(userId, token);
      if (!cancelled.ok) {
        return res.status(cancelled.status).json({ success: false, error: cancelled.error });
      }
      const message = 'Cancelled. Nothing was changed.';
      await persistAssistantMessage(message);
      return res.status(200).json({
        success: true,
        data: {
          response: message,
          cancelled: true,
          executed: false,
          executionState: 'CANCELLED',
          retryable: false,
        },
      });
    }

    // Claim the token before doing any work. A failure here means the mutation
    // never started, even if the confirmation row was already moved to
    // EXECUTING by a dropped connection: a retry will fail closed rather than
    // run the action twice.
    let started;
    try {
      started = await aiConfirmation.beginExecution(userId, token);
    } catch (err) {
      console.error('[AI-CONFIRM] could not start action:', err.message);
      return res.status(503).json({
        success: false,
        error: {
          code: 'ACTION_START_UNAVAILABLE',
          message: 'The action could not be started. No change was applied; retrying cannot run it twice.',
          executionState: 'PENDING',
          retryable: true,
        },
      });
    }
    if (!started.ok) {
      return res.status(started.status).json({ success: false, error: started.error });
    }

    const proposal = started.proposal;
    let result;
    try {
      if (String(proposal.toolName).startsWith('legacy:')) {
        const originalMessage = proposal.args?.message;
        if (!originalMessage) throw new Error('The original request is missing.');
        result = await aiActionService.tryExecuteAction(userId, String(originalMessage));
      } else {
        const tool = TOOL_MAP[proposal.toolName];
        if (!tool) throw new Error('This action is no longer available.');
        const args = proposal.args && typeof proposal.args === 'object' ? proposal.args : {};
        result = await tool.execute(userId, args);
      }
    } catch (err) {
      console.error('[AI-CONFIRM] action failed:', err.message);
      let markedFailed = false;
      try {
        markedFailed = await aiConfirmation.failProposal(proposal.id, `FAILED: ${err.message}`);
      } catch (stateErr) {
        console.error('[AI-CONFIRM] could not record failure:', stateErr.message);
      }
      return res.status(500).json({
        success: false,
        error: {
          code: 'ACTION_OUTCOME_UNKNOWN',
          message: 'The action did not complete cleanly. Check your records before preparing a new request; this confirmation cannot be retried.',
          executionState: markedFailed ? 'FAILED' : 'EXECUTING',
          retryable: false,
        },
      });
    }

    if (result && result.ok === false) {
      const message = result.error || 'The action could not be completed.';
      try {
        await aiConfirmation.failProposal(proposal.id, `REJECTED: ${message}`);
      } catch (stateErr) {
        console.error('[AI-CONFIRM] could not record rejection:', stateErr.message);
      }
      return res.status(422).json({
        success: false,
        error: {
          code: 'ACTION_REJECTED',
          message: `${message} This confirmation cannot be retried.`,
          executionState: 'FAILED',
          retryable: false,
        },
      });
    }

    const response = result?.response || result?.summary || 'Action applied successfully.';
    let stateRecorded = true;
    try {
      stateRecorded = await aiConfirmation.completeProposal(proposal.id, response);
    } catch (stateErr) {
      stateRecorded = false;
      console.error('[AI-CONFIRM] could not record success:', stateErr.message);
    }
    await persistAssistantMessage(response);

    return res.status(200).json({
      success: true,
      data: {
        response,
        source: 'ai_confirmation_gate',
        pendingConfirmation: false,
        confirmation: null,
        executed: true,
        executionState: 'COMPLETED',
        retryable: false,
        auditRecorded: stateRecorded,
        action: {
          executed: true,
          type: proposal.toolName,
          data: result?.data || null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/ai/actions/status
 * Body: { token }
 *
 * Read-only. Reports the current state of a proposal so a client that lost
 * the response to a confirmation request can find out what actually happened
 * instead of guessing. It never changes the proposal.
 */
const getActionStatus = async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const status = await aiConfirmation.getProposalStatus(req.user.id, token);
    if (!status.ok) {
      return res.status(status.status).json({ success: false, error: status.error });
    }
    return res.status(200).json({ success: true, data: status.status });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  chat,
  resolveAction,
  getActionStatus,
  getChatHistory,
  clearChatHistory,
  getFinancialSnapshot,
  getInvestmentAnalysis,
  getInsuranceReview,
  getRecommendations,
  submitRecommendationFeedback,
  parseVoiceIntent,
};
