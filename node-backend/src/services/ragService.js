/**
 * FinPro — Real Retrieval-Augmented Generation (RAG) AI Architecture
 * Owner: Jinay Golecha (jinay_golecha)
 *
 * Architecture Flow:
 * User Question
 *      ↓
 * Authentication (userId = req.user.id strictly enforced)
 *      ↓
 * Intent / Query Understanding
 *      ↓
 * Multi-Domain Financial Retriever (Prisma + PostgreSQL)
 *      ↓
 * User-Specific Knowledge Documents & Metadata Filtering
 *      ↓
 * Relevant Context Assembly (Grounding Boundaries)
 *      ↓
 * Gemini LLM / Deterministic Financial Engine
 *      ↓
 * Grounded Answer (DATABASE FACT | CALCULATED INSIGHT | MODEL RECOMMENDATION)
 *      ↓
 * Citations & Source References
 *      ↓
 * User
 */

const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { calculateHealthScore } = require('../utils/financialMath');

let genAI = null;
const getGeminiClient = () => {
  if (genAI) return genAI;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') return null;
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    genAI = new GoogleGenerativeAI(apiKey);
    return genAI;
  } catch (err) {
    console.warn('[RAG] Gemini initialization failed:', err.message);
    return null;
  }
};

/**
 * 1. Intent / Query Understanding
 * Analyzes semantic domains and temporal scope from user prompt
 */
const analyzeQueryIntent = (query) => {
  const q = query.toLowerCase();

  const intents = new Set();

  if (/spend|spent|expense|purchase|bought|cost|transaction|bill|paid|merchant|grocery|food|shopping|swiggy|zomato|starbucks/i.test(q)) {
    intents.add('TRANSACTIONS');
  }
  if (/balance|account|bank|cash|liquid|money/i.test(q)) {
    intents.add('ACCOUNTS');
  }
  if (/budget|overspend|limit|allowance|allocation/i.test(q)) {
    intents.add('BUDGETS');
  }
  if (/goal|target|save for|emergency fund|milestone/i.test(q)) {
    intents.add('GOALS');
  }
  if (/invest|portfolio|stock|share|gold|silver|mutual fund|sip|pnl|wealth/i.test(q)) {
    intents.add('INVESTMENTS');
  }
  if (/loan|emi|debt|borrow|repay|prepayment|interest/i.test(q)) {
    intents.add('LOANS');
  }
  if (/insurance|policy|premium|cover/i.test(q)) {
    intents.add('INSURANCE');
  }
  if (/subscription|recurring|netflix|spotify|gym|membership/i.test(q)) {
    intents.add('SUBSCRIPTIONS');
  }
  if (/receipt|scan|invoice|ocr|bill photo/i.test(q)) {
    intents.add('RECEIPTS_OCR');
  }
  if (/health|score|credit|afford|financial position|runway|cash flow/i.test(q)) {
    intents.add('HEALTH_CASHFLOW');
  }

  // If no specific keyword matched, retrieve broad financial snapshot
  if (intents.size === 0) {
    intents.add('ACCOUNTS');
    intents.add('TRANSACTIONS');
    intents.add('BUDGETS');
    intents.add('GOALS');
  }

  return Array.from(intents);
};

/**
 * 2. Multi-Domain Knowledge Retriever
 * Strictly enforces `where: { userId }` across all tables.
 * Tenant isolation guarantee: Zero cross-tenant data access.
 */
