const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const financialTwin = require('./financialTwinService');
const notificationService = require('./notificationService');
const realtime = require('./realtimeService');

/**
 * Publish a deterministic AI action onto the realtime bus so every other
 * device reflects it immediately. Mirrors `aiTools.emit()`: a
 * `<resource>.changed` event (what the page reloaders subscribe to) plus a
 * typed `ai.action` used only for the cross-device "assistant did something"
 * notice. Never allowed to break the action itself.
 */
function emit(userId, action, resource, extra = {}) {
  try {
    realtime.publish(
      userId,
      `${resource}.changed`,
      { resource, action: 'changed', via: 'ai', ...extra },
      { source: 'ai' }
    );
    realtime.publish(userId, 'ai.action', { tool: action, resource, ...extra }, { source: 'ai' });
  } catch (_) {
    /* realtime must never break an action */
  }
}

/**
 * AI Action Service
 * Empowers the FinPro AI Assistant to execute user actions:
 * 1. ADD_TRANSACTION (Expense / Income) with natural parameter & date extraction
 * 2. VIEW_USER_DATA (Comprehensive ledger, balances, budget, and goal summary)
 * 3. DELETE_TRANSACTION (Reverts account balance and deletes record)
 * 4. EDIT_TRANSACTION (Adjusts amounts, categories, or descriptions with balance sync)
 */

/**
 * Parse natural language dates like:
 * - "15/oct 26", "15/oct/2026", "15-oct-2026", "15 oct 2026"
 * - "15/10/26", "15/10/2026", "15-10-2026", "2026-10-15"
 * - "today", "yesterday"
 */
function parseNaturalDate(dateStr) {
  if (!dateStr) return new Date();
  const s = dateStr.trim().toLowerCase();
  const now = new Date();

  if (s === 'today') return now;
  if (s === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  }

  const monthNames = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  // Match: 15/oct 26, 15/oct/2026, 15-oct-2026, 15 oct 26
  const dmyText = s.match(/(\d{1,2})[\/\-\s]+([a-z]{3,9})[\/\-\s]+(\d{2,4})/i);
  if (dmyText) {
    const day = parseInt(dmyText[1], 10);
    const monthKey = dmyText[2].toLowerCase();
    let year = parseInt(dmyText[3], 10);
    if (year < 100) year += 2000;
    const month = monthNames[monthKey];
    if (month !== undefined) {
      return new Date(Date.UTC(year, month, day));
    }
  }

  // Match: 15/10/26, 15/10/2026, 15-10-2026
  const dmyNum = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmyNum) {
    const day = parseInt(dmyNum[1], 10);
    const month = parseInt(dmyNum[2], 10) - 1;
    let year = parseInt(dmyNum[3], 10);
    if (year < 100) year += 2000;
    return new Date(Date.UTC(year, month, day));
  }

  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? now : parsed;
}

/**
 * Infer category name based on description keywords
 */
