/**
 * FinPro — AI Tool Registry
 *
 * The complete action surface the AI assistant is allowed to invoke through
 * Gemini function-calling. Every mutating tool:
 *   - runs inside a single Prisma `$transaction` (atomic, ACID),
 *   - keeps account balances exactly consistent with the ledger,
 *   - publishes a realtime event so every other device updates instantly.
 *
 * Read tools are pure queries and never write.
 */

'use strict';

const { SchemaType } = require('@google/generative-ai');
const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const aiService = require('./aiService');
const realtime = require('./realtimeService');
const { parseNaturalDate, inferCategory } = require('./aiActionService');

// ---------------------------------------------------------------- primitives

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const inr = (v) => formatINR(num(v));
const toDate = (v) => (v ? parseNaturalDate(String(v)) : new Date());
/** Local-time YYYY-MM-DD. `toISOString()` would shift IST dates back a day. */
const ymd = (d) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
    x.getDate()
  ).padStart(2, '0')}`;
};
/**
 * Coerce free-form model output into a value a Prisma enum column accepts.
 * Sending an unknown string to an enum column throws a validation error, so
 * anything unrecognised degrades to `fallback` instead of failing the action.
 */
const oneOf = (value, allowed, fallback) => {
  const v = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return allowed.includes(v) ? v : fallback;
};
const ok = (summary, data = {}) => ({ ok: true, summary, data });
const fail = (error) => ({ ok: false, error });
const balanceDelta = (type, amount) =>
  type === 'INCOME' ? num(amount) : -num(amount);

/** Realtime fan-out for anything the AI changes. Best-effort, never throws. */
function emit(userId, tool, resource, extra = {}) {
  try {
    if (resource) {
      realtime.publish(
        userId,
        `${resource}.changed`,
        { resource, action: 'changed', via: 'ai', ...extra },
        { source: 'ai' }
      );
    }
    realtime.publish(userId, 'ai.action', { tool, resource, ...extra }, { source: 'ai' });
  } catch (_) {
    /* realtime must never break an action */
  }
}

// ---------------------------------------------------------------- resolvers

async function pickAccount(userId, ref, db = prisma) {
  if (ref) {
    const found = await db.financialAccount.findFirst({
      where: {
        userId,
        OR: [
          { id: String(ref) },
          { name: { equals: String(ref), mode: 'insensitive' } },
          { name: { contains: String(ref), mode: 'insensitive' } },
        ],
      },
    });
    if (found) return found;
  }
  return db.financialAccount.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
}

async function pickCategory(db, userId, name, type) {
  const clean = String(name || (type === 'INCOME' ? 'Income' : 'General Expense')).trim();
  let cat = await db.category.findFirst({
    where: {
      name: { equals: clean, mode: 'insensitive' },
      OR: [{ userId }, { userId: null }],
    },
  });
  if (!cat) {
    cat = await db.category.create({
      data: {
        name: clean,
        userId,
        categoryType: type === 'INCOME' ? 'INCOME' : type === 'TRANSFER' ? 'TRANSFER' : 'EXPENSE',
      },
    });
  }
  return cat;
}

async function pickTransaction(userId, ref, db = prisma) {
  if (!ref || /^(last|latest|recent|newest)$/i.test(String(ref))) {
    return db.transaction.findFirst({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }
  return db.transaction.findFirst({ where: { userId, id: String(ref) } });
}

async function pickGoal(userId, ref, db = prisma) {
  if (!ref) return null;
  return db.goal.findFirst({
    where: {
      userId,
      OR: [
        { id: String(ref) },
        { name: { equals: String(ref), mode: 'insensitive' } },
        { name: { contains: String(ref), mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function pickLoan(userId, ref, db = prisma) {
  if (!ref) {
    return db.loan.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  }
  return db.loan.findFirst({
    where: {
      userId,
      OR: [
        { id: String(ref) },
        { lenderName: { contains: String(ref), mode: 'insensitive' } },
        // NOTE: `loanType` is a Prisma enum — matching a raw string against it
        // throws a validation error, so it is only compared when it is valid.
        ...(LOAN_TYPES.includes(String(ref).trim().toUpperCase())
          ? [{ loanType: String(ref).trim().toUpperCase() }]
          : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function pickCard(userId, ref, db = prisma) {
  if (!ref) {
    return db.card.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  return db.card.findFirst({
    where: {
      userId,
      OR: [
        { id: String(ref) },
        { cardNickname: { contains: String(ref), mode: 'insensitive' } },
        { issuer: { contains: String(ref), mode: 'insensitive' } },
        { lastFourDigits: String(ref).replace(/\D/g, '') },
      ],
    },
  });
}

async function pickPendingSms(userId, ref, db = prisma) {
  if (!ref || /^(last|latest|recent|newest)$/i.test(String(ref))) {
    return db.pendingSmsTransaction.findFirst({
      where: { userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }
  return db.pendingSmsTransaction.findFirst({
    where: {
      userId,
      status: 'PENDING',
      OR: [
        { id: String(ref) },
        { merchant: { contains: String(ref), mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function pickTask(userId, ref, db = prisma) {
  if (!ref || /^(last|latest|recent|newest)$/i.test(String(ref))) {
    return db.financialTask.findFirst({
      where: { userId, isCompleted: false },
      orderBy: { dueDate: 'asc' },
    });
  }
  return db.financialTask.findFirst({
    where: {
      userId,
      OR: [
        { id: String(ref) },
        { title: { contains: String(ref), mode: 'insensitive' } },
      ],
    },
  });
}

/**
 * Recompute a portfolio's invested cost basis from its holdings.
 *
 * `currentValue` is deliberately left alone: it is the *live market* value
 * derived from real quotes by investmentController, and overwriting it with
 * cost basis would wipe out the user's P&L. It is refreshed from quotes the
 * next time the portfolio is opened.
 */
async function refreshPortfolio(tx, portfolioId) {
  const holdings = await tx.investment.findMany({ where: { portfolioId } });
  const totalInvested = holdings.reduce(
    (sum, h) => sum + num(h.quantity) * num(h.averageBuyPrice),
    0
  );
  return tx.portfolio.update({
    where: { id: portfolioId },
    data: { totalInvested },
  });
}

const TRANSACTION_TYPES = 'EXPENSE, INCOME, TRANSFER, INVESTMENT or LOAN_PAYMENT';

// Prisma enum whitelists — must mirror prisma/schema.prisma exactly.
const TRANSACTION_TYPES_ENUM = ['EXPENSE', 'INCOME', 'TRANSFER', 'INVESTMENT', 'LOAN_PAYMENT'];
const ACCOUNT_TYPES = ['BANK', 'CASH', 'WALLET', 'CREDIT_CARD', 'SAVINGS', 'CURRENT', 'OTHER'];
const GOAL_TYPES = [
  'EMERGENCY_FUND', 'VACATION', 'HOME', 'CAR', 'EDUCATION',
  'RETIREMENT', 'WEDDING', 'INVESTMENT', 'OTHER',
];
const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];
const ASSET_TYPES = [
  'STOCK', 'MUTUAL_FUND', 'SIP', 'GOLD', 'SILVER',
  'FIXED_DEPOSIT', 'CRYPTO', 'BOND', 'ETF', 'OTHER',
];
const LOAN_TYPES = ['HOME', 'CAR', 'PERSONAL', 'EDUCATION', 'BUSINESS', 'GOLD', 'OTHER'];
const CARD_TYPES = ['CREDIT', 'DEBIT'];

// ---------------------------------------------------------------- tool list

const TOOL_LIST = [
  // ============================== READ ==============================
  {
    name: 'get_profile',
    description:
      "The user's own profile and account details: full name, email, member-since date, risk profile and preferred currency. Use when the user asks who they are, to view their profile/account data, or for their email.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
    execute: async (userId) => {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          currency: true,
          createdAt: true,
          financialProfile: { select: { riskProfile: true, budgetMethod: true } },
        },
      });
      if (!u) return fail('Profile not found.');
      const full = `${u.firstName || ''} ${u.lastName || ''}`.trim();
      const risk = u.financialProfile?.riskProfile || 'not set';
      return ok(
        `Profile — name ${full || '(unnamed)'} | email ${u.email} | member since ${ymd(
          u.createdAt
        )} | risk profile ${risk} | currency ${u.currency || 'INR'}`,
        {
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          riskProfile: risk,
          budgetMethod: u.financialProfile?.budgetMethod || null,
          currency: u.currency,
          memberSince: u.createdAt,
        }
      );
    },
  },
  {
    name: 'get_financial_overview',
    description:
      "Overall financial snapshot: net worth, total balance, this month's income/expenses/savings, total debt and monthly EMI, investment value and P&L, and the 0-100 health score. Call this first for any general 'how am I doing' or advice question.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
    execute: async (userId) => {
      const c = await aiService.getUserFinancialContext(userId);
      return ok(
        `Net worth ${inr(c.netWorth)} | total balance ${inr(c.totalBalance)} | this month income ${inr(
          c.incomeThisMonth
        )}, expenses ${inr(c.expensesThisMonth)}, savings ${inr(c.savingsThisMonth)} | debt ${inr(
          c.totalDebt
        )} (EMI ${inr(c.monthlyEMI)}) | investments ${inr(c.investmentValue)} (P&L ${inr(
          c.investmentPnl
        )}) | health ${c.healthScore}/100`,
        {
          netWorth: c.netWorth,
          totalBalance: c.totalBalance,
          incomeThisMonth: c.incomeThisMonth,
          expensesThisMonth: c.expensesThisMonth,
          savingsThisMonth: c.savingsThisMonth,
          totalDebt: c.totalDebt,
          monthlyEMI: c.monthlyEMI,
          investmentValue: c.investmentValue,
          investedAmount: c.investedAmount,
          investmentPnl: c.investmentPnl,
          healthScore: c.healthScore,
          activeGoals: (c.goals || []).length,
          budgetCount: c.budgetCount,
        }
      );
    },
  },
  {
    name: 'list_transactions',
    description:
      'List the user\'s transactions, newest first. Filter by type, category, date range, or free-text search. Use limit to keep the answer short (default 10).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        transactionType: { type: SchemaType.STRING, description: TRANSACTION_TYPES },
        category: { type: SchemaType.STRING, description: 'Category name filter' },
        search: { type: SchemaType.STRING, description: 'Matches merchant or description' },
        from: { type: SchemaType.STRING, description: 'Start date, e.g. 2026-10-01' },
        to: { type: SchemaType.STRING, description: 'End date, e.g. 2026-10-31' },
        limit: { type: SchemaType.NUMBER, description: 'Max rows, default 10' },
      },
    },
    execute: async (userId, a) => {
      const where = { userId };
      if (a.transactionType && TRANSACTION_TYPES_ENUM.includes(String(a.transactionType).trim().toUpperCase())) {
        where.transactionType = String(a.transactionType).trim().toUpperCase();
      }
      if (a.category) where.category = { name: { contains: a.category, mode: 'insensitive' } };
      if (a.from || a.to) {
        where.date = {};
        if (a.from) where.date.gte = toDate(a.from);
        if (a.to) where.date.lte = toDate(a.to);
      }
      if (a.search) {
        where.OR = [
          { merchant: { contains: a.search, mode: 'insensitive' } },
          { description: { contains: a.search, mode: 'insensitive' } },
        ];
      }
      const rows = await prisma.transaction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: Math.min(Math.max(num(a.limit) || 10, 1), 50),
        include: { category: { select: { name: true } }, account: { select: { name: true } } },
      });
      const total = rows.reduce(
        (s, r) => s + (r.transactionType === 'INCOME' ? num(r.amount) : -num(r.amount)),
        0
      );
      return ok(
        `${rows.length} transaction(s), net ${inr(total)}: ` +
          rows
            .map(
              (r) =>
                `${r.date.toISOString().slice(0, 10)} ${r.transactionType} ${inr(r.amount)} ${
                  r.merchant || r.description || ''
                }${r.category ? ` [${r.category.name}]` : ''}`
            )
            .join('; '),
        {
          count: rows.length,
          net: total,
          transactions: rows.map((r) => ({
            id: r.id,
            date: r.date.toISOString().slice(0, 10),
            amount: num(r.amount),
            transactionType: r.transactionType,
            merchant: r.merchant,
            description: r.description,
            category: r.category?.name || null,
            account: r.account?.name || null,
          })),
        }
      );
    },
  },
  {
    name: 'list_accounts',
    description: 'List the user\'s financial accounts with their current balances and types.',
    parameters: { type: SchemaType.OBJECT, properties: {} },
    execute: async (userId) => {
      const rows = await prisma.financialAccount.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      const total = rows.reduce((s, r) => s + num(r.balance), 0);
      return ok(
        `${rows.length} account(s), total ${inr(total)}: ` +
          rows.map((r) => `${r.name} (${r.accountType}) ${inr(r.balance)}`).join('; '),
        {
          total,
          accounts: rows.map((r) => ({
            id: r.id,
            name: r.name,
            accountType: r.accountType,
            institution: r.institution,
            balance: num(r.balance),
          })),
        }
      );
    },
  },
  {
    name: 'list_budgets',
    description:
      'List monthly budgets with how much has been spent and how much is left for the given month (defaults to the current month).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        month: { type: SchemaType.NUMBER, description: '1-12, default current month' },
        year: { type: SchemaType.NUMBER, description: 'e.g. 2026, default current year' },
      },
    },
    execute: async (userId, a) => {
      const now = new Date();
      const month = num(a.month) || now.getMonth() + 1;
      const year = num(a.year) || now.getFullYear();
      const budgets = await prisma.budget.findMany({ where: { userId, month, year } });
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59);

      const items = [];
      for (const b of budgets) {
        const spent = await prisma.transaction.aggregate({
          where: {
            userId,
            transactionType: 'EXPENSE',
            date: { gte: start, lte: end },
            category: { name: { equals: b.categoryName, mode: 'insensitive' } },
          },
          _sum: { amount: true },
        });
        const used = num(spent._sum.amount);
        items.push({
          id: b.id,
          categoryName: b.categoryName,
          limit: num(b.monthlyLimit),
          spent: used,
          remaining: num(b.monthlyLimit) - used,
          utilisationPct: num(b.monthlyLimit) > 0 ? Math.round((used / num(b.monthlyLimit)) * 100) : 0,
        });
      }
      return ok(
        `${items.length} budget(s) for ${month}/${year}: ` +
          items
            .map(
              (i) =>
                `${i.categoryName} ${inr(i.spent)}/${inr(i.limit)} (${i.utilisationPct}% used, ${inr(
                  i.remaining
                )} left)`
            )
            .join('; '),
        { month, year, budgets: items }
      );
    },
  },
  {
    name: 'list_goals',
    description: 'List the user\'s financial goals with progress, target dates and monthly contributions.',
    parameters: { type: SchemaType.OBJECT, properties: {} },
    execute: async (userId) => {
      const rows = await prisma.goal.findMany({
        where: { userId },
        orderBy: [{ status: 'asc' }, { targetDate: 'asc' }],
      });
      return ok(
        `${rows.length} goal(s): ` +
          rows
            .map(
              (g) =>
                `${g.name} ${inr(g.currentAmount)}/${inr(g.targetAmount)} (${Math.round(
                  (num(g.currentAmount) / Math.max(num(g.targetAmount), 1)) * 100
                )}%, ${g.status})`
            )
            .join('; '),
        {
          goals: rows.map((g) => ({
            id: g.id,
            name: g.name,
            goalType: g.goalType,
            targetAmount: num(g.targetAmount),
            currentAmount: num(g.currentAmount),
            remaining: num(g.targetAmount) - num(g.currentAmount),
            monthlyContribution: num(g.monthlyContribution),
            targetDate: g.targetDate ? g.targetDate.toISOString().slice(0, 10) : null,
            status: g.status,
            priority: g.priority,
          })),
        }
      );
    },
  },
  {
    name: 'list_loans',
    description: 'List the user\'s loans with outstanding balance, interest rate, EMI and status.',
    parameters: { type: SchemaType.OBJECT, properties: {} },
    execute: async (userId) => {
      const rows = await prisma.loan.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
      const total = rows
        .filter((l) => l.status === 'ACTIVE')
        .reduce((s, l) => s + num(l.outstandingBalance), 0);
      return ok(
        `${rows.length} loan(s), active outstanding ${inr(total)}: ` +
          rows
            .map(
              (l) =>
                `${l.loanType} ${l.lenderName || ''} outstanding ${inr(l.outstandingBalance)} @ ${num(
                  l.interestRate
                )}% EMI ${inr(l.emiAmount)} (${l.status})`
            )
            .join('; '),
        {
          activeOutstanding: total,
          loans: rows.map((l) => ({
            id: l.id,
            loanType: l.loanType,
            lenderName: l.lenderName,
            principalAmount: num(l.principalAmount),
            interestRate: num(l.interestRate),
            tenureMonths: l.tenureMonths,
            emiAmount: num(l.emiAmount),
            outstandingBalance: num(l.outstandingBalance),
            status: l.status,
          })),
        }
      );
    },
  },
  {
    name: 'list_investments',
    description: 'List the user\'s investment portfolio holdings with quantity and average buy price.',
    parameters: { type: SchemaType.OBJECT, properties: {} },
    execute: async (userId) => {
      const portfolio = await prisma.portfolio.findUnique({
        where: { userId },
        include: { investments: true },
      });
      const holdings = portfolio?.investments || [];
      return ok(
        holdings.length
          ? `${holdings.length} holding(s), invested ${inr(portfolio.totalInvested)}, value ${inr(
              portfolio.currentValue
            )}: ` +
              holdings
                .map(
                  (h) =>
                    `${h.symbol} ${num(h.quantity)}x @ ${inr(h.averageBuyPrice)} = ${inr(
                      num(h.quantity) * num(h.averageBuyPrice)
                    )}`
                )
                .join('; ')
          : 'No investments recorded yet.',
        {
          totalInvested: num(portfolio?.totalInvested),
          currentValue: num(portfolio?.currentValue),
          holdings: holdings.map((h) => ({
            id: h.id,
            symbol: h.symbol,
            name: h.name,
            assetType: h.assetType,
            quantity: num(h.quantity),
            averageBuyPrice: num(h.averageBuyPrice),
            value: num(h.quantity) * num(h.averageBuyPrice),
          })),
        }
      );
    },
  },
  {
    name: 'analyse_spending',
    description:
      'Break down expenses by category over a date range (defaults to the current month). Use this to answer "where is my money going".',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        from: { type: SchemaType.STRING, description: 'Start date, e.g. 2026-10-01' },
        to: { type: SchemaType.STRING, description: 'End date, e.g. 2026-10-31' },
      },
    },
    execute: async (userId, a) => {
      const now = new Date();
      const from = a.from ? toDate(a.from) : new Date(now.getFullYear(), now.getMonth(), 1);
      const to = a.to ? toDate(a.to) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      const grouped = await prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, transactionType: 'EXPENSE', date: { gte: from, lte: to } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
      });
      const cats = await prisma.category.findMany({
        where: { id: { in: grouped.map((g) => g.categoryId).filter(Boolean) } },
        select: { id: true, name: true },
      });
      const nameById = Object.fromEntries(cats.map((c) => [c.id, c.name]));
      const total = grouped.reduce((s, g) => s + num(g._sum.amount), 0);
      const rows = grouped.map((g) => ({
        category: nameById[g.categoryId] || 'Uncategorised',
        amount: num(g._sum.amount),
        sharePct: total > 0 ? Math.round((num(g._sum.amount) / total) * 100) : 0,
      }));
      return ok(
        `Spending ${ymd(from)} → ${ymd(to)}: total ${inr(
          total
        )}. ` + rows.map((r) => `${r.category} ${inr(r.amount)} (${r.sharePct}%)`).join('; '),
        { from: ymd(from), to: ymd(to), total, breakdown: rows }
      );
    },
  },
  {
    name: 'list_pending_sms',
    description:
      'List bank-SMS transactions that are waiting for review (status PENDING). Use confirm_pending_sms / reject_pending_sms to act on them.',
    parameters: { type: SchemaType.OBJECT, properties: {} },
    execute: async (userId) => {
      const rows = await prisma.pendingSmsTransaction.findMany({
        where: { userId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      return ok(
        rows.length
          ? `${rows.length} pending SMS item(s): ` +
              rows
                .map(
                  (p) =>
                    `${p.id.slice(0, 8)} ${p.transactionType} ${inr(p.amount)} ${
                      p.merchant || ''
                    } [${p.suggestedCategory || 'uncategorised'}]`
                )
                .join('; ')
          : 'No pending SMS transactions.',
        {
          pending: rows.map((p) => ({
            id: p.id,
            amount: num(p.amount),
            transactionType: p.transactionType,
            merchant: p.merchant,
            suggestedCategory: p.suggestedCategory,
            date: p.transactionDate.toISOString().slice(0, 10),
          })),
        }
      );
    },
  },
  {
    name: 'list_cards',
    description: 'List the user\'s credit/debit cards with outstanding amounts, limits and due dates.',
    parameters: { type: SchemaType.OBJECT, properties: {} },
    execute: async (userId) => {
      const rows = await prisma.card.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
      return ok(
        rows.length
          ? `${rows.length} card(s): ` +
              rows
                .map(
                  (c) =>
                    `${c.cardNickname} (${c.issuer} ****${c.lastFourDigits}) outstanding ${inr(
                      c.outstandingAmount
                    )} limit ${inr(c.creditLimit)}${c.dueDate ? ` due ${c.dueDate.toISOString().slice(0, 10)}` : ''}`
                )
                .join('; ')
          : 'No cards on file.',
        {
          cards: rows.map((c) => ({
            id: c.id,
            cardNickname: c.cardNickname,
            issuer: c.issuer,
            lastFourDigits: c.lastFourDigits,
            cardType: c.cardType,
            creditLimit: num(c.creditLimit),
            outstandingAmount: num(c.outstandingAmount),
            dueDate: c.dueDate ? c.dueDate.toISOString().slice(0, 10) : null,
          })),
        }
      );
    },
  },
  {
    name: 'list_tasks',
    description: 'List financial tasks / bill reminders by due date.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        includeCompleted: { type: SchemaType.BOOLEAN, description: 'Include completed tasks, default false' },
      },
    },
    execute: async (userId, a) => {
      const rows = await prisma.financialTask.findMany({
        where: { userId, ...(a.includeCompleted ? {} : { isCompleted: false }) },
        orderBy: [{ isCompleted: 'asc' }, { dueDate: 'asc' }],
        take: 30,
      });
      return ok(
        rows.length
          ? `${rows.length} task(s): ` +
              rows
                .map(
                  (t) =>
                    `[${t.isCompleted ? 'x' : ' '}] ${t.title} (${t.category}, due ${t.dueDate
                      .toISOString()
                      .slice(0, 10)}, ${t.priority})`
                )
                .join('; ')
          : 'No tasks found.',
        {
          tasks: rows.map((t) => ({
            id: t.id,
            title: t.title,
            category: t.category,
            dueDate: t.dueDate.toISOString().slice(0, 10),
            priority: t.priority,
            isCompleted: t.isCompleted,
          })),
        }
      );
    },
  },
  {
    name: 'list_subscriptions',
    description: 'List recurring subscriptions with cost and next billing date.',
    parameters: { type: SchemaType.OBJECT, properties: {} },
    execute: async (userId) => {
      const rows = await prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
      const monthly = rows
        .filter((s) => s.isActive)
        .reduce(
          (sum, s) =>
            sum +
            (String(s.billingCycle).toUpperCase() === 'YEARLY' ? num(s.cost) / 12 : num(s.cost)),
          0
        );
      return ok(
        rows.length
          ? `${rows.length} subscription(s), ≈${inr(monthly)}/month: ` +
              rows
                .map(
                  (s) =>
                    `${s.serviceName} ${inr(s.cost)}/${s.billingCycle} next ${s.nextBillingDate
                      .toISOString()
                      .slice(0, 10)}`
                )
                .join('; ')
          : 'No subscriptions tracked.',
        {
          monthlyRunRate: monthly,
          subscriptions: rows.map((s) => ({
            id: s.id,
            serviceName: s.serviceName,
            cost: num(s.cost),
            billingCycle: s.billingCycle,
            nextBillingDate: s.nextBillingDate.toISOString().slice(0, 10),
            isActive: s.isActive,
          })),
        }
      );
    },
  },

  // ============================== WRITE ==============================
  {
    name: 'create_transaction',
    description:
      'Record a new income or expense. This moves the account balance automatically. Use for "I spent 500 on coffee", "log my salary 50000", etc.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        amount: { type: SchemaType.NUMBER, description: 'Positive amount in INR' },
        transactionType: { type: SchemaType.STRING, description: TRANSACTION_TYPES + ' (default EXPENSE)' },
        description: { type: SchemaType.STRING, description: 'What it was for' },
        merchant: { type: SchemaType.STRING, description: 'Merchant / payee name' },
        category: { type: SchemaType.STRING, description: 'Category name, e.g. Food & Dining' },
        date: { type: SchemaType.STRING, description: 'Date, e.g. today, yesterday, 2026-10-15' },
        account: { type: SchemaType.STRING, description: 'Account name or id (defaults to primary account)' },
        paymentMethod: { type: SchemaType.STRING, description: 'e.g. UPI, Card, Cash' },
      },
      required: ['amount'],
    },
    execute: async (userId, a) => {
      const amount = num(a.amount);
      if (!(amount > 0)) return fail('Amount must be a positive number.');
      const transactionType = oneOf(a.transactionType, TRANSACTION_TYPES_ENUM, 'EXPENSE');
      const merchant = a.merchant || a.description || null;
      const description = a.description || a.merchant || null;
      const categoryName = a.category || inferCategory(`${description || ''} ${merchant || ''}`, transactionType);
      const date = toDate(a.date);

      const result = await prisma.$transaction(async (tx) => {
        const account = await pickAccount(userId, a.account, tx);
        const category = await pickCategory(tx, userId, categoryName, transactionType);
        const created = await tx.transaction.create({
          data: {
            userId,
            accountId: account?.id || null,
            categoryId: category.id,
            amount,
            transactionType,
            merchant,
            description,
            paymentMethod: a.paymentMethod || null,
            date,
          },
        });
        let balance = null;
        if (account) {
          const updated = await tx.financialAccount.update({
            where: { id: account.id },
            data: { balance: { increment: balanceDelta(transactionType, amount) } },
          });
          balance = num(updated.balance);
        }
        return { created, balance, accountName: account?.name || null, categoryName: category.name };
      });

      emit(userId, 'create_transaction', 'transaction', { id: result.created.id });
      return ok(
        `Recorded ${transactionType} of ${inr(amount)}${merchant ? ` at ${merchant}` : ''} on ${ymd(
          date
        )}${result.categoryName ? ` in ${result.categoryName}` : ''}.` +
          (result.accountName ? ` ${result.accountName} balance is now ${inr(result.balance)}.` : ''),
        {
          id: result.created.id,
          amount,
          transactionType,
          category: result.categoryName,
          account: result.accountName,
          accountBalance: result.balance,
        }
      );
    },
  },
  {
    name: 'update_transaction',
    description:
      'Edit an existing transaction (amount, category, merchant, description, type or date). Balances are adjusted automatically. Omit "reference" to edit the most recent transaction.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        reference: { type: SchemaType.STRING, description: 'Transaction id, or omit/"last" for the latest' },
        amount: { type: SchemaType.NUMBER },
        transactionType: { type: SchemaType.STRING, description: TRANSACTION_TYPES },
        category: { type: SchemaType.STRING },
        merchant: { type: SchemaType.STRING },
        description: { type: SchemaType.STRING },
        date: { type: SchemaType.STRING },
      },
    },
    execute: async (userId, a) => {
      const existing = await pickTransaction(userId, a.reference);
      if (!existing) return fail('No matching transaction found.');

      const newType = a.transactionType
        ? oneOf(a.transactionType, TRANSACTION_TYPES_ENUM, existing.transactionType)
        : existing.transactionType;
      const newAmount = a.amount != null ? num(a.amount) : num(existing.amount);

      const result = await prisma.$transaction(async (tx) => {
        const cur = await tx.transaction.findFirst({ where: { id: existing.id, userId } });
        if (!cur) return null;
        const category = a.category ? await pickCategory(tx, userId, a.category, newType) : null;
        const oldDelta = cur.accountId ? balanceDelta(cur.transactionType, num(cur.amount)) : 0;
        const newDelta = cur.accountId ? balanceDelta(newType, newAmount) : 0;

        const updated = await tx.transaction.update({
          where: { id: cur.id },
          data: {
            amount: newAmount,
            transactionType: newType,
            categoryId: category ? category.id : cur.categoryId,
            merchant: a.merchant !== undefined ? a.merchant : cur.merchant,
            description: a.description !== undefined ? a.description : cur.description,
            date: a.date ? toDate(a.date) : cur.date,
          },
        });
        let balance = null;
        if (cur.accountId && oldDelta !== newDelta) {
          const acct = await tx.financialAccount.update({
            where: { id: cur.accountId },
            data: { balance: { increment: newDelta - oldDelta } },
          });
          balance = num(acct.balance);
        }
        return { updated, balance };
      });

      if (!result) return fail('Transaction no longer exists.');
      emit(userId, 'update_transaction', 'transaction', { id: result.updated.id });
      return ok(
        `Updated transaction to ${newType} ${inr(newAmount)} on ${result.updated.date
          .toISOString()
          .slice(0, 10)}.` + (result.balance != null ? ` Account balance now ${inr(result.balance)}.` : ''),
        { id: result.updated.id, amount: newAmount, transactionType: newType, accountBalance: result.balance }
      );
    },
  },
  {
    name: 'delete_transaction',
    description:
      'Delete a transaction and revert its effect on the account balance. Omit "reference" to delete the most recent transaction.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        reference: { type: SchemaType.STRING, description: 'Transaction id, or omit/"last" for the latest' },
      },
    },
    execute: async (userId, a) => {
      const existing = await pickTransaction(userId, a.reference);
      if (!existing) return fail('No matching transaction found.');
      const snapshot = { amount: num(existing.amount), type: existing.transactionType, merchant: existing.merchant };

      await prisma.$transaction(async (tx) => {
        const cur = await tx.transaction.findFirst({ where: { id: existing.id, userId } });
        if (!cur) return;
        if (cur.accountId) {
          await tx.financialAccount.update({
            where: { id: cur.accountId },
            data: { balance: { increment: -balanceDelta(cur.transactionType, num(cur.amount)) } },
          });
        }
        await tx.transaction.delete({ where: { id: cur.id } });
      });

      emit(userId, 'delete_transaction', 'transaction', { id: existing.id });
      return ok(`Deleted the ${snapshot.type} of ${inr(snapshot.amount)}${snapshot.merchant ? ` at ${snapshot.merchant}` : ''} and reverted its balance effect.`, {
        id: existing.id,
      });
    },
  },
  {
    name: 'transfer_between_accounts',
    description: 'Move money between two of the user\'s own accounts (atomic, double-entry).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        fromAccount: { type: SchemaType.STRING, description: 'Source account name or id' },
        toAccount: { type: SchemaType.STRING, description: 'Destination account name or id' },
        amount: { type: SchemaType.NUMBER },
        description: { type: SchemaType.STRING },
      },
      required: ['amount'],
    },
    execute: async (userId, a) => {
      const amount = num(a.amount);
      if (!(amount > 0)) return fail('Amount must be positive.');
      const from = await pickAccount(userId, a.fromAccount);
      const to = await pickAccount(userId, a.toAccount);
      if (!from || !to) return fail('Could not resolve both accounts.');
      if (from.id === to.id) return fail('Source and destination must differ.');

      await prisma.$transaction(async (tx) => {
        await tx.financialAccount.update({ where: { id: from.id }, data: { balance: { decrement: amount } } });
        await tx.financialAccount.update({ where: { id: to.id }, data: { balance: { increment: amount } } });
        const category = await pickCategory(tx, userId, 'Transfer', 'TRANSFER');
        await tx.transaction.create({
          data: {
            userId,
            accountId: from.id,
            categoryId: category.id,
            amount,
            transactionType: 'TRANSFER',
            description: a.description || `Transfer to ${to.name}`,
            merchant: to.name,
            date: new Date(),
          },
        });
      });

      emit(userId, 'transfer_between_accounts', 'account', {});
      return ok(`Transferred ${inr(amount)} from ${from.name} to ${to.name}.`, {
        from: from.name,
        to: to.name,
        amount,
      });
    },
  },
  {
    name: 'create_budget',
    description: 'Create or update a monthly spending budget for a category.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        categoryName: { type: SchemaType.STRING, description: 'e.g. Food & Dining' },
        monthlyLimit: { type: SchemaType.NUMBER },
        month: { type: SchemaType.NUMBER, description: '1-12, default current month' },
        year: { type: SchemaType.NUMBER, description: 'default current year' },
      },
      required: ['categoryName', 'monthlyLimit'],
    },
    execute: async (userId, a) => {
      const now = new Date();
      const month = num(a.month) || now.getMonth() + 1;
      const year = num(a.year) || now.getFullYear();
      const limit = num(a.monthlyLimit);
      if (!(limit > 0)) return fail('monthlyLimit must be positive.');
      const categoryName = String(a.categoryName).trim();

      const budget = await prisma.$transaction(async (tx) => {
        const category = await pickCategory(tx, userId, categoryName, 'EXPENSE');
        return tx.budget.upsert({
          where: { userId_categoryName_month_year: { userId, categoryName, month, year } },
          create: { userId, categoryId: category.id, categoryName, monthlyLimit: limit, month, year },
          update: { monthlyLimit: limit, categoryId: category.id },
        });
      });

      emit(userId, 'create_budget', 'budget', { id: budget.id });
      return ok(`Set a ${inr(limit)} budget for ${categoryName} in ${month}/${year}.`, {
        id: budget.id,
        categoryName,
        monthlyLimit: limit,
        month,
        year,
      });
    },
  },
  {
    name: 'delete_budget',
    description: 'Delete a category budget for a given month.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        categoryName: { type: SchemaType.STRING },
        month: { type: SchemaType.NUMBER },
        year: { type: SchemaType.NUMBER },
      },
      required: ['categoryName'],
    },
    execute: async (userId, a) => {
      const now = new Date();
      const month = num(a.month) || now.getMonth() + 1;
      const year = num(a.year) || now.getFullYear();
      const deleted = await prisma.budget.deleteMany({
        where: { userId, categoryName: { equals: String(a.categoryName), mode: 'insensitive' }, month, year },
      });
      if (!deleted.count) return fail('No matching budget found.');
      emit(userId, 'delete_budget', 'budget', {});
      return ok(`Deleted the ${a.categoryName} budget for ${month}/${year}.`, { deleted: deleted.count });
    },
  },
  {
    name: 'create_goal',
    description: 'Create a savings goal with a target amount and optional target date.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: { type: SchemaType.STRING },
        targetAmount: { type: SchemaType.NUMBER },
        currentAmount: { type: SchemaType.NUMBER, description: 'Amount already saved, default 0' },
        targetDate: { type: SchemaType.STRING, description: 'e.g. 2027-03-31' },
        goalType: { type: SchemaType.STRING, description: 'EMERGENCY_FUND, VACATION, HOME, CAR, EDUCATION, RETIREMENT, WEDDING, INVESTMENT or OTHER' },
        monthlyContribution: { type: SchemaType.NUMBER },
        priority: { type: SchemaType.STRING, description: 'HIGH, MEDIUM or LOW' },
      },
      required: ['name', 'targetAmount'],
    },
    execute: async (userId, a) => {
      const target = num(a.targetAmount);
      if (!(target > 0)) return fail('targetAmount must be positive.');
      const goal = await prisma.goal.create({
        data: {
          userId,
          name: String(a.name).trim(),
          goalType: oneOf(a.goalType, GOAL_TYPES, 'OTHER'),
          targetAmount: target,
          currentAmount: num(a.currentAmount),
          monthlyContribution: num(a.monthlyContribution),
          priority: oneOf(a.priority, PRIORITIES, 'MEDIUM'),
          targetDate: a.targetDate ? toDate(a.targetDate) : null,
        },
      });
      emit(userId, 'create_goal', 'goal', { id: goal.id });
      return ok(
        `Created goal "${goal.name}" for ${inr(target)}${
          goal.targetDate ? ` by ${goal.targetDate.toISOString().slice(0, 10)}` : ''
        }.`,
        { id: goal.id, name: goal.name, targetAmount: target }
      );
    },
  },
  {
    name: 'contribute_to_goal',
    description: 'Add money to an existing savings goal. Marks it completed automatically when the target is met.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        goal: { type: SchemaType.STRING, description: 'Goal name or id (required)' },
        amount: { type: SchemaType.NUMBER },
      },
      required: ['goal', 'amount'],
    },
    execute: async (userId, a) => {
      const amount = num(a.amount);
      if (!(amount > 0)) return fail('Amount must be positive.');
      const goal = await pickGoal(userId, a.goal);
      if (!goal) return fail('No matching goal found.');

      const updated = await prisma.goal.update({
        where: { id: goal.id },
        data: {
          currentAmount: { increment: amount },
        },
      });
      const current = num(updated.currentAmount);
      const target = num(updated.targetAmount);
      if (current >= target && updated.status !== 'COMPLETED') {
        await prisma.goal.update({ where: { id: goal.id }, data: { status: 'COMPLETED' } });
      }

      emit(userId, 'contribute_to_goal', 'goal', { id: goal.id });
      return ok(
        `Added ${inr(amount)} to "${goal.name}". Progress ${inr(current)}/${inr(target)} (${Math.round(
          (current / Math.max(target, 1)) * 100
        )}%).`,
        { id: goal.id, name: goal.name, currentAmount: current, targetAmount: target }
      );
    },
  },
  {
    name: 'delete_goal',
    description: 'Delete a savings goal.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { goal: { type: SchemaType.STRING, description: 'Goal name or id' } },
      required: ['goal'],
    },
    execute: async (userId, a) => {
      const goal = await pickGoal(userId, a.goal);
      if (!goal) return fail('No matching goal found.');
      await prisma.goal.delete({ where: { id: goal.id } });
      emit(userId, 'delete_goal', 'goal', {});
      return ok(`Deleted goal "${goal.name}".`, { id: goal.id });
    },
  },
  {
    name: 'create_loan',
    description: 'Add a loan with principal, interest rate and tenure. EMI is calculated automatically if not supplied.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        principalAmount: { type: SchemaType.NUMBER },
        interestRate: { type: SchemaType.NUMBER, description: 'Annual percentage, e.g. 9.5' },
        tenureMonths: { type: SchemaType.NUMBER },
        loanType: { type: SchemaType.STRING, description: 'HOME, CAR, PERSONAL, EDUCATION, BUSINESS, GOLD or OTHER' },
        lenderName: { type: SchemaType.STRING },
        startDate: { type: SchemaType.STRING },
        emiAmount: { type: SchemaType.NUMBER, description: 'Optional, otherwise auto-calculated' },
      },
      required: ['principalAmount', 'interestRate', 'tenureMonths'],
    },
    execute: async (userId, a) => {
      const principal = num(a.principalAmount);
      const rate = num(a.interestRate);
      const months = Math.max(1, Math.round(num(a.tenureMonths)));
      if (!(principal > 0)) return fail('principalAmount must be positive.');

      const r = rate / 12 / 100;
      const emi =
        a.emiAmount != null
          ? num(a.emiAmount)
          : r > 0
          ? (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1)
          : principal / months;

      const loan = await prisma.loan.create({
        data: {
          userId,
          loanType: oneOf(a.loanType, LOAN_TYPES, 'PERSONAL'),
          lenderName: a.lenderName || null,
          principalAmount: principal,
          interestRate: rate,
          tenureMonths: months,
          startDate: toDate(a.startDate),
          emiAmount: Math.round(emi * 100) / 100,
          outstandingBalance: principal,
        },
      });
      emit(userId, 'create_loan', 'loan', { id: loan.id });
      return ok(
        `Added a ${loan.loanType} loan of ${inr(principal)} at ${rate}% over ${months} months. EMI ≈ ${inr(
          loan.emiAmount
        )}.`,
        { id: loan.id, principal, interestRate: rate, tenureMonths: months, emiAmount: num(loan.emiAmount) }
      );
    },
  },
  {
    name: 'record_loan_payment',
    description: 'Record an EMI / loan repayment: reduces the loan outstanding and the paying account balance.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        loan: { type: SchemaType.STRING, description: 'Loan id or lender name (optional = latest active loan)' },
        amount: { type: SchemaType.NUMBER, description: 'Optional, defaults to the loan EMI' },
        account: { type: SchemaType.STRING, description: 'Account to pay from (defaults to primary)' },
      },
    },
    execute: async (userId, a) => {
      const loan = await pickLoan(userId, a.loan);
      if (!loan) return fail('No active loan found.');
      const amount = num(a.amount) || num(loan.emiAmount);
      if (!(amount > 0)) return fail('Amount must be positive.');
      const newOutstanding = Math.max(0, num(loan.outstandingBalance) - amount);

      const result = await prisma.$transaction(async (tx) => {
        const updatedLoan = await tx.loan.update({
          where: { id: loan.id },
          data: {
            outstandingBalance: newOutstanding,
            status: newOutstanding <= 0 ? 'CLOSED' : loan.status,
          },
        });
        const account = await pickAccount(userId, a.account, tx);
        if (account) {
          await tx.financialAccount.update({
            where: { id: account.id },
            data: { balance: { decrement: amount } },
          });
        }
        const category = await pickCategory(tx, userId, 'Debt & EMI', 'EXPENSE');
        await tx.transaction.create({
          data: {
            userId,
            accountId: account?.id || null,
            categoryId: category.id,
            amount,
            transactionType: 'LOAN_PAYMENT',
            description: `Loan payment — ${loan.lenderName || loan.loanType}`,
            merchant: loan.lenderName || loan.loanType,
            date: new Date(),
          },
        });
        return { updatedLoan, accountName: account?.name || null };
      });

      emit(userId, 'record_loan_payment', 'loan', { id: loan.id });
      return ok(
        `Recorded a ${inr(amount)} loan payment. Outstanding is now ${inr(newOutstanding)}${
          result.updatedLoan.status === 'CLOSED' ? ' — loan closed 🎉' : ''
        }.`,
        { id: loan.id, outstandingBalance: newOutstanding, status: result.updatedLoan.status }
      );
    },
  },
  {
    name: 'add_investment',
    description:
      'Add or top-up an investment holding (stock, mutual fund, gold, FD, crypto…). Merges into the existing holding and recalculates the weighted average buy price.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        symbol: { type: SchemaType.STRING, description: 'Ticker or short name, e.g. RELIANCE, GOLDBEES' },
        name: { type: SchemaType.STRING },
        assetType: { type: SchemaType.STRING, description: 'STOCK, MUTUAL_FUND, SIP, GOLD, SILVER, FIXED_DEPOSIT, CRYPTO, BOND, ETF or OTHER' },
        quantity: { type: SchemaType.NUMBER },
        averageBuyPrice: { type: SchemaType.NUMBER, description: 'Price per unit' },
        account: { type: SchemaType.STRING, description: 'Optional account to debit for this purchase' },
      },
      required: ['symbol', 'quantity', 'averageBuyPrice'],
    },
    execute: async (userId, a) => {
      const qty = num(a.quantity);
      const price = num(a.averageBuyPrice);
      if (!(qty > 0) || !(price > 0)) return fail('quantity and averageBuyPrice must be positive.');
      const symbol = String(a.symbol).trim().toUpperCase();

      const result = await prisma.$transaction(async (tx) => {
        const portfolio = await tx.portfolio.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        const existing = await tx.investment.findFirst({ where: { portfolioId: portfolio.id, symbol } });
        if (existing) {
          const newQty = num(existing.quantity) + qty;
          const newAvg =
            newQty > 0
              ? (num(existing.averageBuyPrice) * num(existing.quantity) + price * qty) / newQty
              : price;
          await tx.investment.update({
            where: { id: existing.id },
            data: { quantity: newQty, averageBuyPrice: Math.round(newAvg * 100) / 100 },
          });
        } else {
          await tx.investment.create({
            data: {
              portfolioId: portfolio.id,
              symbol,
              name: a.name || symbol,
              assetType: oneOf(a.assetType, ASSET_TYPES, 'STOCK'),
              quantity: qty,
              averageBuyPrice: price,
            },
          });
        }
        const rolled = await refreshPortfolio(tx, portfolio.id);

        // Optional: debit the paying account + log an INVESTMENT transaction.
        if (a.account) {
          const account = await pickAccount(userId, a.account, tx);
          const value = Math.round(qty * price * 100) / 100;
          if (account) {
            await tx.financialAccount.update({
              where: { id: account.id },
              data: { balance: { decrement: value } },
            });
            const category = await pickCategory(tx, userId, 'Investments', 'EXPENSE');
            await tx.transaction.create({
              data: {
                userId,
                accountId: account.id,
                categoryId: category.id,
                amount: value,
                transactionType: 'INVESTMENT',
                description: `Investment — ${symbol}`,
                merchant: symbol,
                date: new Date(),
              },
            });
          }
        }
        return { portfolio: rolled };
      });

      const holding = await prisma.investment.findFirst({
        where: { portfolioId: result.portfolio.id, symbol },
      });

      emit(userId, 'add_investment', 'investment', { symbol });
      return ok(
        `Invested in ${symbol}: ${num(holding.quantity)} units @ avg ${inr(
          holding.averageBuyPrice
        )} = ${inr(
          num(holding.quantity) * num(holding.averageBuyPrice)
        )}. Portfolio cost basis is now ${inr(result.portfolio.totalInvested)}.`,
        {
          symbol,
          quantity: num(holding.quantity),
          averageBuyPrice: num(holding.averageBuyPrice),
          portfolioCostBasis: num(result.portfolio.totalInvested),
        }
      );
    },
  },
  {
    name: 'create_card',
    description: 'Add a credit or debit card (stores only the last four digits — never a full card number).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        cardNickname: { type: SchemaType.STRING },
        issuer: { type: SchemaType.STRING, description: 'HDFC, SBI, ICICI, Axis…' },
        lastFourDigits: { type: SchemaType.STRING, description: 'Exactly the last 4 digits' },
        cardType: { type: SchemaType.STRING, description: 'CREDIT or DEBIT' },
        creditLimit: { type: SchemaType.NUMBER },
        outstandingAmount: { type: SchemaType.NUMBER },
        dueDate: { type: SchemaType.STRING },
      },
      required: ['cardNickname', 'issuer', 'lastFourDigits'],
    },
    execute: async (userId, a) => {
      const digits = String(a.lastFourDigits).replace(/\D/g, '').slice(-4);
      if (digits.length !== 4) return fail('Provide exactly the last 4 digits.');
      const card = await prisma.card.create({
        data: {
          userId,
          cardNickname: String(a.cardNickname).trim(),
          issuer: String(a.issuer).trim(),
          lastFourDigits: digits,
          cardType: oneOf(a.cardType, CARD_TYPES, 'CREDIT'),
          creditLimit: a.creditLimit != null ? num(a.creditLimit) : null,
          outstandingAmount: num(a.outstandingAmount),
          dueDate: a.dueDate ? toDate(a.dueDate) : null,
        },
      });
      emit(userId, 'create_card', 'card', { id: card.id });
      return ok(`Added ${card.cardNickname} (${card.issuer} ****${card.lastFourDigits}).`, {
        id: card.id,
        cardNickname: card.cardNickname,
      });
    },
  },
  {
    name: 'pay_credit_card',
    description: 'Pay a credit card bill: reduces the card outstanding and debits the paying account.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        card: { type: SchemaType.STRING, description: 'Card nickname / issuer / id (optional = latest card)' },
        amount: { type: SchemaType.NUMBER, description: 'Optional = full outstanding' },
        account: { type: SchemaType.STRING, description: 'Account to pay from (defaults to primary)' },
      },
    },
    execute: async (userId, a) => {
      const card = await pickCard(userId, a.card);
      if (!card) return fail('No card found.');
      const amount = num(a.amount) || num(card.outstandingAmount);
      if (!(amount > 0)) return fail('Nothing to pay on this card.');

      const result = await prisma.$transaction(async (tx) => {
        const newOutstanding = Math.max(0, num(card.outstandingAmount) - amount);
        const updatedCard = await tx.card.update({
          where: { id: card.id },
          data: { outstandingAmount: newOutstanding },
        });
        const account = await pickAccount(userId, a.account, tx);
        if (account) {
          await tx.financialAccount.update({
            where: { id: account.id },
            data: { balance: { decrement: amount } },
          });
        }
        const category = await pickCategory(tx, userId, 'Debt & EMI', 'EXPENSE');
        await tx.transaction.create({
          data: {
            userId,
            accountId: account?.id || null,
            categoryId: category.id,
            amount,
            transactionType: 'EXPENSE',
            description: `Credit card payment — ${card.cardNickname}`,
            merchant: card.issuer,
            date: new Date(),
          },
        });
        return { updatedCard, newOutstanding };
      });

      emit(userId, 'pay_credit_card', 'card', { id: card.id });
      return ok(
        `Paid ${inr(amount)} towards ${card.cardNickname}. Outstanding is now ${inr(
          result.newOutstanding
        )}.`,
        { id: card.id, outstandingAmount: result.newOutstanding }
      );
    },
  },
  {
    name: 'create_task',
    description: 'Create a financial task / bill reminder (EMI, credit card, SIP, insurance, tax…).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        dueDate: { type: SchemaType.STRING },
        category: { type: SchemaType.STRING, description: 'EMI, CREDIT_CARD, SIP, INSURANCE, SUBSCRIPTION, TAX, BUDGET or GENERAL' },
        priority: { type: SchemaType.STRING, description: 'HIGH, MEDIUM or LOW' },
        notes: { type: SchemaType.STRING },
      },
      required: ['title', 'dueDate'],
    },
    execute: async (userId, a) => {
      const task = await prisma.financialTask.create({
        data: {
          userId,
          title: String(a.title).trim(),
          dueDate: toDate(a.dueDate),
          category: a.category ? String(a.category).toUpperCase() : 'GENERAL',
          priority: oneOf(a.priority, PRIORITIES, 'MEDIUM'),
          notes: a.notes || null,
        },
      });
      emit(userId, 'create_task', 'task', { id: task.id });
      return ok(`Created task "${task.title}" due ${task.dueDate.toISOString().slice(0, 10)}.`, {
        id: task.id,
        title: task.title,
        dueDate: task.dueDate.toISOString().slice(0, 10),
      });
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a financial task as completed.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { task: { type: SchemaType.STRING, description: 'Task title or id (optional = next due task)' } },
    },
    execute: async (userId, a) => {
      const task = await pickTask(userId, a.task);
      if (!task) return fail('No matching open task found.');
      await prisma.financialTask.update({
        where: { id: task.id },
        data: { isCompleted: true, completedAt: new Date() },
      });
      emit(userId, 'complete_task', 'task', { id: task.id });
      return ok(`Marked "${task.title}" as completed.`, { id: task.id });
    },
  },
  {
    name: 'create_subscription',
    description: 'Track a recurring subscription with its cost and next billing date.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        serviceName: { type: SchemaType.STRING },
        cost: { type: SchemaType.NUMBER },
        billingCycle: { type: SchemaType.STRING, description: 'MONTHLY, QUARTERLY or YEARLY' },
        nextBillingDate: { type: SchemaType.STRING },
        category: { type: SchemaType.STRING, description: 'e.g. Entertainment, Productivity' },
      },
      required: ['serviceName', 'cost', 'nextBillingDate'],
    },
    execute: async (userId, a) => {
      const sub = await prisma.subscription.create({
        data: {
          userId,
          serviceName: String(a.serviceName).trim(),
          cost: num(a.cost),
          billingCycle: a.billingCycle ? String(a.billingCycle).toUpperCase() : 'MONTHLY',
          nextBillingDate: toDate(a.nextBillingDate),
          category: a.category || null,
        },
      });
      emit(userId, 'create_subscription', 'subscription', { id: sub.id });
      return ok(
        `Tracking ${sub.serviceName} at ${inr(sub.cost)}/${sub.billingCycle}, renews ${sub.nextBillingDate
          .toISOString()
          .slice(0, 10)}.`,
        { id: sub.id, serviceName: sub.serviceName, cost: num(sub.cost) }
      );
    },
  },
  {
    name: 'create_reminder',
    description: 'Add a calendar event / reminder for an upcoming financial date.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        eventDate: { type: SchemaType.STRING },
        description: { type: SchemaType.STRING },
        eventType: { type: SchemaType.STRING, description: 'e.g. EMI, BILL, INVESTMENT, CUSTOM' },
        amount: { type: SchemaType.NUMBER },
      },
      required: ['title', 'eventDate'],
    },
    execute: async (userId, a) => {
      const event = await prisma.calendarEvent.create({
        data: {
          userId,
          title: String(a.title).trim(),
          eventDate: toDate(a.eventDate),
          description: a.description || null,
          eventType: a.eventType ? String(a.eventType).toUpperCase() : 'CUSTOM',
          amount: a.amount != null ? num(a.amount) : null,
        },
      });
      emit(userId, 'create_reminder', 'calendar', { id: event.id });
      return ok(`Reminder "${event.title}" set for ${event.eventDate.toISOString().slice(0, 10)}.`, {
        id: event.id,
        title: event.title,
        eventDate: event.eventDate.toISOString().slice(0, 10),
      });
    },
  },
  {
    name: 'create_account',
    description: 'Add a new financial account (bank, cash, wallet, credit card, savings…).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: { type: SchemaType.STRING },
        accountType: { type: SchemaType.STRING, description: 'BANK, CASH, WALLET, CREDIT_CARD, SAVINGS, CURRENT or OTHER' },
        institution: { type: SchemaType.STRING },
        balance: { type: SchemaType.NUMBER, description: 'Opening balance, default 0' },
      },
      required: ['name'],
    },
    execute: async (userId, a) => {
      const account = await prisma.financialAccount.create({
        data: {
          userId,
          name: String(a.name).trim(),
          accountType: oneOf(a.accountType, ACCOUNT_TYPES, 'BANK'),
          institution: a.institution || null,
          balance: num(a.balance),
        },
      });
      emit(userId, 'create_account', 'account', { id: account.id });
      return ok(`Created account "${account.name}" (${account.accountType}) with balance ${inr(account.balance)}.`, {
        id: account.id,
        name: account.name,
        balance: num(account.balance),
      });
    },
  },
  {
    name: 'deposit_to_account',
    description: 'Add money to an account (e.g. salary, refund, cash deposit). Records an INCOME transaction.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: { type: SchemaType.STRING, description: 'Account name or id (defaults to primary)' },
        amount: { type: SchemaType.NUMBER },
        description: { type: SchemaType.STRING, description: 'e.g. Salary' },
        category: { type: SchemaType.STRING },
        date: { type: SchemaType.STRING },
      },
      required: ['amount'],
    },
    execute: async (userId, a) => {
      const amount = num(a.amount);
      if (!(amount > 0)) return fail('Amount must be positive.');
      const result = await prisma.$transaction(async (tx) => {
        const account = await pickAccount(userId, a.account, tx);
        if (!account) return null;
        const category = await pickCategory(tx, userId, a.category || 'Income', 'INCOME');
        await tx.transaction.create({
          data: {
            userId,
            accountId: account.id,
            categoryId: category.id,
            amount,
            transactionType: 'INCOME',
            description: a.description || 'Deposit',
            merchant: a.description || null,
            date: toDate(a.date),
          },
        });
        const updated = await tx.financialAccount.update({
          where: { id: account.id },
          data: { balance: { increment: amount } },
        });
        return { name: account.name, balance: num(updated.balance) };
      });
      if (!result) return fail('No account available to deposit into.');
      emit(userId, 'deposit_to_account', 'account', {});
      return ok(`Deposited ${inr(amount)} into ${result.name}. New balance ${inr(result.balance)}.`, {
        account: result.name,
        balance: result.balance,
      });
    },
  },
  {
    name: 'confirm_pending_sms',
    description:
      'Confirm a pending bank-SMS transaction, promoting it into the canonical ledger and updating the account balance. Omit "reference" to confirm the latest one.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        reference: { type: SchemaType.STRING, description: 'Pending id or merchant, or omit/"latest"' },
        category: { type: SchemaType.STRING, description: 'Override the suggested category' },
      },
    },
    execute: async (userId, a) => {
      const pending = await pickPendingSms(userId, a.reference);
      if (!pending) return fail('No pending SMS transaction found.');

      const result = await prisma.$transaction(async (tx) => {
        const account = pending.matchedAccountId
          ? await tx.financialAccount.findFirst({ where: { id: pending.matchedAccountId, userId } })
          : await pickAccount(userId, null, tx);
        const categoryName =
          a.category || pending.suggestedCategory || inferCategory(pending.merchant || '', pending.transactionType);
        const category = await pickCategory(tx, userId, categoryName, pending.transactionType);

        const txRow = await tx.transaction.create({
          data: {
            userId,
            accountId: account?.id || null,
            categoryId: category.id,
            amount: pending.amount,
            transactionType: pending.transactionType,
            merchant: pending.merchant,
            description: `SMS: ${pending.merchant || pending.transactionType}`,
            date: pending.transactionDate,
          },
        });

        let balance = null;
        if (account) {
          const updated = await tx.financialAccount.update({
            where: { id: account.id },
            data: { balance: { increment: balanceDelta(pending.transactionType, num(pending.amount)) } },
          });
          balance = num(updated.balance);
        }

        await tx.pendingSmsTransaction.update({
          where: { id: pending.id },
          data: { status: 'CONFIRMED', confirmedTransactionId: txRow.id },
        });

        return { txRow, balance, accountName: account?.name || null, categoryName };
      });

      emit(userId, 'confirm_pending_sms', 'transaction', { id: result.txRow.id });
      return ok(
        `Confirmed the ${pending.transactionType} of ${inr(pending.amount)}${
          pending.merchant ? ` at ${pending.merchant}` : ''
        } into ${result.categoryName}.` +
          (result.accountName ? ` ${result.accountName} balance is now ${inr(result.balance)}.` : ''),
        { transactionId: result.txRow.id, accountBalance: result.balance }
      );
    },
  },
  {
    name: 'reject_pending_sms',
    description: 'Reject a pending bank-SMS transaction so it is removed from the review queue. Omit "reference" for the latest.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        reference: { type: SchemaType.STRING, description: 'Pending id or merchant, or omit/"latest"' },
      },
    },
    execute: async (userId, a) => {
      const pending = await pickPendingSms(userId, a.reference);
      if (!pending) return fail('No pending SMS transaction found.');
      await prisma.pendingSmsTransaction.update({ where: { id: pending.id }, data: { status: 'REJECTED' } });
      emit(userId, 'reject_pending_sms', 'sms', { id: pending.id });
      return ok(
        `Rejected the pending ${pending.transactionType} of ${inr(pending.amount)}${
          pending.merchant ? ` at ${pending.merchant}` : ''
        }.`,
        { pendingId: pending.id }
      );
    },
  },
];

const TOOL_MAP = Object.fromEntries(TOOL_LIST.map((t) => [t.name, t]));

/** Gemini `functionDeclarations` payload. */
const DECLARATIONS = TOOL_LIST.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}));

module.exports = { TOOL_LIST, TOOL_MAP, DECLARATIONS, pickAccount, emit };