const retrieveFinancialKnowledge = async (userId, intents) => {
  if (!userId) {
    throw new Error('Tenant Isolation Security: User ID is required for RAG retrieval.');
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const knowledgeDocs = [];
  const sources = new Set();

  // Retrieve user identity
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, firstName: true, lastName: true, currency: true },
  });

  // Intent: ACCOUNTS
  if (intents.includes('ACCOUNTS') || intents.includes('HEALTH_CASHFLOW')) {
    const accounts = await prisma.financialAccount.findMany({
      where: { userId, isActive: true },
      select: { id: true, name: true, accountType: true, balance: true, currency: true, updatedAt: true },
    });
    let totalBal = 0;
    accounts.forEach(acc => {
      const b = parseFloat(acc.balance);
      totalBal += b;
      knowledgeDocs.push({
        id: `acc-${acc.id}`,
        sourceType: 'ACCOUNT',
        sourceTitle: `Account — ${acc.name}`,
        metadata: { userId, sourceType: 'FinancialAccount', sourceId: acc.id, updatedAt: acc.updatedAt },
        text: `Account "${acc.name}" (${acc.accountType}): Current Balance ${formatINR(b)} ${acc.currency}.`,
      });
      sources.add(`Account — ${acc.name}`);
    });
    knowledgeDocs.push({
      id: `acc-total`,
      sourceType: 'ACCOUNT_AGGREGATE',
      sourceTitle: 'Accounts — Total Liquid Balance',
      metadata: { userId, sourceType: 'Aggregate', sourceId: 'accounts_total' },
      text: `Total Liquid Bank Balance across all active accounts: ${formatINR(totalBal)}.`,
    });
  }

  // Intent: TRANSACTIONS
  if (intents.includes('TRANSACTIONS') || intents.includes('HEALTH_CASHFLOW') || intents.includes('BUDGETS')) {
    const recentTx = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 25,
      include: { category: true, account: true },
    });

    const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    let monthExpenseSum = 0;
    let monthIncomeSum = 0;
    const categorySpending = {};

    recentTx.forEach(tx => {
      const amt = parseFloat(tx.amount);
      const dStr = new Date(tx.date).toISOString().slice(0, 10);
      const catName = tx.category?.name || 'Uncategorized';

      if (tx.date >= startOfMonth && tx.date <= endOfMonth) {
        if (tx.transactionType === 'EXPENSE') {
          monthExpenseSum += amt;
          categorySpending[catName] = (categorySpending[catName] || 0) + amt;
        } else if (tx.transactionType === 'INCOME') {
          monthIncomeSum += amt;
        }
      }

      knowledgeDocs.push({
        id: `tx-${tx.id}`,
        sourceType: 'TRANSACTION',
        sourceTitle: `Transactions — ${monthName}`,
        metadata: { userId, sourceType: 'Transaction', sourceId: tx.id, createdAt: tx.createdAt },
        text: `Transaction on ${dStr}: ${tx.transactionType} ${formatINR(amt)} at "${tx.merchant || tx.description || 'Merchant'}" [Category: ${catName}].`,
      });
      sources.add(`Transactions — ${monthName}`);
    });

    // Top Category Calculation
    let topCategory = 'None';
    let topCategoryAmount = 0;
    Object.entries(categorySpending).forEach(([cat, amt]) => {
      if (amt > topCategoryAmount) {
        topCategoryAmount = amt;
        topCategory = cat;
      }
    });

    knowledgeDocs.push({
      id: `tx-monthly-summary`,
      sourceType: 'TRANSACTION_SUMMARY',
      sourceTitle: `Transactions — Monthly Summary (${monthName})`,
      metadata: { userId, sourceType: 'TransactionSummary', sourceId: 'monthly_summary' },
      text: `For ${monthName}: Total Income = ${formatINR(monthIncomeSum)}, Total Expenses = ${formatINR(monthExpenseSum)}, Highest Spending Category = "${topCategory}" with ${formatINR(topCategoryAmount)}.`,
    });
  }

  // Intent: BUDGETS
  if (intents.includes('BUDGETS') || intents.includes('HEALTH_CASHFLOW')) {
    const budgets = await prisma.budget.findMany({
      where: { userId },
      include: { category: true },
    });
    budgets.forEach(b => {
      const limit = parseFloat(b.monthlyLimit || b.amount || 0);
      const spent = parseFloat(b.spent || 0);
      const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      const catName = b.categoryName || b.category?.name || 'General';
      const status = spent > limit ? 'OVERSPENT' : pct >= 80 ? 'NEAR_LIMIT' : 'WITHIN_BUDGET';

      knowledgeDocs.push({
        id: `budget-${b.id}`,
        sourceType: 'BUDGET',
        sourceTitle: `Budget — ${catName}`,
        metadata: { userId, sourceType: 'Budget', sourceId: b.id, updatedAt: b.updatedAt },
        text: `Budget for "${catName}": Allocated ${formatINR(limit)}, Spent ${formatINR(spent)} (${pct}% used - Status: ${status}).`,
      });
      sources.add(`Budget — ${catName}`);
    });
  }

  // Intent: GOALS
  if (intents.includes('GOALS') || intents.includes('HEALTH_CASHFLOW')) {
    const goals = await prisma.goal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    goals.forEach(g => {
      const target = parseFloat(g.targetAmount);
      const current = parseFloat(g.currentAmount);
      const pct = target > 0 ? Math.round((current / target) * 100) : 0;
      knowledgeDocs.push({
        id: `goal-${g.id}`,
        sourceType: 'GOAL',
        sourceTitle: `Goal — ${g.name}`,
        metadata: { userId, sourceType: 'Goal', sourceId: g.id, createdAt: g.createdAt },
        text: `Financial Goal "${g.name}": Target ${formatINR(target)}, Saved ${formatINR(current)} (${pct}% completed, Status: ${g.status}).`,
      });
      sources.add(`Goal — ${g.name}`);
    });
  }

  // Intent: INVESTMENTS
  if (intents.includes('INVESTMENTS') || intents.includes('HEALTH_CASHFLOW')) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { userId },
      include: { investments: true },
    });
    if (portfolio) {
      const invested = parseFloat(portfolio.totalInvested || 0);
      const current = parseFloat(portfolio.currentValue || 0);
      const pnl = current - invested;
      const count = portfolio.investments ? portfolio.investments.length : 0;
      knowledgeDocs.push({
        id: `inv-${portfolio.id}`,
        sourceType: 'INVESTMENT',
        sourceTitle: 'Portfolio — Investments',
        metadata: { userId, sourceType: 'Portfolio', sourceId: portfolio.id, updatedAt: portfolio.updatedAt },
        text: `Investment Portfolio: Total Invested = ${formatINR(invested)}, Current Value = ${formatINR(current)}, P&L = ${formatINR(pnl)} (${count} assets held).`,
      });
      sources.add('Portfolio — Investments');
    }
  }

  // Intent: LOANS
  if (intents.includes('LOANS') || intents.includes('HEALTH_CASHFLOW')) {
    const loans = await prisma.loan.findMany({
      where: { userId, status: 'ACTIVE' },
    });
    loans.forEach(l => {
      const balance = parseFloat(l.outstandingBalance);
      const emi = parseFloat(l.emiAmount || 0);
      knowledgeDocs.push({
        id: `loan-${l.id}`,
        sourceType: 'LOAN',
        sourceTitle: `Loan — ${l.lenderName || l.loanType}`,
        metadata: { userId, sourceType: 'Loan', sourceId: l.id, updatedAt: l.updatedAt },
        text: `Active Loan "${l.lenderName || l.loanType}": Outstanding Balance ${formatINR(balance)}, Monthly EMI ${formatINR(emi)} at ${l.interestRate}% interest.`,
      });
      sources.add(`Loan — ${l.lenderName || l.loanType}`);
    });
  }

  // Intent: SUBSCRIPTIONS
  if (intents.includes('SUBSCRIPTIONS')) {
    const subs = await prisma.subscription.findMany({
      where: { userId, isActive: true },
    });
    let totalSubCost = 0;
    subs.forEach(s => {
      const cost = parseFloat(s.cost);
      totalSubCost += cost;
      knowledgeDocs.push({
        id: `sub-${s.id}`,
        sourceType: 'SUBSCRIPTION',
        sourceTitle: `Subscription — ${s.serviceName}`,
        metadata: { userId, sourceType: 'Subscription', sourceId: s.id },
        text: `Subscription "${s.serviceName}": ${formatINR(cost)} / ${s.billingCycle}.`,
      });
      sources.add(`Subscription — ${s.serviceName}`);
    });
    if (subs.length > 0) {
      knowledgeDocs.push({
        id: `sub-total`,
        sourceType: 'SUBSCRIPTION_TOTAL',
        sourceTitle: 'Subscriptions — Total Recurring',
        metadata: { userId, sourceType: 'Aggregate', sourceId: 'subscriptions_total' },
        text: `Total Monthly Recurring Subscriptions across ${subs.length} services: ${formatINR(totalSubCost)}.`,
      });
    }
  }

  // Intent: RECEIPTS_OCR
  if (intents.includes('RECEIPTS_OCR') || intents.includes('TRANSACTIONS')) {
    const receipts = await prisma.receiptScan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    receipts.forEach(r => {
      const amt = r.amount ? parseFloat(r.amount) : 0;
      knowledgeDocs.push({
        id: `receipt-${r.id}`,
        sourceType: 'OCR_RECEIPT',
        sourceTitle: `Receipt — ${r.merchant || 'Merchant Scan'}`,
        metadata: { userId, sourceType: 'ReceiptScan', sourceId: r.id, createdAt: r.createdAt },
        text: `Scanned Receipt from "${r.merchant || 'Merchant'}" on ${r.date ? new Date(r.date).toISOString().slice(0, 10) : 'Recent'}: Amount ${amt > 0 ? formatINR(amt) : 'Unrecognized'} [Category: ${r.category || 'General'}, Status: ${r.status}].`,
      });
      sources.add(`Receipt — ${r.merchant || 'OCR Scan'}`);
    });
  }

  // Intent: HEALTH_CASHFLOW
  if (intents.includes('HEALTH_CASHFLOW')) {
    const [accountsSum, monthlyExp, monthlyInc, loansSum, portfolio] = await Promise.all([
      prisma.financialAccount.aggregate({ where: { userId, isActive: true }, _sum: { balance: true } }),
      prisma.transaction.aggregate({ where: { userId, transactionType: 'EXPENSE', date: { gte: startOfMonth, lte: endOfMonth } }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { userId, transactionType: 'INCOME', date: { gte: startOfMonth, lte: endOfMonth } }, _sum: { amount: true } }),
      prisma.loan.aggregate({ where: { userId, status: 'ACTIVE' }, _sum: { outstandingBalance: true, emiAmount: true } }),
      prisma.portfolio.findUnique({ where: { userId }, select: { currentValue: true } }),
    ]);

    const bal = parseFloat(accountsSum._sum.balance || 0);
    const exp = parseFloat(monthlyExp._sum.amount || 0);
    const inc = parseFloat(monthlyInc._sum.amount || 0);
    const debt = parseFloat(loansSum._sum.outstandingBalance || 0);
    const emi = parseFloat(loansSum._sum.emiAmount || 0);
    const inv = parseFloat(portfolio?.currentValue || 0);
    const netWorth = bal + inv - debt;
    const score = calculateHealthScore({ monthlyIncome: inc, monthlyExpenses: exp, totalSavings: bal, totalDebt: debt, totalInvestments: inv });

    knowledgeDocs.push({
      id: `health-overview`,
      sourceType: 'HEALTH',
      sourceTitle: 'Financial Health & Snapshot',
      metadata: { userId, sourceType: 'HealthSnapshot', sourceId: 'health_overview' },
      text: `Financial Health Score: ${score}/100. Net Worth: ${formatINR(netWorth)}. Total Debt: ${formatINR(debt)}. Monthly EMI: ${formatINR(emi)}. Monthly Savings: ${formatINR(inc - exp)}.`,
    });
    sources.add('Financial Health & Snapshot');
  }

  return {
    user,
    knowledgeDocs,
    sources: Array.from(sources),
  };
};

