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
const analyticsEngine = require('./analyticsEngine');
const realtime = require('./realtimeService');
const { parseNaturalDate, inferCategory } = require('./aiActionService');
const { ACCOUNT_TYPES } = require('../config/accountTypes');
const {
  transactionEffects,
  reverseEffects,
  applyEffects,
  revertEffects,
} = require('./transactionBalance');

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
 * `Investment` has no `userId` of its own — it hangs off `Portfolio`, so every
 * lookup has to go through the portfolio relation to stay scoped to the caller.
 */
async function pickInvestment(userId, ref, db = prisma) {
  if (!ref) return null;
  const r = String(ref).trim();
  return db.investment.findFirst({
    where: {
      portfolio: { userId },
      OR: [
        { id: r },
        { symbol: { equals: r, mode: 'insensitive' } },
        { symbol: { contains: r, mode: 'insensitive' } },
        { name: { contains: r, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function pickInsurance(userId, ref, db = prisma) {
  if (!ref || /^(last|latest|recent|next)$/i.test(String(ref))) {
    return db.insurancePolicy.findFirst({
      where: { userId, isActive: true },
      orderBy: { renewalDate: 'asc' },
    });
  }
  return db.insurancePolicy.findFirst({
    where: {
      userId,
      OR: [
        { id: String(ref) },
        { policyName: { contains: String(ref), mode: 'insensitive' } },
        { insurer: { contains: String(ref), mode: 'insensitive' } },
        { policyNumber: { equals: String(ref) } },
      ],
    },
    orderBy: { renewalDate: 'asc' },
  });
}

async function pickSubscription(userId, ref, db = prisma) {
  if (!ref || /^(last|latest|recent|next)$/i.test(String(ref))) {
    return db.subscription.findFirst({
      where: { userId, isActive: true },
      orderBy: { nextBillingDate: 'asc' },
    });
  }
  return db.subscription.findFirst({
    where: {
      userId,
      OR: [
        { id: String(ref) },
        { serviceName: { contains: String(ref), mode: 'insensitive' } },
      ],
    },
    orderBy: { nextBillingDate: 'asc' },
  });
}

async function pickCalendarEvent(userId, ref, db = prisma) {
  if (!ref || /^(last|latest|recent|newest|next|upcoming)$/i.test(String(ref))) {
    return db.calendarEvent.findFirst({
      where: { userId, eventDate: { gte: new Date(Date.now() - 86_400_000) } },
      orderBy: { eventDate: 'asc' },
    });
  }
  return db.calendarEvent.findFirst({
    where: {
      userId,
      OR: [
        { id: String(ref) },
        { title: { contains: String(ref), mode: 'insensitive' } },
      ],
    },
    orderBy: { eventDate: 'asc' },
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
        const spent = await prisma.transaction.groupBy({
          by: ['transactionType'],
          where: {
            userId,
            transactionType: { in: analyticsEngine.SPENDING_TYPES },
            date: { gte: start, lte: end },
            category: { name: { equals: b.categoryName, mode: 'insensitive' } },
          },
          _sum: { amount: true },
        });
        const used = Math.max(0, analyticsEngine.signedTotal(spent));
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
        by: ['categoryId', 'transactionType'],
        where: { userId, transactionType: { in: analyticsEngine.SPENDING_TYPES }, date: { gte: from, lte: to } },
        _sum: { amount: true },
      });
      const categoryTotals = new Map();
      for (const row of grouped) {
        const key = row.categoryId || null;
        categoryTotals.set(key, (categoryTotals.get(key) || 0) + analyticsEngine.signedTotal([row]));
      }
      const netGrouped = Array.from(categoryTotals.entries())
        .map(([categoryId, amount]) => ({ categoryId, amount: analyticsEngine.round2(amount) }))
        .filter((row) => row.amount > 0)
        .sort((a, b) => b.amount - a.amount);
      const cats = await prisma.category.findMany({
        where: { id: { in: netGrouped.map((g) => g.categoryId).filter(Boolean) } },
        select: { id: true, name: true },
      });
      const nameById = Object.fromEntries(cats.map((c) => [c.id, c.name]));
      const total = netGrouped.reduce((s, g) => s + g.amount, 0);
      const rows = netGrouped.map((g) => ({
        category: nameById[g.categoryId] || 'Uncategorised',
        amount: g.amount,
        sharePct: total > 0 ? Math.round((g.amount / total) * 100) : 0,
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
      // A generic transaction has one balance leg. Transfers are two-legged
      // and must go through transfer_between_accounts so both accounts move.
      if (String(a.transactionType || '').trim().toUpperCase() === 'TRANSFER') {
        return fail('Use transfer_between_accounts to move money between two accounts.');
      }
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
      // Converting between a two-legged transfer and a one-legged transaction
      // would drop or invent a balance leg. Require an explicit delete+create.
      if ((newType === 'TRANSFER') !== (existing.transactionType === 'TRANSFER')) {
        return fail('A transaction cannot be converted to or from a transfer.');
      }
      const newAmount = a.amount != null ? num(a.amount) : num(existing.amount);
      if (!(newAmount > 0)) return fail('Amount must be a positive number.');

      const result = await prisma.$transaction(async (tx) => {
        const cur = await tx.transaction.findFirst({ where: { id: existing.id, userId } });
        if (!cur) return null;
        const category = a.category ? await pickCategory(tx, userId, a.category, newType) : null;

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

        // Replace the old ledger effect with the new one. Works for
        // single-account rows and for transfers (both legs), and nets to zero
        // when only descriptive fields changed.
        await applyEffects(tx, [
          ...reverseEffects(cur),
          ...transactionEffects({
            transactionType: updated.transactionType,
            amount: updated.amount,
            accountId: updated.accountId,
            toAccountId: updated.toAccountId,
          }),
        ]);

        let balance = null;
        if (updated.accountId) {
          const acct = await tx.financialAccount.findUnique({
            where: { id: updated.accountId },
            select: { balance: true },
          });
          balance = acct ? num(acct.balance) : null;
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
        // Reverses both legs of a transfer and the single leg of anything else.
        await revertEffects(tx, cur);
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
        const category = await pickCategory(tx, userId, 'Transfer', 'TRANSFER');
        await tx.transaction.create({
          data: {
            userId,
            accountId: from.id,
            toAccountId: to.id,
            categoryId: category.id,
            amount,
            transactionType: 'TRANSFER',
            description: a.description || `Transfer to ${to.name}`,
            merchant: to.name,
            date: new Date(),
          },
        });
        await applyEffects(
          tx,
          transactionEffects({
            transactionType: 'TRANSFER',
            amount,
            accountId: from.id,
            toAccountId: to.id,
          })
        );
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
        accountType: { type: SchemaType.STRING, description: ACCOUNT_TYPES.join(', ') },
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

  // ========================== UPDATE / DELETE SURFACE ==========================
  // Everything below exists so the assistant can *edit and remove* records, not
  // just create them — the "do anything I can do in the app" half of CRUD.

  {
    name: 'update_account',
    description: 'Edit an existing account: rename it, change its type or institution, set an exact balance, or toggle active.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: { type: SchemaType.STRING, description: 'Account name or id (defaults to primary)' },
        name: { type: SchemaType.STRING },
        accountType: { type: SchemaType.STRING, description: ACCOUNT_TYPES.join(', ') },
        institution: { type: SchemaType.STRING },
        balance: { type: SchemaType.NUMBER, description: 'Set an exact balance (overrides the ledger value)' },
        isActive: { type: SchemaType.BOOLEAN },
      },
    },
    execute: async (userId, a) => {
      // Unlike the read helpers, an edit must never silently retarget a
      // different account: a supplied-but-unmatched name is an error, and only a
      // wholly absent reference falls back to the primary account.
      const ref = a.account ? String(a.account).trim() : '';
      const account = ref
        ? await prisma.financialAccount.findFirst({
            where: {
              userId,
              OR: [
                { id: ref },
                { name: { equals: ref, mode: 'insensitive' } },
                { name: { contains: ref, mode: 'insensitive' } },
              ],
            },
            orderBy: { createdAt: 'asc' },
          })
        : await prisma.financialAccount.findFirst({
            where: { userId, isActive: true },
            orderBy: { createdAt: 'asc' },
          });
      if (!account) return fail(ref ? `No account matching "${ref}".` : 'No account found.');
      const updated = await prisma.financialAccount.update({
        where: { id: account.id },
        data: {
          ...(a.name !== undefined && { name: String(a.name).trim() }),
          ...(a.accountType !== undefined && {
            accountType: oneOf(a.accountType, ACCOUNT_TYPES, account.accountType),
          }),
          ...(a.institution !== undefined && { institution: a.institution || null }),
          ...(a.balance != null && { balance: num(a.balance) }),
          ...(a.isActive !== undefined && { isActive: !!a.isActive }),
        },
      });
      emit(userId, 'update_account', 'account', { id: updated.id });
      return ok(`Updated account "${updated.name}" (${updated.accountType}) — balance ${inr(updated.balance)}.`, {
        id: updated.id,
        name: updated.name,
        accountType: updated.accountType,
        balance: num(updated.balance),
      });
    },
  },
  {
    name: 'delete_account',
    description:
      'Archive (deactivate) an account. Transaction history is preserved; the account simply disappears from active lists. Requires an explicit account name or id.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { account: { type: SchemaType.STRING, description: 'Account name or id (required)' } },
      required: ['account'],
    },
    execute: async (userId, a) => {
      const ref = String(a.account || '').trim();
      if (!ref) return fail('Specify which account to archive.');
      const account = await prisma.financialAccount.findFirst({
        where: {
          userId,
          OR: [{ id: ref }, { name: { contains: ref, mode: 'insensitive' } }],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!account) return fail('No matching account found.');
      const activeCount = await prisma.financialAccount.count({ where: { userId, isActive: true } });
      if (activeCount <= 1) return fail('You cannot archive your only active account.');
      await prisma.financialAccount.update({ where: { id: account.id }, data: { isActive: false } });
      emit(userId, 'delete_account', 'account', { id: account.id });
      return ok(`Archived account "${account.name}". Its history is kept but it is hidden from active lists.`, {
        id: account.id,
      });
    },
  },
  {
    name: 'update_goal',
    description: 'Edit an existing savings goal: name, target amount, amount saved, target date, monthly contribution, type, priority or status.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        goal: { type: SchemaType.STRING, description: 'Goal name or id (required)' },
        name: { type: SchemaType.STRING },
        targetAmount: { type: SchemaType.NUMBER },
        currentAmount: { type: SchemaType.NUMBER, description: 'Amount saved so far' },
        monthlyContribution: { type: SchemaType.NUMBER },
        targetDate: { type: SchemaType.STRING },
        goalType: { type: SchemaType.STRING, description: 'EMERGENCY_FUND, VACATION, HOME, CAR, EDUCATION, RETIREMENT, WEDDING, INVESTMENT or OTHER' },
        priority: { type: SchemaType.STRING, description: 'HIGH, MEDIUM or LOW' },
        status: { type: SchemaType.STRING, description: 'ACTIVE, COMPLETED or PAUSED' },
      },
      required: ['goal'],
    },
    execute: async (userId, a) => {
      const goal = await pickGoal(userId, a.goal);
      if (!goal) return fail('No matching goal found.');
      const updated = await prisma.goal.update({
        where: { id: goal.id },
        data: {
          ...(a.name !== undefined && { name: String(a.name).trim() }),
          ...(a.targetAmount != null && { targetAmount: num(a.targetAmount) }),
          ...(a.currentAmount != null && { currentAmount: num(a.currentAmount) }),
          ...(a.monthlyContribution != null && { monthlyContribution: num(a.monthlyContribution) }),
          ...(a.targetDate !== undefined && { targetDate: a.targetDate ? toDate(a.targetDate) : null }),
          ...(a.goalType !== undefined && { goalType: oneOf(a.goalType, GOAL_TYPES, goal.goalType) }),
          ...(a.priority !== undefined && { priority: oneOf(a.priority, PRIORITIES, goal.priority) }),
          ...(a.status !== undefined && {
            status: oneOf(a.status, ['ACTIVE', 'COMPLETED', 'PAUSED'], goal.status),
          }),
        },
      });
      emit(userId, 'update_goal', 'goal', { id: updated.id });
      return ok(
        `Updated goal "${updated.name}" — target ${inr(updated.targetAmount)}, saved ${inr(updated.currentAmount)} (${updated.status}).`,
        {
          id: updated.id,
          name: updated.name,
          targetAmount: num(updated.targetAmount),
          currentAmount: num(updated.currentAmount),
          status: updated.status,
        }
      );
    },
  },
  {
    name: 'update_loan',
    description: 'Edit an existing loan: lender, type, interest rate, tenure, EMI, outstanding balance or status.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        loan: { type: SchemaType.STRING, description: 'Loan id or lender name (defaults to latest active loan)' },
        lenderName: { type: SchemaType.STRING },
        loanType: { type: SchemaType.STRING, description: 'HOME, CAR, PERSONAL, EDUCATION, BUSINESS, GOLD or OTHER' },
        interestRate: { type: SchemaType.NUMBER },
        tenureMonths: { type: SchemaType.NUMBER },
        emiAmount: { type: SchemaType.NUMBER },
        outstandingBalance: { type: SchemaType.NUMBER },
        status: { type: SchemaType.STRING, description: 'ACTIVE, CLOSED or DEFAULTED' },
      },
      required: ['loan'],
    },
    execute: async (userId, a) => {
      const loan = await pickLoan(userId, a.loan);
      if (!loan) return fail('No matching loan found.');
      const updated = await prisma.loan.update({
        where: { id: loan.id },
        data: {
          ...(a.lenderName !== undefined && { lenderName: a.lenderName || null }),
          ...(a.loanType !== undefined && { loanType: oneOf(a.loanType, LOAN_TYPES, loan.loanType) }),
          ...(a.interestRate != null && { interestRate: num(a.interestRate) }),
          ...(a.tenureMonths != null && { tenureMonths: Math.max(1, Math.round(num(a.tenureMonths))) }),
          ...(a.emiAmount != null && { emiAmount: num(a.emiAmount) }),
          ...(a.outstandingBalance != null && { outstandingBalance: Math.max(0, num(a.outstandingBalance)) }),
          ...(a.status !== undefined && {
            status: oneOf(a.status, ['ACTIVE', 'CLOSED', 'DEFAULTED'], loan.status),
          }),
        },
      });
      emit(userId, 'update_loan', 'loan', { id: updated.id });
      return ok(
        `Updated the ${updated.loanType} loan${updated.lenderName ? ` (${updated.lenderName})` : ''} — outstanding ${inr(
          updated.outstandingBalance
        )}, EMI ${inr(updated.emiAmount)}, ${updated.status}.`,
        { id: updated.id, outstandingBalance: num(updated.outstandingBalance), status: updated.status }
      );
    },
  },
  {
    name: 'delete_loan',
    description:
      'Delete a loan record entirely. To mark a paid-off loan closed while keeping its history, use update_loan with status CLOSED instead.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { loan: { type: SchemaType.STRING, description: 'Loan id or lender name (required)' } },
      required: ['loan'],
    },
    execute: async (userId, a) => {
      const ref = String(a.loan || '').trim();
      if (!ref) return fail('Specify which loan to delete.');
      const loan = await prisma.loan.findFirst({
        where: { userId, OR: [{ id: ref }, { lenderName: { contains: ref, mode: 'insensitive' } }] },
        orderBy: { createdAt: 'desc' },
      });
      if (!loan) return fail('No matching loan found.');
      await prisma.loan.delete({ where: { id: loan.id } });
      emit(userId, 'delete_loan', 'loan', {});
      return ok(`Deleted the ${loan.loanType} loan${loan.lenderName ? ` from ${loan.lenderName}` : ''}.`, {
        id: loan.id,
      });
    },
  },
  {
    name: 'update_investment',
    description:
      'Edit a holding: change its quantity, average buy price, name or asset type. Recalculates the portfolio cost basis.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        reference: { type: SchemaType.STRING, description: 'Symbol, name or id of the holding (required)' },
        quantity: { type: SchemaType.NUMBER },
        averageBuyPrice: { type: SchemaType.NUMBER, description: 'Price per unit' },
        name: { type: SchemaType.STRING },
        assetType: { type: SchemaType.STRING, description: 'STOCK, MUTUAL_FUND, SIP, GOLD, SILVER, FIXED_DEPOSIT, CRYPTO, BOND, ETF or OTHER' },
      },
      required: ['reference'],
    },
    execute: async (userId, a) => {
      const holding = await pickInvestment(userId, a.reference);
      if (!holding) return fail('No matching holding found.');
      const quantity = a.quantity != null ? num(a.quantity) : num(holding.quantity);
      if (!(quantity > 0)) return fail('Quantity must be positive — use delete_investment to remove a holding.');
      const price = a.averageBuyPrice != null ? num(a.averageBuyPrice) : num(holding.averageBuyPrice);

      const portfolio = await prisma.$transaction(async (tx) => {
        await tx.investment.update({
          where: { id: holding.id },
          data: {
            quantity,
            averageBuyPrice: price,
            ...(a.name !== undefined && { name: a.name || holding.symbol }),
            ...(a.assetType !== undefined && { assetType: oneOf(a.assetType, ASSET_TYPES, holding.assetType) }),
          },
        });
        return refreshPortfolio(tx, holding.portfolioId);
      });

      emit(userId, 'update_investment', 'investment', { id: holding.id });
      return ok(
        `Updated ${holding.symbol}: ${quantity} units @ avg ${inr(price)} = ${inr(quantity * price)}. Portfolio cost basis ${inr(
          portfolio.totalInvested
        )}.`,
        {
          id: holding.id,
          symbol: holding.symbol,
          quantity,
          averageBuyPrice: price,
          portfolioCostBasis: num(portfolio.totalInvested),
        }
      );
    },
  },
  {
    name: 'delete_investment',
    description: 'Remove a holding from the portfolio entirely and recalculate the cost basis.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { reference: { type: SchemaType.STRING, description: 'Symbol, name or id of the holding (required)' } },
      required: ['reference'],
    },
    execute: async (userId, a) => {
      const holding = await pickInvestment(userId, a.reference);
      if (!holding) return fail('No matching holding found.');
      const portfolio = await prisma.$transaction(async (tx) => {
        await tx.investment.delete({ where: { id: holding.id } });
        return refreshPortfolio(tx, holding.portfolioId);
      });
      emit(userId, 'delete_investment', 'investment', { symbol: holding.symbol });
      return ok(`Removed ${holding.symbol} from the portfolio. Cost basis is now ${inr(portfolio.totalInvested)}.`, {
        symbol: holding.symbol,
        portfolioCostBasis: num(portfolio.totalInvested),
      });
    },
  },
  {
    name: 'list_insurance',
    description: "List the user's insurance policies with coverage, premium and renewal date.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
    execute: async (userId) => {
      const policies = await prisma.insurancePolicy.findMany({
        where: { userId },
        orderBy: { renewalDate: 'asc' },
      });
      if (!policies.length) return ok('No insurance policies on file.', { count: 0, policies: [] });
      const totalCover = policies.reduce((s, p) => s + num(p.coverageAmount), 0);
      const totalPremium = policies.reduce((s, p) => s + num(p.premium), 0);
      return ok(
        `${policies.length} policies | total cover ${inr(totalCover)} | total premium ${inr(totalPremium)}: ` +
          policies
            .map(
              (p) =>
                `${p.policyName} (${p.policyType}${p.insurer ? `, ${p.insurer}` : ''}) — cover ${inr(
                  p.coverageAmount
                )}, renews ${ymd(p.renewalDate)}`
            )
            .join('; '),
        {
          count: policies.length,
          totalCoverage: totalCover,
          totalPremium,
          policies: policies.map((p) => ({
            id: p.id,
            policyName: p.policyName,
            policyType: p.policyType,
            coverageAmount: num(p.coverageAmount),
            premium: num(p.premium),
            renewalDate: ymd(p.renewalDate),
          })),
        }
      );
    },
  },
  {
    name: 'create_insurance',
    description: 'Add an insurance policy (life, health, vehicle, home, travel…).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        policyName: { type: SchemaType.STRING },
        insurer: { type: SchemaType.STRING },
        policyType: { type: SchemaType.STRING, description: 'e.g. LIFE, TERM, HEALTH, VEHICLE, HOME, TRAVEL' },
        coverageAmount: { type: SchemaType.NUMBER },
        premium: { type: SchemaType.NUMBER },
        premiumCycle: { type: SchemaType.STRING, description: 'MONTHLY, QUARTERLY or ANNUAL' },
        renewalDate: { type: SchemaType.STRING },
        policyNumber: { type: SchemaType.STRING },
        beneficiary: { type: SchemaType.STRING },
      },
      required: ['policyName', 'coverageAmount', 'premium', 'renewalDate'],
    },
    execute: async (userId, a) => {
      const policy = await prisma.insurancePolicy.create({
        data: {
          userId,
          policyName: String(a.policyName).trim(),
          insurer: a.insurer || null,
          policyType: a.policyType ? String(a.policyType).toUpperCase() : 'LIFE',
          coverageAmount: num(a.coverageAmount),
          premium: num(a.premium),
          premiumCycle: a.premiumCycle ? String(a.premiumCycle).toUpperCase() : 'ANNUAL',
          renewalDate: toDate(a.renewalDate),
          policyNumber: a.policyNumber || null,
          beneficiary: a.beneficiary || null,
        },
      });
      emit(userId, 'create_insurance', 'insurance', { id: policy.id });
      return ok(
        `Added ${policy.policyName} (${policy.policyType}) — cover ${inr(policy.coverageAmount)}, premium ${inr(
          policy.premium
        )}/${policy.premiumCycle}, renews ${ymd(policy.renewalDate)}.`,
        { id: policy.id, policyName: policy.policyName }
      );
    },
  },
  {
    name: 'update_insurance',
    description: 'Edit an insurance policy: name, insurer, type, coverage, premium, renewal date, beneficiary or active status.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        policy: { type: SchemaType.STRING, description: 'Policy name, insurer or id (defaults to next renewal)' },
        policyName: { type: SchemaType.STRING },
        insurer: { type: SchemaType.STRING },
        policyType: { type: SchemaType.STRING },
        coverageAmount: { type: SchemaType.NUMBER },
        premium: { type: SchemaType.NUMBER },
        premiumCycle: { type: SchemaType.STRING, description: 'MONTHLY, QUARTERLY or ANNUAL' },
        renewalDate: { type: SchemaType.STRING },
        beneficiary: { type: SchemaType.STRING },
        isActive: { type: SchemaType.BOOLEAN },
      },
      required: ['policy'],
    },
    execute: async (userId, a) => {
      const policy = await pickInsurance(userId, a.policy);
      if (!policy) return fail('No matching insurance policy found.');
      const updated = await prisma.insurancePolicy.update({
        where: { id: policy.id },
        data: {
          ...(a.policyName !== undefined && { policyName: String(a.policyName).trim() }),
          ...(a.insurer !== undefined && { insurer: a.insurer || null }),
          ...(a.policyType !== undefined && { policyType: String(a.policyType).toUpperCase() }),
          ...(a.coverageAmount != null && { coverageAmount: num(a.coverageAmount) }),
          ...(a.premium != null && { premium: num(a.premium) }),
          ...(a.premiumCycle !== undefined && { premiumCycle: String(a.premiumCycle).toUpperCase() }),
          ...(a.renewalDate !== undefined && { renewalDate: toDate(a.renewalDate) }),
          ...(a.beneficiary !== undefined && { beneficiary: a.beneficiary || null }),
          ...(a.isActive !== undefined && { isActive: !!a.isActive }),
        },
      });
      emit(userId, 'update_insurance', 'insurance', { id: updated.id });
      return ok(
        `Updated ${updated.policyName} — cover ${inr(updated.coverageAmount)}, premium ${inr(updated.premium)}, renews ${ymd(
          updated.renewalDate
        )}.`,
        { id: updated.id, policyName: updated.policyName }
      );
    },
  },
  {
    name: 'delete_insurance',
    description: 'Delete an insurance policy record.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { policy: { type: SchemaType.STRING, description: 'Policy name, insurer or id (required)' } },
      required: ['policy'],
    },
    execute: async (userId, a) => {
      const ref = String(a.policy || '').trim();
      if (!ref) return fail('Specify which policy to delete.');
      const policy = await prisma.insurancePolicy.findFirst({
        where: {
          userId,
          OR: [
            { id: ref },
            { policyName: { contains: ref, mode: 'insensitive' } },
            { insurer: { contains: ref, mode: 'insensitive' } },
          ],
        },
        orderBy: { renewalDate: 'asc' },
      });
      if (!policy) return fail('No matching insurance policy found.');
      await prisma.insurancePolicy.delete({ where: { id: policy.id } });
      emit(userId, 'delete_insurance', 'insurance', {});
      return ok(`Deleted the ${policy.policyName} policy.`, { id: policy.id });
    },
  },
  {
    name: 'update_subscription',
    description: 'Edit a tracked subscription: service, cost, billing cycle, next billing date, category or active status.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        subscription: { type: SchemaType.STRING, description: 'Service name or id (defaults to next renewal)' },
        serviceName: { type: SchemaType.STRING },
        cost: { type: SchemaType.NUMBER },
        billingCycle: { type: SchemaType.STRING, description: 'MONTHLY, QUARTERLY or YEARLY' },
        nextBillingDate: { type: SchemaType.STRING },
        category: { type: SchemaType.STRING },
        isActive: { type: SchemaType.BOOLEAN },
      },
      required: ['subscription'],
    },
    execute: async (userId, a) => {
      const sub = await pickSubscription(userId, a.subscription);
      if (!sub) return fail('No matching subscription found.');
      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          ...(a.serviceName !== undefined && { serviceName: String(a.serviceName).trim() }),
          ...(a.cost != null && { cost: num(a.cost) }),
          ...(a.billingCycle !== undefined && { billingCycle: String(a.billingCycle).toUpperCase() }),
          ...(a.nextBillingDate !== undefined && { nextBillingDate: toDate(a.nextBillingDate) }),
          ...(a.category !== undefined && { category: a.category || null }),
          ...(a.isActive !== undefined && { isActive: !!a.isActive }),
        },
      });
      emit(userId, 'update_subscription', 'subscription', { id: updated.id });
      return ok(
        `Updated ${updated.serviceName} — ${inr(updated.cost)}/${updated.billingCycle}, next ${ymd(updated.nextBillingDate)}.`,
        { id: updated.id, serviceName: updated.serviceName }
      );
    },
  },
  {
    name: 'delete_subscription',
    description: 'Delete a tracked subscription.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { subscription: { type: SchemaType.STRING, description: 'Service name or id (required)' } },
      required: ['subscription'],
    },
    execute: async (userId, a) => {
      const ref = String(a.subscription || '').trim();
      if (!ref) return fail('Specify which subscription to delete.');
      const sub = await prisma.subscription.findFirst({
        where: { userId, OR: [{ id: ref }, { serviceName: { contains: ref, mode: 'insensitive' } }] },
        orderBy: { nextBillingDate: 'asc' },
      });
      if (!sub) return fail('No matching subscription found.');
      await prisma.subscription.delete({ where: { id: sub.id } });
      emit(userId, 'delete_subscription', 'subscription', {});
      return ok(`Deleted the ${sub.serviceName} subscription.`, { id: sub.id });
    },
  },
  {
    name: 'list_reminders',
    description: 'List calendar events / reminders with their dates and amounts.',
    parameters: { type: SchemaType.OBJECT, properties: {} },
    execute: async (userId) => {
      const events = await prisma.calendarEvent.findMany({
        where: { userId },
        orderBy: { eventDate: 'asc' },
        take: 20,
      });
      if (!events.length) return ok('No calendar reminders yet.', { count: 0, events: [] });
      return ok(
        `${events.length} reminders: ` +
          events
            .map(
              (e) =>
                `${e.title} (${e.eventType}) on ${ymd(e.eventDate)}${e.amount != null ? ` — ${inr(e.amount)}` : ''}`
            )
            .join('; '),
        {
          count: events.length,
          events: events.map((e) => ({
            id: e.id,
            title: e.title,
            eventType: e.eventType,
            eventDate: ymd(e.eventDate),
            amount: e.amount != null ? num(e.amount) : null,
          })),
        }
      );
    },
  },
  {
    name: 'update_reminder',
    description: 'Edit a calendar event / reminder: title, date, type, description or amount.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        reminder: { type: SchemaType.STRING, description: 'Event title or id (defaults to next upcoming)' },
        title: { type: SchemaType.STRING },
        eventDate: { type: SchemaType.STRING },
        eventType: { type: SchemaType.STRING, description: 'e.g. EMI, BILL, INVESTMENT, CUSTOM' },
        description: { type: SchemaType.STRING },
        amount: { type: SchemaType.NUMBER },
      },
      required: ['reminder'],
    },
    execute: async (userId, a) => {
      const event = await pickCalendarEvent(userId, a.reminder);
      if (!event) return fail('No matching reminder found.');
      const updated = await prisma.calendarEvent.update({
        where: { id: event.id },
        data: {
          ...(a.title !== undefined && { title: String(a.title).trim() }),
          ...(a.eventDate !== undefined && { eventDate: toDate(a.eventDate) }),
          ...(a.eventType !== undefined && { eventType: String(a.eventType).toUpperCase() }),
          ...(a.description !== undefined && { description: a.description || null }),
          ...(a.amount !== undefined && { amount: a.amount != null ? num(a.amount) : null }),
        },
      });
      emit(userId, 'update_reminder', 'calendar', { id: updated.id });
      return ok(`Updated reminder "${updated.title}" — ${ymd(updated.eventDate)}.`, {
        id: updated.id,
        title: updated.title,
        eventDate: ymd(updated.eventDate),
      });
    },
  },
  {
    name: 'delete_reminder',
    description: 'Delete a calendar event / reminder.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { reminder: { type: SchemaType.STRING, description: 'Event title or id (required)' } },
      required: ['reminder'],
    },
    execute: async (userId, a) => {
      const ref = String(a.reminder || '').trim();
      if (!ref) return fail('Specify which reminder to delete.');
      const event = await prisma.calendarEvent.findFirst({
        where: { userId, OR: [{ id: ref }, { title: { contains: ref, mode: 'insensitive' } }] },
        orderBy: { eventDate: 'asc' },
      });
      if (!event) return fail('No matching reminder found.');
      await prisma.calendarEvent.delete({ where: { id: event.id } });
      emit(userId, 'delete_reminder', 'calendar', {});
      return ok(`Deleted reminder "${event.title}".`, { id: event.id });
    },
  },
  {
    name: 'update_card',
    description: 'Edit a card: nickname, issuer, credit limit, outstanding, minimum due, billing cycle day, due date or active status.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        card: { type: SchemaType.STRING, description: 'Card nickname, issuer or id (defaults to latest card)' },
        cardNickname: { type: SchemaType.STRING },
        issuer: { type: SchemaType.STRING },
        creditLimit: { type: SchemaType.NUMBER },
        outstandingAmount: { type: SchemaType.NUMBER },
        minimumDue: { type: SchemaType.NUMBER },
        billingCycleDay: { type: SchemaType.NUMBER, description: 'Day of month, 1-31' },
        dueDate: { type: SchemaType.STRING },
        isActive: { type: SchemaType.BOOLEAN },
      },
      required: ['card'],
    },
    execute: async (userId, a) => {
      const card = await pickCard(userId, a.card);
      if (!card) return fail('No card found.');
      const updated = await prisma.card.update({
        where: { id: card.id },
        data: {
          ...(a.cardNickname !== undefined && { cardNickname: String(a.cardNickname).trim() }),
          ...(a.issuer !== undefined && { issuer: String(a.issuer).trim() }),
          ...(a.creditLimit !== undefined && { creditLimit: a.creditLimit != null ? num(a.creditLimit) : null }),
          ...(a.outstandingAmount != null && { outstandingAmount: num(a.outstandingAmount) }),
          ...(a.minimumDue !== undefined && { minimumDue: a.minimumDue != null ? num(a.minimumDue) : null }),
          ...(a.billingCycleDay !== undefined && {
            billingCycleDay: a.billingCycleDay != null ? Math.max(1, Math.min(31, Math.round(num(a.billingCycleDay)))) : null,
          }),
          ...(a.dueDate !== undefined && { dueDate: a.dueDate ? toDate(a.dueDate) : null }),
          ...(a.isActive !== undefined && { isActive: !!a.isActive }),
        },
      });
      emit(userId, 'update_card', 'card', { id: updated.id });
      return ok(
        `Updated ${updated.cardNickname} (${updated.issuer} ****${updated.lastFourDigits}) — outstanding ${inr(
          updated.outstandingAmount
        )}.`,
        { id: updated.id, cardNickname: updated.cardNickname, outstandingAmount: num(updated.outstandingAmount) }
      );
    },
  },
  {
    name: 'delete_card',
    description: 'Remove a card record. Requires the card nickname, issuer or id.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { card: { type: SchemaType.STRING, description: 'Card nickname, issuer or id (required)' } },
      required: ['card'],
    },
    execute: async (userId, a) => {
      const ref = String(a.card || '').trim();
      if (!ref) return fail('Specify which card to delete.');
      const card = await prisma.card.findFirst({
        where: {
          userId,
          OR: [
            { id: ref },
            { cardNickname: { contains: ref, mode: 'insensitive' } },
            { issuer: { contains: ref, mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!card) return fail('No matching card found.');
      await prisma.card.delete({ where: { id: card.id } });
      emit(userId, 'delete_card', 'card', {});
      return ok(`Deleted card ${card.cardNickname} (${card.issuer} ****${card.lastFourDigits}).`, { id: card.id });
    },
  },
  {
    name: 'update_task',
    description: 'Edit a financial task: title, due date, category, priority, notes or completed status.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        task: { type: SchemaType.STRING, description: 'Task title or id (defaults to next due task)' },
        title: { type: SchemaType.STRING },
        dueDate: { type: SchemaType.STRING },
        category: { type: SchemaType.STRING, description: 'EMI, CREDIT_CARD, SIP, INSURANCE, SUBSCRIPTION, TAX, BUDGET or GENERAL' },
        priority: { type: SchemaType.STRING, description: 'HIGH, MEDIUM or LOW' },
        notes: { type: SchemaType.STRING },
        isCompleted: { type: SchemaType.BOOLEAN },
      },
      required: ['task'],
    },
    execute: async (userId, a) => {
      const task = await pickTask(userId, a.task);
      if (!task) return fail('No matching task found.');
      const updated = await prisma.financialTask.update({
        where: { id: task.id },
        data: {
          ...(a.title !== undefined && { title: String(a.title).trim() }),
          ...(a.dueDate !== undefined && { dueDate: toDate(a.dueDate) }),
          ...(a.category !== undefined && { category: String(a.category).toUpperCase() }),
          ...(a.priority !== undefined && { priority: oneOf(a.priority, PRIORITIES, task.priority) }),
          ...(a.notes !== undefined && { notes: a.notes || null }),
          ...(a.isCompleted !== undefined && {
            isCompleted: !!a.isCompleted,
            completedAt: a.isCompleted ? new Date() : null,
          }),
        },
      });
      emit(userId, 'update_task', 'task', { id: updated.id });
      return ok(
        `Updated task "${updated.title}" (${updated.isCompleted ? 'completed' : 'pending'}) due ${ymd(updated.dueDate)}.`,
        { id: updated.id, title: updated.title, isCompleted: updated.isCompleted }
      );
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a financial task.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { task: { type: SchemaType.STRING, description: 'Task title or id (required)' } },
      required: ['task'],
    },
    execute: async (userId, a) => {
      const ref = String(a.task || '').trim();
      if (!ref) return fail('Specify which task to delete.');
      const task = await prisma.financialTask.findFirst({
        where: { userId, OR: [{ id: ref }, { title: { contains: ref, mode: 'insensitive' } }] },
        orderBy: { dueDate: 'asc' },
      });
      if (!task) return fail('No matching task found.');
      await prisma.financialTask.delete({ where: { id: task.id } });
      emit(userId, 'delete_task', 'task', {});
      return ok(`Deleted task "${task.title}".`, { id: task.id });
    },
  },
  {
    name: 'update_profile',
    description:
      "Update the user's own profile: name, currency, risk profile, budget method, age, city, salary or monthly expenses.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        firstName: { type: SchemaType.STRING },
        lastName: { type: SchemaType.STRING },
        currency: { type: SchemaType.STRING, description: 'e.g. INR, USD' },
        riskProfile: { type: SchemaType.STRING, description: 'CONSERVATIVE, MODERATE or AGGRESSIVE' },
        budgetMethod: { type: SchemaType.STRING, description: 'FIFTY_THIRTY_TWENTY, ZERO_BASED or CUSTOM' },
        age: { type: SchemaType.NUMBER },
        city: { type: SchemaType.STRING },
        monthlySalary: { type: SchemaType.NUMBER },
        estimatedMonthlyExpenses: { type: SchemaType.NUMBER },
      },
    },
    execute: async (userId, a) => {
      const userFields = {};
      if (a.firstName !== undefined) userFields.firstName = String(a.firstName).trim();
      if (a.lastName !== undefined) userFields.lastName = String(a.lastName).trim();
      if (a.currency !== undefined) userFields.currency = String(a.currency).toUpperCase();

      const fpFields = {};
      if (a.riskProfile !== undefined)
        fpFields.riskProfile = oneOf(a.riskProfile, ['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'], 'MODERATE');
      if (a.budgetMethod !== undefined)
        fpFields.budgetMethod = oneOf(
          a.budgetMethod,
          ['FIFTY_THIRTY_TWENTY', 'ZERO_BASED', 'CUSTOM'],
          'FIFTY_THIRTY_TWENTY'
        );
      if (a.age != null) fpFields.age = Math.max(18, Math.round(num(a.age)));
      if (a.city !== undefined) fpFields.city = String(a.city).trim();
      if (a.monthlySalary != null) fpFields.monthlySalary = num(a.monthlySalary);
      if (a.estimatedMonthlyExpenses != null) fpFields.estimatedMonthlyExpenses = num(a.estimatedMonthlyExpenses);

      if (!Object.keys(userFields).length && !Object.keys(fpFields).length) {
        return fail('Nothing to update — provide at least one field.');
      }

      await prisma.$transaction(async (tx) => {
        if (Object.keys(userFields).length) {
          await tx.user.update({ where: { id: userId }, data: userFields });
        }
        if (Object.keys(fpFields).length) {
          await tx.financialProfile.upsert({
            where: { userId },
            create: { userId, ...fpFields },
            update: fpFields,
          });
        }
      });

      emit(userId, 'update_profile', 'profile', {});
      const parts = [];
      if (userFields.firstName !== undefined || userFields.lastName !== undefined) {
        parts.push(`name ${[a.firstName, a.lastName].filter(Boolean).join(' ')}`.trim());
      }
      if (userFields.currency) parts.push(`currency ${userFields.currency}`);
      if (fpFields.riskProfile) parts.push(`risk ${fpFields.riskProfile}`);
      if (fpFields.budgetMethod) parts.push(`budget method ${fpFields.budgetMethod}`);
      return ok(`Updated your profile${parts.length ? ` — ${parts.join(', ')}` : ''}.`, {
        updated: { ...userFields, ...fpFields },
      });
    },
  },
  {
    name: 'list_categories',
    description: "List the spending and income categories available (shared system ones plus the user's own).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: { type: { type: SchemaType.STRING, description: 'Optional filter: INCOME, EXPENSE or TRANSFER' } },
    },
    execute: async (userId, a) => {
      const where = { OR: [{ userId }, { userId: null }] };
      const type = a.type ? oneOf(a.type, ['INCOME', 'EXPENSE', 'TRANSFER'], null) : null;
      if (type) where.categoryType = type;
      const cats = await prisma.category.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
      if (!cats.length) return ok('No categories found.', { count: 0, categories: [] });
      return ok(`${cats.length} categories: ${cats.map((c) => c.name).join(', ')}`, {
        count: cats.length,
        categories: cats.map((c) => ({
          id: c.id,
          name: c.name,
          categoryType: c.categoryType,
          isSystem: c.userId === null,
        })),
      });
    },
  },
  {
    name: 'create_category',
    description: 'Create a new custom category for classifying transactions and budgets.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: { type: SchemaType.STRING },
        categoryType: { type: SchemaType.STRING, description: 'INCOME, EXPENSE or TRANSFER (default EXPENSE)' },
        icon: { type: SchemaType.STRING },
        color: { type: SchemaType.STRING },
      },
      required: ['name'],
    },
    execute: async (userId, a) => {
      const clean = String(a.name || '').trim();
      if (!clean) return fail('Category name is required.');
      const existing = await prisma.category.findFirst({
        where: { userId, name: { equals: clean, mode: 'insensitive' } },
      });
      if (existing) return ok(`You already have a category "${existing.name}".`, { id: existing.id, existing: true });
      const cat = await prisma.category.create({
        data: {
          userId,
          name: clean,
          categoryType: oneOf(a.categoryType, ['INCOME', 'EXPENSE', 'TRANSFER'], 'EXPENSE'),
          icon: a.icon || null,
          color: a.color || null,
        },
      });
      emit(userId, 'create_category', 'category', { id: cat.id });
      return ok(`Created ${cat.categoryType} category "${cat.name}".`, {
        id: cat.id,
        name: cat.name,
        categoryType: cat.categoryType,
      });
    },
  },
  {
    name: 'update_category',
    description: "Rename or restyle one of the user's own categories. Shared system categories cannot be edited.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        category: { type: SchemaType.STRING, description: 'Category name or id (required)' },
        name: { type: SchemaType.STRING },
        categoryType: { type: SchemaType.STRING, description: 'INCOME, EXPENSE or TRANSFER' },
        icon: { type: SchemaType.STRING },
        color: { type: SchemaType.STRING },
      },
      required: ['category'],
    },
    execute: async (userId, a) => {
      const cat = await prisma.category.findFirst({
        where: {
          userId,
          OR: [{ id: String(a.category) }, { name: { equals: String(a.category), mode: 'insensitive' } }],
        },
      });
      if (!cat) return fail('No editable category found (shared system categories cannot be changed).');
      const updated = await prisma.category.update({
        where: { id: cat.id },
        data: {
          ...(a.name !== undefined && { name: String(a.name).trim() }),
          ...(a.categoryType !== undefined && {
            categoryType: oneOf(a.categoryType, ['INCOME', 'EXPENSE', 'TRANSFER'], cat.categoryType),
          }),
          ...(a.icon !== undefined && { icon: a.icon || null }),
          ...(a.color !== undefined && { color: a.color || null }),
        },
      });
      emit(userId, 'update_category', 'category', { id: updated.id });
      return ok(`Updated category "${updated.name}" (${updated.categoryType}).`, {
        id: updated.id,
        name: updated.name,
      });
    },
  },
  {
    name: 'delete_category',
    description:
      "Delete one of the user's own categories. Transactions keep their history but lose the category link. Shared system categories cannot be deleted.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: { category: { type: SchemaType.STRING, description: 'Category name or id (required)' } },
      required: ['category'],
    },
    execute: async (userId, a) => {
      const cat = await prisma.category.findFirst({
        where: {
          userId,
          OR: [{ id: String(a.category) }, { name: { equals: String(a.category), mode: 'insensitive' } }],
        },
      });
      if (!cat) return fail('No editable category found (shared system categories cannot be deleted).');
      const usage = await prisma.transaction.count({ where: { categoryId: cat.id } });
      await prisma.category.delete({ where: { id: cat.id } });
      emit(userId, 'delete_category', 'category', {});
      return ok(
        `Deleted category "${cat.name}"${
          usage ? ` and unlinked ${usage} transaction(s) (their history is kept)` : ''
        }.`,
        { id: cat.id, unlinkedTransactions: usage }
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
