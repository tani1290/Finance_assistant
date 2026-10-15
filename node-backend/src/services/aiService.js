const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { calculateHealthScore } = require('../utils/financialMath');
const financialTwin = require('./financialTwinService');

/**
 * AI Service — Gemini Integration with Financial Context
 * Owner: Jinay Golecha (jinay_golecha)
 */

let genAI = null;

const getGeminiClient = () => {
  if (genAI) return genAI;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
    const err = new Error('GEMINI_API_KEY not configured. Using rule-based AI fallback.');
    err.code = 'API_KEY_ERROR';
    throw err;
  }

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    genAI = new GoogleGenerativeAI(apiKey);
    return genAI;
  } catch (e) {
    console.error('[AI] Failed to initialize Gemini:', e.message);
    const err = new Error('Failed to initialize Gemini AI client.');
    err.code = 'SDK_COMPATIBILITY_ERROR';
    throw err;
  }
};

/**
 * Fetch user's financial context from database
 */
const getUserFinancialContext = async (userId) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [user, accounts, monthlyIncome, monthlyExpenses, totalIncome, totalExpenses, goals, loans, portfolio, budgets, topCategories] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    }),
    prisma.financialAccount.aggregate({
      where: { userId, isActive: true },
      _sum: { balance: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, transactionType: 'INCOME', date: { gte: startOfMonth, lte: endOfMonth } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, transactionType: 'EXPENSE', date: { gte: startOfMonth, lte: endOfMonth } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, transactionType: 'INCOME' },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, transactionType: 'EXPENSE' },
      _sum: { amount: true },
    }),
    prisma.goal.findMany({ where: { userId, status: 'ACTIVE' }, take: 5 }),
    prisma.loan.aggregate({
      where: { userId, status: 'ACTIVE' },
      _sum: { outstandingBalance: true, emiAmount: true },
    }),
    prisma.portfolio.findUnique({
      where: { userId },
      select: { totalInvested: true, currentValue: true },
    }),
    prisma.budget.count({ where: { userId } }),
    prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, transactionType: 'EXPENSE', date: { gte: startOfMonth, lte: endOfMonth } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    }),
  ]);

  const totalBalance = parseFloat(accounts._sum.balance || 0);
  const incomeThisMonth = parseFloat(monthlyIncome._sum.amount || 0);
  const expensesThisMonth = parseFloat(monthlyExpenses._sum.amount || 0);
  const savingsThisMonth = incomeThisMonth - expensesThisMonth;
  const totalDebt = parseFloat(loans._sum.outstandingBalance || 0);
  const monthlyEMI = parseFloat(loans._sum.emiAmount || 0);
  const investmentValue = parseFloat(portfolio?.currentValue || 0);
  const investedAmount = parseFloat(portfolio?.totalInvested || 0);
  const investmentPnl = investmentValue - investedAmount;
  const netWorth = totalBalance + investmentValue - totalDebt;

  let healthScore = 50;
  let healthBreakdown = null;
  try {
    const detailedHealth = await financialTwin.calculateDetailedHealthScore(userId);
    healthScore = detailedHealth.overallScore;
    healthBreakdown = detailedHealth.components;
  } catch (err) {
    console.warn('[AI] Failed to calculate 10-factor health score:', err.message);
    healthScore = calculateHealthScore({
      monthlyIncome: incomeThisMonth,
      monthlyExpenses: expensesThisMonth,
      totalSavings: totalBalance,
      totalDebt,
      totalInvestments: investmentValue,
    });
  }

  return {
    user,
    totalBalance,
    incomeThisMonth,
    expensesThisMonth,
    savingsThisMonth,
    totalDebt,
    monthlyEMI,
    investmentValue,
    investedAmount,
    investmentPnl,
    netWorth,
    healthScore,
    goals,
    budgetCount: budgets,
  };
};

/**
 * Build system prompt with user context
 */