/**
 * 3. Context Assembly & Grounding Boundaries
 */
const buildGroundedRAGContext = (retrievalResult, userMessage) => {
  const { user, knowledgeDocs, sources } = retrievalResult;
  const userName = user?.firstName || 'User';

  const factsBlock = knowledgeDocs.length > 0
    ? knowledgeDocs.map(d => `• [${d.sourceTitle}] ${d.text}`).join('\n')
    : 'No financial records found in database for this user yet.';

  const systemInstruction = `You are FinPro AI, a grounded, highly accurate financial intelligence copilot and advisor for ${userName}.
You operate as an intelligent financial assistant with both Retrieval-Augmented Generation (RAG) and transactional action execution capabilities (adding expenses/income, viewing user data, editing transactions, and removing expenses).

STRICT GROUNDING & ACTION RULES:
1. Ground every statement in the RETRIEVED USER FINANCIAL KNOWLEDGE below.
2. If the user wants to add an expense, view their data, edit a transaction, or delete an expense, FinPro AI Action Engine supports direct execution (e.g. "Add 10000 expense as bday party for 15/oct 26 paid by cash", "View user data", "Edit bday party to 8000", "Delete last expense").
3. If the user asks about facts not present in the records below, state: "That information is unavailable in your financial records." NEVER invent or hallucinate financial figures.
4. Structure advisory responses clearly into these sections when appropriate:
   - DATABASE FACT: Precise numbers retrieved from user records.
   - CALCULATED INSIGHT: Clear calculations based on the facts (e.g. savings rate, affordability, totals).
   - MODEL RECOMMENDATION: Personalized, actionable financial advice based on the user's situation.
5. Currency is always Indian Rupee (₹, INR).
6. At the bottom of your answer, list the exact sources used:
   Sources:
   ${sources.map(s => `• ${s}`).join('\n')}

RETRIEVED USER FINANCIAL KNOWLEDGE (Verified Tenant ID: ${user?.id}):
============================================================
${factsBlock}
============================================================`;

  return {
    systemInstruction,
    factsBlock,
    sources,
  };
};