function inferCategory(description = '', type = 'EXPENSE') {
  const d = description.toLowerCase();

  if (type === 'INCOME') {
    if (/salary|payroll|wages/i.test(d)) return 'Salary';
    if (/freelance|consult|upwork|fiverr|client/i.test(d)) return 'Freelancing';
    if (/dividend|interest|stock|profit|yield/i.test(d)) return 'Investment Income';
    if (/refund|cashback|bonus|gift/i.test(d)) return 'Other Income';
    return 'Income';
  }

  // Expense categories
  if (/bday|birthday|party|club|celebrat|bar|nightclub|outing/i.test(d)) return 'Events & Entertainment';
  if (/grocer|supermarket|vegetable|fruit|milk|bazaar|ration/i.test(d)) return 'Groceries';
  if (/swiggy|zomato|coffee|cafe|starbucks|restaurant|dining|lunch|dinner|breakfast|food|pizza|burger/i.test(d)) return 'Food & Dining';
  if (/uber|ola|cab|auto|taxi|metro|fuel|petrol|diesel|toll|parking|flight|train/i.test(d)) return 'Transportation';
  if (/rent|maintenance|society/i.test(d)) return 'Housing & Rent';
  if (/electricity|water|wifi|broadband|internet|recharge|mobile|utility|gas/i.test(d)) return 'Utilities';
  if (/amazon|flipkart|shopping|clothes|apparel|shoes|myntra|zara/i.test(d)) return 'Shopping';
  if (/hospital|doctor|medicine|pharmacy|clinic|medical|health/i.test(d)) return 'Healthcare';
  if (/netflix|spotify|prime|hotstar|movie|cinema|theatre|game|gaming/i.test(d)) return 'Entertainment';
  if (/sip|mutual fund|zerodha|groww|stock|crypto|etf/i.test(d)) return 'Investment';
  if (/emi|loan|credit card bill/i.test(d)) return 'Debt & EMI';
  if (/course|book|tuition|exam|college|school/i.test(d)) return 'Education';

  return 'General Expense';
}

/**
 * Detect Action Intent from user message
 */
function parseActionIntent(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // 1. View User Data (also handles common typos like 'veriw user data')
  if (
    /(\b|^)(veriw|view|show|display|get|list|fetch|see)\b.*(\b(user\s*data|my\s*data|financial\s*data|finances?|balances?|accounts?|profile|summary|overview|status)\b)/i.test(lower) ||
    /^(veriw|view|show)\s+(user\s+)?data$/i.test(lower) ||
    /^user\s+data$/i.test(lower) ||
    /(\b|^)(my\s+financial\s+status|account\s+balances?|show\s+my\s+ledger)\b/i.test(lower)
  ) {
    return { type: 'VIEW_DATA' };
  }

  // 2. Remove / Delete Transaction
  if (
    /(\b|^)(remove|delete|cancel|erase|drop)\b.*(\b(expense|income|transaction|item|spending|record)\b)/i.test(lower) ||
    /^delete\s+(last|latest)/i.test(lower)
  ) {
    return { type: 'DELETE_TRANSACTION' };
  }

  // 3. Edit / Update Transaction
  if (
    /(\b|^)(edit|update|change|modify|correct|adjust)\b.*(\b(expense|income|transaction|entry|amount|category|cost)\b)/i.test(lower) ||
    /^edit\s+(last|latest)/i.test(lower) ||
    // Natural form advertised to users: "Edit bday party to 8000".
    // Guard against non-transaction entities (budget/goal/etc.) so they are not mis-routed.
    /^(edit|update|change|modify|correct|adjust|set)\b(?!.*\b(budget|goal|target|limit|salary|profile|password|email|settings?|currency|plan|subscription)\b).*\b(?:to|amount)\b[^\d]*[₹$]?\s*\d/i.test(lower)
  ) {
    return { type: 'EDIT_TRANSACTION' };
  }

  // 4. Add / Record Transaction
  if (
    /(\b|^)(add|record|log|insert|create|spend|spent|paid|bought)\b.*(\b(expense|income|transaction|spent|cost|rupees|rs\.?|inr|₹|\d+)\b)/i.test(lower) ||
    /^(add|record|spend)\s+\d+/i.test(lower)
  ) {
    return { type: 'ADD_TRANSACTION' };
  }

  return null;
}

/**
 * 1. Handle ADD TRANSACTION
 * Parses: "add 10000 expense as bday party for 15/oct 26 , paid. by cash"
 */