const buildSystemPrompt = (ctx) => {
  const { user, totalBalance, incomeThisMonth, expensesThisMonth, savingsThisMonth, totalDebt, investmentValue, netWorth, healthScore, goals } = ctx;
  const name = user?.firstName || 'User';

  return `You are FinPro AI, a professional financial advisor for ${name}.

CRITICAL RULES:
- You ONLY discuss finances for ${name}. Never reveal or use data from any other user.
- Always respond in Indian context. Use ₹ (INR) and Indian numbering (lakhs, crores).
- Be concise, practical, and empathetic. Avoid overwhelming the user.
- If a question is unrelated to personal finance, politely redirect.

USER'S CURRENT FINANCIAL SNAPSHOT (from database):
- Total Bank Balance: ${formatINR(totalBalance)}
- Monthly Income (this month): ${formatINR(incomeThisMonth)}
- Monthly Expenses (this month): ${formatINR(expensesThisMonth)}
- Monthly Savings: ${formatINR(savingsThisMonth)}
- Outstanding Debt: ${formatINR(totalDebt)}
- Investment Portfolio Value: ${formatINR(investmentValue)}
- Net Worth: ${formatINR(netWorth)}
- Financial Health Score: ${healthScore}/100
- Active Goals: ${goals.length} (${goals.map(g => g.name).join(', ') || 'None'})

Based on this data, answer the user's question with personalized advice.`;
};

/**
 * Rule-based AI fallback (no API key needed)
 */