/**
 * 4. Deterministic Financial Reasoning Engine (Grounding Fallback)
 * Generates accurate, grounded responses directly from retrieved documents
 */
const generateDeterministicGroundedResponse = (userMessage, retrievalResult) => {
  const q = userMessage.toLowerCase();
  const { knowledgeDocs, sources, user } = retrievalResult;
  const name = user?.firstName || 'User';

  // 1. Where did I spend the most / spending
  if (/where did i spend the most|highest spending|spend most|biggest expense/i.test(q)) {
    const summaryDoc = knowledgeDocs.find(d => d.sourceType === 'TRANSACTION_SUMMARY');
    const txDocs = knowledgeDocs.filter(d => d.sourceType === 'TRANSACTION');
    if (summaryDoc) {
      return `**DATABASE FACT:**\n${summaryDoc.text}\n\n**CALCULATED INSIGHT:**\nYour highest expenditure is concentrated in your top category. Reviewing transactions shows active spending in this area.\n\n**MODEL RECOMMENDATION:**\nSet a category spending limit or budget alert in FinPro to prevent overshooting your monthly discretionary target.\n\n**Sources:**\n${sources.map(s => `• ${s}`).join('\n')}`;
    }
    return `**DATABASE FACT:**\nNo recorded expense transactions found for this month.\n\n**MODEL RECOMMENDATION:**\nLog or scan your recent receipts to start tracking spending categories.\n\n**Sources:**\n• Transactions`;
  }

  // 2. Can I afford purchase
  const affordMatch = q.match(/afford.*?(\d[\d,]*)/i);
  if (affordMatch || /afford/i.test(q)) {
    const targetAmt = affordMatch ? parseFloat(affordMatch[1].replace(/,/g, '')) : 5000;
    const accDoc = knowledgeDocs.find(d => d.sourceType === 'ACCOUNT_AGGREGATE');
    const healthDoc = knowledgeDocs.find(d => d.sourceType === 'HEALTH');
    const totalBal = parseFloat((accDoc?.text || '').match(/₹([\d,]+)/)?.[1]?.replace(/,/g, '') || '0');

    const canAfford = totalBal >= targetAmt * 1.5;
    return `**DATABASE FACT:**\n${accDoc?.text || `Total liquid balance: ${formatINR(totalBal)}`}.\nTarget purchase: ${formatINR(targetAmt)}.\n\n**CALCULATED INSIGHT:**\n${canAfford ? `You have sufficient liquid funds (${formatINR(totalBal)}) to cover this ${formatINR(targetAmt)} purchase while maintaining a safety buffer.` : `This purchase represents a significant portion (${Math.round((targetAmt / (totalBal || 1)) * 100)}%) of your available liquid balance (${formatINR(totalBal)}).`}\n\n**MODEL RECOMMENDATION:**\n${canAfford ? 'Purchase is affordable within current cash flow. Ensure it does not dip into your emergency fund.' : 'Consider delaying non-essential purchases until next month’s income or funding it through planned savings.'}\n\n**Sources:**\n${sources.map(s => `• ${s}`).join('\n')}`;
  }

  // 3. Health score / Why did score fall
  if (/health score|score/i.test(q)) {
    const healthDoc = knowledgeDocs.find(d => d.sourceType === 'HEALTH');
    return `**DATABASE FACT:**\n${healthDoc?.text || 'Health score evaluated against active financial telemetry.'}\n\n**CALCULATED INSIGHT:**\nFinPro calculates your score across 10 factors: savings rate, debt-to-income ratio, emergency fund coverage, and investment allocation.\n\n**MODEL RECOMMENDATION:**\nTo improve your score: 1) Maintain at least 3 months expenses in liquid savings, 2) Keep debt EMI under 30% of income, and 3) Automate monthly investments.\n\n**Sources:**\n• Financial Health & Snapshot`;
  }

  // 4. EMI / Loans
  if (/emi|loan|debt/i.test(q)) {
    const loanDocs = knowledgeDocs.filter(d => d.sourceType === 'LOAN');
    if (loanDocs.length === 0) {
      return `**DATABASE FACT:**\nYou currently have zero outstanding loans or EMIs recorded in your profile.\n\n**MODEL RECOMMENDATION:**\nMaintaining zero debt gives you strong financial resilience. Redirect potential EMI amounts into SIP investments.\n\n**Sources:**\n• Loan Records`;
    }
    return `**DATABASE FACT:**\n${loanDocs.map(d => `• ${d.text}`).join('\n')}\n\n**CALCULATED INSIGHT:**\nYour active loan liabilities require recurring monthly commitments.\n\n**MODEL RECOMMENDATION:**\nUse FinPro's Loan Prepayment Simulator to calculate interest savings from extra principal payments.\n\n**Sources:**\n${sources.map(s => `• ${s}`).join('\n')}`;
  }

  // 5. Investments / Portfolio
  if (/invest|portfolio|stock|wealth/i.test(q)) {
    const invDoc = knowledgeDocs.find(d => d.sourceType === 'INVESTMENT');
    if (!invDoc) {
      return `**DATABASE FACT:**\nNo active investment portfolio records found.\n\n**MODEL RECOMMENDATION:**\nStart building your investment journey with an index fund SIP or gold accumulation.\n\n**Sources:**\n• Portfolio — Investments`;
    }
    return `**DATABASE FACT:**\n${invDoc.text}\n\n**CALCULATED INSIGHT:**\nYour assets are actively tracked against live market valuations.\n\n**MODEL RECOMMENDATION:**\nRebalance periodically to match your risk profile across equities, fixed income, and commodities.\n\n**Sources:**\n${sources.map(s => `• ${s}`).join('\n')}`;
  }

  // 6. Budgets overspending
  if (/budget|overspend/i.test(q)) {
    const budgetDocs = knowledgeDocs.filter(d => d.sourceType === 'BUDGET');
    if (budgetDocs.length === 0) {
      return `**DATABASE FACT:**\nNo budget limits configured yet.\n\n**MODEL RECOMMENDATION:**\nCreate budgets for your top expense categories (Groceries, Dining, Shopping) to track monthly caps.\n\n**Sources:**\n• Budget Records`;
    }
    return `**DATABASE FACT:**\n${budgetDocs.map(d => `• ${d.text}`).join('\n')}\n\n**CALCULATED INSIGHT:**\nBudgets help monitor burn rate and trigger warnings when thresholds are approached.\n\n**MODEL RECOMMENDATION:**\nPrioritize essential categories and curb discretionary spending if near or exceeding 80% limit.\n\n**Sources:**\n${sources.map(s => `• ${s}`).join('\n')}`;
  }

  // General grounded synthesis
  return `**DATABASE FACT:**\n${knowledgeDocs.slice(0, 4).map(d => `• ${d.text}`).join('\n')}\n\n**CALCULATED INSIGHT:**\nFinancial telemetry retrieved across ${sources.length} authenticated sources for ${name}.\n\n**MODEL RECOMMENDATION:**\nTrack transactions regularly and consult the AI Advisor for scenario simulations and budget health.\n\n**Sources:**\n${sources.map(s => `• ${s}`).join('\n')}`;
};