async function handleAddTransaction(userId, text) {
  // Extract Amount: e.g. 10000, 10,000, ₹10000, rs 10000, 500.50
  const amtMatch = text.match(/(?:rs\.?|inr|₹|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
  if (!amtMatch) {
    return {
      handled: true,
      action: 'ADD_TRANSACTION',
      success: false,
      response: `⚠️ **Missing Amount**\n\nI couldn't detect the transaction amount in your message. Please specify an amount, for example:\n> \`Add 10000 expense as bday party for 15/oct 26, paid by cash\`\n> \`Add 500 expense for coffee\`\n> \`Add 75000 income as freelance client payment\``,
    };
  }

  const rawAmount = amtMatch[1].replace(/,/g, '');
  const amount = parseFloat(rawAmount);
  if (isNaN(amount) || amount <= 0) {
    return {
      handled: true,
      action: 'ADD_TRANSACTION',
      success: false,
      response: `⚠️ **Invalid Amount**\n\nPlease provide a positive transaction amount.`,
    };
  }

  // Determine Type: EXPENSE vs INCOME
  const isIncome = /\b(income|salary|earned|credit|credited|received|bonus|dividend)\b/i.test(text);
  const transactionType = isIncome ? 'INCOME' : 'EXPENSE';

  // Extract Date: e.g. "for 15/oct 26", "on 15/10/2026", "yesterday", "today"
  let parsedDate = new Date();
  const dateMatch = text.match(/(?:for|on|date)\s+([0-9]{1,2}[\/\-\s]+[a-zA-Z0-9]{3,9}[\/\-\s]+[0-9]{2,4}|[0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}|yesterday|today)/i);
  if (dateMatch) {
    parsedDate = parseNaturalDate(dateMatch[1]);
  }

  // Payment Method: cash, upi, credit card, debit card, etc.
  let paymentMethod = null;
  const pmMatch = text.match(/(?:paid\.?\s*by|by|via|through|using|payment(?:\s*method)?[:\s]+)\s*(cash|upi|card|credit card|debit card|net banking|cheque|bank transfer)/i);
  if (pmMatch) {
    paymentMethod = pmMatch[1].trim();
  } else if (/\bcash\b/i.test(text)) {
    paymentMethod = 'Cash';
  } else if (/\bupi\b/i.test(text)) {
    paymentMethod = 'UPI';
  } else if (/\bcredit\s*card\b/i.test(text)) {
    paymentMethod = 'Credit Card';
  } else if (/\bdebit\s*card\b/i.test(text)) {
    paymentMethod = 'Debit Card';
  }

  // Account Hint: HDFC, ICICI, Zerodha, Cash, etc.
  let accountHint = null;
  const accMatch = text.match(/\b(hdfc|icici|sbi|axis|kotak|zerodha|cash|paytm|wallet)\b/i);
  if (accMatch) {
    accountHint = accMatch[1].toLowerCase();
  }

  // Resolve target account
  const accounts = await prisma.financialAccount.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  let targetAccount = null;
  if (accountHint) {
    targetAccount = accounts.find((a) =>
      a.name.toLowerCase().includes(accountHint) ||
      (a.institution && a.institution.toLowerCase().includes(accountHint)) ||
      (accountHint === 'cash' && a.accountType === 'CASH')
    );
  }

  // Fallback to primary account
  if (!targetAccount) {
    targetAccount = accounts[0] || null;
  }

  // Description / Category Extraction
  let description = '';
  const descMatch = text.match(/(?:as|for|on|called|named|item)\s+([^,]+?)(?:\s+(?:for|on|date|paid|by|via|using|at|\,)|$)/i);
  if (descMatch && !descMatch[1].match(/^\d{1,2}[\/\-]/) && !descMatch[1].match(/^(yesterday|today|cash|upi)/i)) {
    description = descMatch[1].trim();
  } else {
    // Clean string to derive description
    description = text
      .replace(/\b(add|record|log|insert|create|spend|spent|paid|bought|expense|income)\b/gi, '')
      .replace(amtMatch[0], '')
      .replace(/(?:paid\.?\s*by|by|via|through|using)\s*(cash|upi|card|credit card|debit card)/gi, '')
      .replace(/(?:for|on)\s+([0-9]{1,2}[\/\-\s]+[a-zA-Z0-9]{3,9}[\/\-\s]+[0-9]{2,4}|yesterday|today)/gi, '')
      .replace(/[,\.]+/g, ' ')
      .trim();
  }

  if (!description || description.length === 0) {
    description = transactionType === 'INCOME' ? 'Income Deposit' : 'General Expense';
  }

  // Inferred category
  const categoryName = inferCategory(description, transactionType);

  // Find or create Category in DB
  let categoryRecord = await prisma.category.findFirst({
    where: { userId, name: { equals: categoryName, mode: 'insensitive' } },
  });
  if (!categoryRecord) {
    categoryRecord = await prisma.category.create({
      data: {
        userId,
        name: categoryName,
        categoryType: transactionType === 'INCOME' ? 'INCOME' : 'EXPENSE',
      },
    });
  }

  // Execute database transaction atomically with balance update
  const newTransaction = await prisma.$transaction(async (tx) => {
    const t = await tx.transaction.create({
      data: {
        userId,
        accountId: targetAccount ? targetAccount.id : null,
        categoryId: categoryRecord.id,
        amount,
        transactionType,
        description,
        paymentMethod: paymentMethod || (targetAccount?.name || 'Direct'),
        date: parsedDate,
        currency: 'INR',
      },
      include: {
        category: { select: { name: true } },
        account: { select: { name: true, balance: true } },
      },
    });

    if (targetAccount) {
      const balanceDelta = transactionType === 'INCOME' ? amount : -amount;
      const updatedAcc = await tx.financialAccount.update({
        where: { id: targetAccount.id },
        data: { balance: { increment: balanceDelta } },
      });
      t.updatedBalance = parseFloat(updatedAcc.balance);
    }

    return t;
  });

  // Background Anomaly Detection & Audit Logging
  if (transactionType === 'EXPENSE') {
    financialTwin.detectExpenseAnomaly(userId, {
      id: newTransaction.id,
      amount,
      categoryId: categoryRecord.name,
      merchant: description,
    }).catch(() => {});

    notificationService.checkBudgetThresholds(userId, newTransaction).catch(() => {});
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'AI_ACTION_TRANSACTION_CREATE',
      entity: 'Transaction',
      entityId: newTransaction.id,
    },
  }).catch(() => {});

  // Realtime: reflect the assistant-created transaction on every other device.
  emit(userId, 'ADD_TRANSACTION', 'transaction', { id: newTransaction.id });

  const formattedDate = parsedDate.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const responseMarkdown = `### ✅ Transaction Recorded Successfully!

I have recorded this **${transactionType}** and updated your account balance in real-time:

| Field | Details |
| :--- | :--- |
| **Transaction ID** | \`#${newTransaction.id.slice(0, 8)}\` |
| **Type** | **${transactionType}** |
| **Amount** | **${formatINR(amount)}** |
| **Description** | ${description} |
| **Category** | ${categoryRecord.name} |
| **Account** | ${targetAccount ? targetAccount.name : 'Unassigned'} |
| **Date** | ${formattedDate} |
| **Payment Method** | ${paymentMethod || 'Direct'} |
${targetAccount ? `| **Updated Account Balance** | **${formatINR(newTransaction.updatedBalance)}** |` : ''}

> 💡 **Real-time Sync:** Your monthly expense tracking, budget thresholds, and financial twin metrics have been automatically refreshed.`;

  return {
    handled: true,
    action: 'ADD_TRANSACTION',
    success: true,
    data: newTransaction,
    response: responseMarkdown,
  };
}