const generateRuleBasedResponse = (userMessage, ctx) => {
  const msg = userMessage.toLowerCase();
  const { totalBalance, incomeThisMonth, expensesThisMonth, savingsThisMonth, totalDebt, investmentValue, netWorth, healthScore, goals } = ctx;

  if (msg.includes('balance') || msg.includes('account')) {
    return `Your current total bank balance is **${formatINR(totalBalance)}**. ${totalBalance > 0 ? 'Great job keeping a positive balance! 💰' : 'Consider adding funds to your account.'}`;
  }

  if (msg.includes('income') || msg.includes('salary') || msg.includes('earn')) {
    return `Your income this month is **${formatINR(incomeThisMonth)}**. ${incomeThisMonth > 0 ? 'Keep tracking all income sources for accurate financial planning.' : 'No income recorded yet this month. Add income transactions to get started.'}`;
  }

  if (msg.includes('expense') || msg.includes('spend') || msg.includes('spent')) {
    return `Your expenses this month total **${formatINR(expensesThisMonth)}**. ${savingsThisMonth > 0 ? `You're saving ${formatINR(savingsThisMonth)} this month — excellent! 🎉` : 'Your expenses exceed income this month. Review your budget to find areas to cut.'}`;
  }

  if (msg.includes('save') || msg.includes('saving')) {
    const rate = incomeThisMonth > 0 ? Math.round((savingsThisMonth / incomeThisMonth) * 100) : 0;
    return `Your savings this month: **${formatINR(savingsThisMonth)}** (${rate}% savings rate). ${rate >= 20 ? 'Excellent savings rate! 🌟' : rate >= 10 ? 'Good, but try to reach 20% savings rate.' : 'Your savings rate is low. Track expenses and cut non-essentials.'}`;
  }

  if (msg.includes('debt') || msg.includes('loan') || msg.includes('emi')) {
    return `Your total outstanding debt: **${formatINR(totalDebt)}**. ${totalDebt > 0 ? 'Focus on high-interest debt first. Consider prepayment to save interest. Use our Loan Prepayment Simulator to see potential savings.' : 'Great! You have no outstanding debt. 🎉'}`;
  }

  if (msg.includes('invest') || msg.includes('portfolio') || msg.includes('stock')) {
    return `Your investment portfolio is currently valued at **${formatINR(investmentValue)}**. ${investmentValue > 0 ? 'Diversify across stocks, mutual funds, gold, and SIPs for better risk management.' : 'You haven\'t started investing yet. Start with ₹500/month SIP in an index fund!'}`;
  }

  if (msg.includes('net worth') || msg.includes('wealth')) {
    return `Your current net worth: **${formatINR(netWorth)}**. This is calculated as Total Assets (Bank + Investments) minus Total Liabilities (Loans). ${netWorth > 0 ? 'Positive net worth — you\'re on the right track! 📈' : 'Focus on reducing debt to improve your net worth.'}`;
  }

  if (msg.includes('health') || msg.includes('score') || msg.includes('how am i doing')) {
    return `Your Financial Health Score: **${healthScore}/100**. ${healthScore >= 80 ? 'Excellent financial health! 🌟' : healthScore >= 60 ? 'Good financial health. Work on savings rate and debt reduction.' : healthScore >= 40 ? 'Fair financial health. Focus on budgeting and building an emergency fund.' : 'Your finances need attention. Start with a budget and emergency fund of 3 months expenses.'}`;
  }

  if (msg.includes('goal')) {
    if (goals.length === 0) {
      return 'You have no active financial goals. Set goals like Emergency Fund (3–6 months expenses), Home Down Payment, or Retirement Fund to stay motivated!';
    }
    return `You have **${goals.length} active goal(s)**: ${goals.map(g => g.name).join(', ')}. Keep contributing regularly to reach them faster!`;
  }

  if (msg.includes('budget')) {
    return `Budgeting is the foundation of financial health. Try the **50/30/20 rule**: 50% Needs, 30% Wants, 20% Savings. Based on your income of ${formatINR(incomeThisMonth)}: Needs (${formatINR(incomeThisMonth * 0.5)}), Wants (${formatINR(incomeThisMonth * 0.3)}), Savings (${formatINR(incomeThisMonth * 0.2)}).`;
  }

  if (msg.includes('tip') || msg.includes('advice') || msg.includes('recommend')) {
    const tips = [
      `Build an emergency fund of ${formatINR(expensesThisMonth * 6)} (6 months of expenses).`,
      'Automate SIPs in index funds — even ₹500/month compounds significantly over time.',
      `Your savings rate is ${incomeThisMonth > 0 ? Math.round((savingsThisMonth / incomeThisMonth) * 100) : 0}%. Target 20%+ for financial independence.`,
      'Review subscriptions monthly — cancel ones you don\'t use.',
      totalDebt > 0 ? `Pay extra on your highest-interest loan to save ${formatINR(totalDebt * 0.02)} in interest.` : 'Stay debt-free and invest the difference!',
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }

  return `I'm here to help with your personal finances, ${ctx.user?.firstName || 'there'}! You can ask me about your balance, savings, expenses, investments, loans, or get financial tips. Your current balance is ${formatINR(totalBalance)} and health score is ${healthScore}/100.`;
};

const CANDIDATE_MODELS = Array.from(
  new Set([
    process.env.AI_MODEL,
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-3.1-pro-preview',
  ].filter(Boolean))
);

/**
 * Main AI chat function
 */
const chat = async (userId, userMessage, chatHistory = []) => {
  const ctx = await getUserFinancialContext(userId);
  let client = null;
  try {
    client = getGeminiClient();
  } catch (err) {
    console.warn('[AI] Gemini client init skipped, using rule-based fallback:', err.message);
  }

  if (!client) {
    // Use rule-based fallback
    const response = generateRuleBasedResponse(userMessage, ctx);
    return {
      response,
      source: 'rule_based',
      context: {
        healthScore: ctx.healthScore,
        netWorth: ctx.netWorth,
        formattedNetWorth: formatINR(ctx.netWorth),
      },
    };
  }

  const systemPrompt = buildSystemPrompt(ctx);
  const history = chatHistory.slice(-10).map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  // Try candidate models in order with timeout
  for (const modelName of CANDIDATE_MODELS) {
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
      });
      const chatSession = model.startChat({
        history,
        generationConfig: {
          maxOutputTokens: 1200,
          temperature: 0.7,
        },
      });

      const callPromise = chatSession.sendMessage(userMessage);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI response timeout (12s)')), 12000)
      );

      const result = await Promise.race([callPromise, timeoutPromise]);
      const response = result.response.text();

      return {
        response,
        source: `gemini (${modelName})`,
        context: {
          healthScore: ctx.healthScore,
          netWorth: ctx.netWorth,
          formattedNetWorth: formatINR(ctx.netWorth),
        },
      };
    } catch (err) {
      console.warn(`[AI] Gemini attempt with ${modelName} failed:`, err.message);
      // Translate common Gemini errors to user-friendly codes
      const msg = err.message || '';
      if (msg.includes('404') || msg.includes('not found')) {
        // Model not found
      } else if (msg.includes('400') || msg.includes('bad request') || msg.includes('invalid')) {
        // Invalid request / unsupported model
      } else if (msg.includes('429') || msg.includes('rate limit')) {
        // Rate limit - continue to next model
      } else if (msg.includes('401') || msg.includes('unauthenticated')) {
        // API key error - fall through to rule-based
      } else if (msg.includes('503') || msg.includes('unavailable')) {
        // Provider unavailable - try next model
      } else if (msg.includes('context') || msg.includes('length')) {
        // Context length exceeded
      }
      // Continue to next model or fall back
    }
  }

  // Fall back to rule-based using real DB context
  const response = generateRuleBasedResponse(userMessage, ctx);
  return {
    response,
    source: 'rule_based_fallback',
    context: {
      healthScore: ctx.healthScore,
      netWorth: ctx.netWorth,
      formattedNetWorth: formatINR(ctx.netWorth),
    },
  };
};

module.exports = { chat, getUserFinancialContext };