/**
 * 5. Main RAG Pipeline Execution
 */
const runRAGPipeline = async (userId, userMessage, chatHistory = []) => {
  // Step 1: Authentication & Tenant Verification
  if (!userId) {
    throw new Error('Authentication required for RAG AI querying.');
  }

  // Step 2: Intent Understanding
  const intents = analyzeQueryIntent(userMessage);

  // Step 3: User-Specific Financial Knowledge Retrieval
  const retrievalResult = await retrieveFinancialKnowledge(userId, intents);

  // Step 4: Context Assembly & Grounding Instruction
  const ragContext = buildGroundedRAGContext(retrievalResult, userMessage);

  // Step 5: LLM Generation (Gemini with candidate models)
  const client = getGeminiClient();
  let responseText = null;
  let modelSource = 'deterministic_grounded_engine';

  if (client) {
    const CANDIDATE_MODELS = Array.from(
      new Set([
        process.env.AI_MODEL,
        'gemini-3.5-flash-lite',
        'gemini-3.8-flash',
        'gemini-flash-latest',
        'gemini-3.1-pro-preview',
      ].filter(Boolean))
    );

    const history = chatHistory.slice(-6).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    // The AI provider is OPTIONAL infrastructure. A slow or unreachable provider
    // must degrade gracefully to the deterministic grounded engine instead of
    // blocking the request handler for (candidateModels × per-model timeout)
    // seconds. We therefore impose a single bounded budget across all attempts;
    // each individual attempt is additionally capped by the remaining budget.
    const PER_MODEL_TIMEOUT_MS = 12000;
    const parsedBudget = parseInt(process.env.AI_LLM_TOTAL_TIMEOUT_MS, 10);
    const TOTAL_BUDGET_MS = Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : 4000;
    const deadline = Date.now() + TOTAL_BUDGET_MS;

    for (const modelName of CANDIDATE_MODELS) {
      const remaining = deadline - Date.now();
      if (remaining < 200) {
        console.warn('[RAG] AI provider budget exhausted; using deterministic grounded engine.');
        break;
      }
      try {
        const model = client.getGenerativeModel({
          model: modelName,
          systemInstruction: ragContext.systemInstruction,
        });
        const chatSession = model.startChat({
          history,
          generationConfig: {
            maxOutputTokens: 1200,
            temperature: 0.3, // Low temperature for factual grounding
          },
        });

        const attemptTimeoutMs = Math.min(PER_MODEL_TIMEOUT_MS, remaining);
        let timer;
        const callPromise = chatSession.sendMessage(userMessage);
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`AI response timeout (${attemptTimeoutMs}ms)`)), attemptTimeoutMs);
        });

        let result;
        try {
          result = await Promise.race([callPromise, timeoutPromise]);
        } finally {
          // Always clear the timer so a successful (or failed) call never leaves
          // a lingering 12s handle keeping the event loop alive.
          clearTimeout(timer);
        }
        responseText = result.response.text();
        modelSource = `gemini-rag (${modelName})`;
        break;
      } catch (err) {
        console.warn(`[RAG] Model ${modelName} call failed:`, err.message);
      }
    }
  }

  // Fallback to deterministic grounded financial engine if LLM fails or API key unavailable
  if (!responseText) {
    responseText = generateDeterministicGroundedResponse(userMessage, retrievalResult);
  }

  return {
    response: responseText,
    source: modelSource,
    sources: retrievalResult.sources,
    retrievedDocCount: retrievalResult.knowledgeDocs.length,
    intents,
    tenantVerified: true,
  };
};

module.exports = {
  runRAGPipeline,
  analyzeQueryIntent,
  retrieveFinancialKnowledge,
  buildGroundedRAGContext,
};