/**
 * 2. Handle VIEW USER DATA
 * Provides a complete financial profile and ledger overview
 */
async function handleViewUserData(userId) {
  // Fetch user profile
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, financialProfile: true, financialPlan: true },
  });

  // Fetch accounts
  const accounts = await prisma.financialAccount.findMany({
    where: { userId, isActive: true },
    orderBy: { balance: 'desc' },
  });

  const totalBalance = accounts.reduce((acc, curr) => acc + parseFloat(curr.balance), 0);

  // Fetch current month metrics
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const monthTransactions = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: startOfMonth, lte: endOfMonth },
    },
  });

  const monthIncome = monthTransactions
    .filter((t) => t.transactionType === 'INCOME')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);

  const monthExpenses = monthTransactions
    .filter((t) => t.transactionType === 'EXPENSE')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);

  // Fetch recent transactions
  const recentTransactions = await prisma.transaction.findMany({
    where: { userId },
    include: { category: true, account: true },
    orderBy: { date: 'desc' },
    take: 6,
  });

  // Fetch active goals
  const goals = await prisma.goal.findMany({
    where: { userId, status: 'ACTIVE' },
    take: 4,
  });

  // Build Accounts Markdown table
  const accountRows = accounts.length > 0
    ? accounts.map((a) => `| **${a.name}** | \`${a.accountType}\` | **${formatINR(a.balance)}** | Active |`).join('\n')
    : '| *No active accounts found* | - | - | - |';

  // Build Recent Transactions table
  const txRows = recentTransactions.length > 0
    ? recentTransactions.map((t) => {
        const dStr = new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        const sign = t.transactionType === 'INCOME' ? '+' : '-';
        return `| ${dStr} | ${t.description || 'Transaction'} | ${t.category?.name || 'General'} | ${t.account?.name || 'Account'} | **${sign}${formatINR(t.amount)}** |`;
      }).join('\n')
    : '| *No recent transactions recorded* | - | - | - | - |';

  // Build Goals table
  const goalRows = goals.length > 0
    ? goals.map((g) => {
        const pct = Math.min(100, Math.round((parseFloat(g.currentAmount) / parseFloat(g.targetAmount)) * 100));
        return `- **${g.name}:** ${formatINR(g.currentAmount)} / ${formatINR(g.targetAmount)} (${pct}% achieved)`;
      }).join('\n')
    : '- *No active financial goals configured.*';

  const monthName = now.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const healthScore = user?.financialPlan?.financialHealthScore || 78;
  const riskProfile = user?.financialPlan?.riskProfile || 'Moderate';
  const monthlySalary = user?.financialProfile?.monthlySalary ? parseFloat(user.financialProfile.monthlySalary) : monthIncome;

  const responseMarkdown = `### 📊 User Financial Profile & Ledger Overview

Here is your authenticated financial summary:

#### 👤 Profile & Financial Health
- **User:** ${user?.firstName || 'FinPro'} ${user?.lastName || 'User'} (\`${user?.email}\`)
- **Financial Health Score:** **${healthScore} / 100**
- **Risk Tolerance Profile:** **${riskProfile}**
- **Monthly Inflow Target / Salary:** **${formatINR(monthlySalary)}**

---

#### 🏦 Linked Accounts & Balances
| Account / Institution | Type | Current Balance | Status |
| :--- | :--- | :--- | :--- |
${accountRows}

**Total Net Liquid Balance:** **${formatINR(totalBalance)}**

---

#### 📅 Current Month Summary (${monthName})
- **Total Inflow (Income):** \`${formatINR(monthIncome)}\`
- **Total Outflow (Expenses):** \`${formatINR(monthExpenses)}\`
- **Net Monthly Savings:** **${formatINR(monthIncome - monthExpenses)}**

---

#### 🕒 Recent Transactions
| Date | Description | Category | Account | Amount |
| :--- | :--- | :--- | :--- | :--- |
${txRows}

---

#### 🎯 Active Financial Goals
${goalRows}

> 💬 *You can add, edit, or remove transactions anytime by chatting with me!*`;

  return {
    handled: true,
    action: 'VIEW_DATA',
    success: true,
    data: {
      user: { name: `${user?.firstName} ${user?.lastName}`, email: user?.email },
      totalBalance,
      accountsCount: accounts.length,
      recentTransactionsCount: recentTransactions.length,
    },
    response: responseMarkdown,
  };
}

/**
 * 3. Handle DELETE TRANSACTION
 * Reverts account balance and deletes transaction record
 */
async function handleDeleteTransaction(userId, text) {
  // Check if specific ID is mentioned (UUID or 8-char short ID)
  const idMatch = text.match(/(?:id|#)?\s*([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})?)/);
  const isLast = /\b(last|latest|recent)\b/i.test(text);

  let targetTx = null;

  if (idMatch && idMatch[1].length > 6) {
    const rawId = idMatch[1];
    targetTx = await prisma.transaction.findFirst({
      where: {
        userId,
        OR: [{ id: rawId }, { id: { startsWith: rawId } }],
      },
      include: { account: true, category: true },
    });
  }

  if (!targetTx && isLast) {
    targetTx = await prisma.transaction.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { account: true, category: true },
    });
  }

  if (!targetTx) {
    // Search by keywords in description or amount
    const amtMatch = text.match(/(?:rs\.?|inr|₹|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
    const amountVal = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) : null;

    // Clean text to extract description search tokens
    const searchToken = text
      .replace(/\b(remove|delete|cancel|erase|drop|expense|income|transaction|last|latest|recent|rs\.?|inr|₹)\b/gi, '')
      .replace(/\d+/g, '')
      .trim();

    const whereClause = { userId };
    if (searchToken.length > 2) {
      whereClause.OR = [
        { description: { contains: searchToken, mode: 'insensitive' } },
        { merchant: { contains: searchToken, mode: 'insensitive' } },
        { category: { name: { contains: searchToken, mode: 'insensitive' } } },
      ];
    }
    if (amountVal && !isNaN(amountVal)) {
      whereClause.amount = amountVal;
    }

    targetTx = await prisma.transaction.findFirst({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: { account: true, category: true },
    });
  }

  if (!targetTx) {
    return {
      handled: true,
      action: 'DELETE_TRANSACTION',
      success: false,
      response: `⚠️ **Transaction Not Found**\n\nI couldn't locate a matching transaction to remove. Please try:\n- \`Delete last transaction\`\n- \`Remove expense bday party\`\n- \`Delete transaction #<id>\``,
    };
  }

  // Atomically delete transaction and revert account balance
  const amtNum = parseFloat(targetTx.amount);
  let updatedAccount = null;

  await prisma.$transaction(async (tx) => {
    if (targetTx.accountId) {
      const reverseDelta = targetTx.transactionType === 'INCOME' ? -amtNum : amtNum;
      updatedAccount = await tx.financialAccount.update({
        where: { id: targetTx.accountId },
        data: { balance: { increment: reverseDelta } },
      });
    }

    await tx.transaction.delete({
      where: { id: targetTx.id },
    });
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'AI_ACTION_TRANSACTION_DELETE',
      entity: 'Transaction',
      entityId: targetTx.id,
    },
  }).catch(() => {});

  const responseMarkdown = `### 🗑️ Transaction Removed Successfully

The transaction has been deleted and your account balance has been restored:

| Field | Reverted Value |
| :--- | :--- |
| **Transaction ID** | \`#${targetTx.id.slice(0, 8)}\` |
| **Type** | ${targetTx.transactionType} |
| **Description** | ${targetTx.description || 'N/A'} |
| **Category** | ${targetTx.category?.name || 'General'} |
| **Amount Reverted** | **${formatINR(amtNum)}** |
| **Account** | ${targetTx.account?.name || 'Primary Account'} |
${updatedAccount ? `| **Restored Account Balance** | **${formatINR(updatedAccount.balance)}** |` : ''}

> ✅ Your monthly ledger and analytics have been updated automatically.`;

  // Realtime: drop the deleted transaction from every other device's ledger.
  emit(userId, 'DELETE_TRANSACTION', 'transaction', { id: targetTx.id });

  return {
    handled: true,
    action: 'DELETE_TRANSACTION',
    success: true,
    data: targetTx,
    response: responseMarkdown,
  };
}

/**
 * 4. Handle EDIT TRANSACTION
 * Edits amount, category, or description and adjusts account balance delta
 */
async function handleEditTransaction(userId, text) {
  // Find Target Transaction
  const isLast = /\b(last|latest|recent)\b/i.test(text);
  const idMatch = text.match(/(?:id|#)?\s*([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})?)/);

  let targetTx = null;

  if (idMatch && idMatch[1].length > 6) {
    targetTx = await prisma.transaction.findFirst({
      where: {
        userId,
        OR: [{ id: idMatch[1] }, { id: { startsWith: idMatch[1] } }],
      },
      include: { account: true, category: true },
    });
  }

  if (!targetTx && isLast) {
    targetTx = await prisma.transaction.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { account: true, category: true },
    });
  }

  // Extract new amount: e.g. "to 8000", "to ₹8000", "amount 8000"
  let newAmount = null;
  const toAmtMatch = text.match(/(?:to|amount(?:\s*to)?|is)\s*(?:rs\.?|inr|₹|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
  if (toAmtMatch) {
    newAmount = parseFloat(toAmtMatch[1].replace(/,/g, ''));
  }

  if (!targetTx) {
    // Search description keywords
    const searchToken = text
      .replace(/\b(edit|update|change|modify|correct|adjust|expense|income|transaction|last|latest|recent|to|amount|category|description)\b/gi, '')
      .replace(/\d+/g, '')
      .replace(/[,\.]+/g, ' ')
      .trim();

    if (searchToken.length >= 2) {
      targetTx = await prisma.transaction.findFirst({
        where: {
          userId,
          OR: [
            { description: { contains: searchToken, mode: 'insensitive' } },
            { merchant: { contains: searchToken, mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        include: { account: true, category: true },
      });
    }
  }

  if (!targetTx) {
    // If still not found, check the most recent transaction
    targetTx = await prisma.transaction.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { account: true, category: true },
    });
  }

  if (!targetTx) {
    return {
      handled: true,
      action: 'EDIT_TRANSACTION',
      success: false,
      response: `⚠️ **Transaction Not Found**\n\nI couldn't identify the transaction you want to edit. Try:\n- \`Edit bday party expense to 8000\`\n- \`Change last expense amount to 500\`\n- \`Update transaction #<id> to 1200\``,
    };
  }

  // Extract new category or new description
  let newCategoryName = null;
  const catMatch = text.match(/category(?:\s*to)?\s+([a-zA-Z\s&]+?)(?:\s+(?:to|amount|for)|$)/i);
  if (catMatch && catMatch[1].trim().length > 2) {
    newCategoryName = catMatch[1].trim();
  }

  let newDescription = null;
  const descMatch = text.match(/(?:description|note|name)(?:\s*to)?\s+([a-zA-Z0-9\s&]+?)(?:\s+(?:to|amount|for)|$)/i);
  if (descMatch && descMatch[1].trim().length > 1) {
    newDescription = descMatch[1].trim();
  }

  if (newAmount === null && !newCategoryName && !newDescription) {
    return {
      handled: true,
      action: 'EDIT_TRANSACTION',
      success: false,
      response: `⚠️ **No Changes Specified**\n\nTarget transaction identified: **${targetTx.description}** (\`${formatINR(targetTx.amount)}\`).\nPlease specify what to modify, e.g.:\n> \`Edit ${targetTx.description} to 8000\`\n> \`Change category to Entertainment\``,
    };
  }

  // Update Category record if changed
  let newCategoryId = targetTx.categoryId;
  if (newCategoryName) {
    let catRecord = await prisma.category.findFirst({
      where: { userId, name: { equals: newCategoryName, mode: 'insensitive' } },
    });
    if (!catRecord) {
      catRecord = await prisma.category.create({
        data: {
          userId,
          name: newCategoryName,
          categoryType: targetTx.transactionType === 'INCOME' ? 'INCOME' : 'EXPENSE',
        },
      });
    }
    newCategoryId = catRecord.id;
  }

  const oldAmountNum = parseFloat(targetTx.amount);
  const effectiveNewAmount = newAmount !== null && !isNaN(newAmount) ? newAmount : oldAmountNum;
  const amountChanged = effectiveNewAmount !== oldAmountNum;

  let updatedAccount = null;

  const updatedTx = await prisma.$transaction(async (tx) => {
    const t = await tx.transaction.update({
      where: { id: targetTx.id },
      data: {
        amount: effectiveNewAmount,
        ...(newDescription && { description: newDescription }),
        ...(newCategoryId && { categoryId: newCategoryId }),
      },
      include: { category: true, account: true },
    });

    if (amountChanged && targetTx.accountId) {
      const delta = targetTx.transactionType === 'INCOME'
        ? (effectiveNewAmount - oldAmountNum)
        : (oldAmountNum - effectiveNewAmount);

      updatedAccount = await tx.financialAccount.update({
        where: { id: targetTx.accountId },
        data: { balance: { increment: delta } },
      });
    }

    return t;
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'AI_ACTION_TRANSACTION_UPDATE',
      entity: 'Transaction',
      entityId: targetTx.id,
    },
  }).catch(() => {});

  const responseMarkdown = `### ✏️ Transaction Updated Successfully!

The transaction details have been updated and synchronized with your ledger:

| Field | Previous Value | Updated Value |
| :--- | :--- | :--- |
| **Transaction ID** | \`#${targetTx.id.slice(0, 8)}\` | \`#${targetTx.id.slice(0, 8)}\` |
| **Description** | ${targetTx.description || 'N/A'} | **${updatedTx.description || 'N/A'}** |
| **Category** | ${targetTx.category?.name || 'General'} | **${updatedTx.category?.name || 'General'}** |
| **Amount** | ${formatINR(oldAmountNum)} | **${formatINR(effectiveNewAmount)}** |
| **Account** | ${targetTx.account?.name || 'Primary'} | ${targetTx.account?.name || 'Primary'} |
${updatedAccount ? `| **Updated Account Balance** | - | **${formatINR(updatedAccount.balance)}** |` : ''}

> 💡 All connected financial twins, monthly budget trackers, and graphs have been refreshed.`;

  // Realtime: push the edited transaction to every other device.
  emit(userId, 'EDIT_TRANSACTION', 'transaction', { id: updatedTx.id });

  return {
    handled: true,
    action: 'EDIT_TRANSACTION',
    success: true,
    data: updatedTx,
    response: responseMarkdown,
  };
}

/**
 * Main Action Dispatcher
 * Returns { handled: true, response, action, data } if user intends an action,
 * or null if the message is a general conversational query.
 */
async function tryExecuteAction(userId, userMessage) {
  if (!userMessage || !userId) return null;

  const intent = parseActionIntent(userMessage);
  if (!intent) return null;

  switch (intent.type) {
    case 'ADD_TRANSACTION':
      return await handleAddTransaction(userId, userMessage);
    case 'VIEW_DATA':
      return await handleViewUserData(userId, userMessage);
    case 'DELETE_TRANSACTION':
      return await handleDeleteTransaction(userId, userMessage);
    case 'EDIT_TRANSACTION':
      return await handleEditTransaction(userId, userMessage);
    default:
      return null;
  }
}

module.exports = {
  parseActionIntent,
  parseNaturalDate,
  inferCategory,
  handleAddTransaction,
  handleViewUserData,
  handleDeleteTransaction,
  handleEditTransaction,
  tryExecuteAction,
};
