const prisma = require('../config/database');
const storageService = require('../services/storageService');
const { formatDateOnly, todayDateOnly } = require('../utils/dateOnly');

/**
 * Helper to either stream CSV directly to client or save to cloud/local object storage.
 */
const sendOrStoreExport = async (req, res, { filename, csvContent, exportType }) => {
  if (req.query.storage === 'true' || req.query.store === 'true') {
    const userId = req.user?.id || 'public';
    const storageKey = `exports/${userId}/${filename}`;
    const stored = await storageService.upload({
      buffer: Buffer.from('\uFEFF' + csvContent, 'utf8'),
      key: storageKey,
      contentType: 'text/csv; charset=utf-8',
      metadata: { userId, exportType, generatedAt: new Date().toISOString() },
    });

    // Also track in ExportJob if user is authenticated
    if (req.user?.id) {
      try {
        await prisma.exportJob.create({
          data: {
            userId: req.user.id,
            exportType,
            status: 'completed',
            filePath: stored.key,
          },
        });
      } catch (dbErr) {
        console.warn('[Export] Notice creating export job log:', dbErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: `${exportType} export successfully saved to ${stored.provider} object storage.`,
      data: stored,
    });
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send('\uFEFF' + csvContent); // BOM for proper Excel display
};

/**
 * GET /api/v1/export/transactions.csv
 * Export user's transactions as CSV (only their own data)
 */
const exportTransactionsCSV = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      include: {
        category: { select: { name: true } },
        account: { select: { name: true } },
        toAccount: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
    });

    const rows = [
      ['Date', 'Type', 'Amount (INR)', 'Category', 'Account', 'To Account', 'Description', 'Merchant', 'Payment Method'],
      ...transactions.map(t => [
        formatDateOnly(t.date),
        t.transactionType,
        parseFloat(t.amount).toFixed(2),
        t.category?.name || 'Uncategorized',
        t.account?.name || 'Unknown',
        t.toAccount?.name || '',
        t.description || '',
        t.merchant || '',
        t.paymentMethod || '',
      ]),
    ];

    const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const filename = `jinay_finance_transactions_${todayDateOnly()}.csv`;
    return sendOrStoreExport(req, res, { filename, csvContent, exportType: 'transactions' });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/export/accounts.csv
 */
const exportAccountsCSV = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const accounts = await prisma.financialAccount.findMany({
      where: { userId, isActive: true },
    });

    const rows = [
      ['Account Name', 'Type', 'Institution', 'Balance (INR)', 'Currency'],
      ...accounts.map(a => [a.name, a.accountType, a.institution || '', parseFloat(a.balance).toFixed(2), a.currency]),
    ];

    const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const filename = `jinay_finance_accounts_${todayDateOnly()}.csv`;
    return sendOrStoreExport(req, res, { filename, csvContent, exportType: 'accounts' });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/export/budgets.csv
 */
const exportBudgetsCSV = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const budgets = await prisma.budget.findMany({
      where: { userId },
      include: { category: { select: { name: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    const rows = [
      ['Category', 'Month', 'Year', 'Monthly Limit (INR)'],
      ...budgets.map(b => [b.category?.name || b.categoryName, b.month, b.year, parseFloat(b.monthlyLimit).toFixed(2)]),
    ];

    const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const filename = `jinay_finance_budgets_${todayDateOnly()}.csv`;
    return sendOrStoreExport(req, res, { filename, csvContent, exportType: 'budgets' });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/export/goals.csv
 */
const exportGoalsCSV = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const goals = await prisma.goal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });

    const rows = [
      ['Goal Name', 'Type', 'Target Amount (INR)', 'Current Amount (INR)', 'Progress (%)', 'Target Date', 'Status'],
      ...goals.map(g => {
        const target = parseFloat(g.targetAmount);
        const current = parseFloat(g.currentAmount);
        const pct = target > 0 ? `${Math.round((current / target) * 100)}%` : '0%';
        return [g.name, g.goalType, target.toFixed(2), current.toFixed(2), pct, formatDateOnly(g.targetDate) || '', g.status];
      }),
    ];

    const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const filename = `jinay_finance_goals_${todayDateOnly()}.csv`;
    return sendOrStoreExport(req, res, { filename, csvContent, exportType: 'goals' });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/export/investments.csv
 */
const exportInvestmentsCSV = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const portfolio = await prisma.portfolio.findUnique({
      where: { userId },
      include: { investments: true },
    });

    const rows = [
      ['Symbol', 'Name', 'Asset Type', 'Quantity', 'Avg Buy Price (INR)', 'Total Invested (INR)'],
      ...(portfolio?.investments || []).map(inv => {
        const qty = parseFloat(inv.quantity);
        const price = parseFloat(inv.averageBuyPrice);
        return [inv.symbol, inv.name, inv.assetType, qty, price.toFixed(2), (qty * price).toFixed(2)];
      }),
    ];

    const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const filename = `jinay_finance_investments_${todayDateOnly()}.csv`;
    return sendOrStoreExport(req, res, { filename, csvContent, exportType: 'investments' });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/export/summary.csv
 */
const exportSummaryCSV = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [accounts, goals, loans, portfolio] = await Promise.all([
      prisma.financialAccount.aggregate({ where: { userId, isActive: true }, _sum: { balance: true } }),
      prisma.goal.findMany({ where: { userId } }),
      prisma.loan.aggregate({ where: { userId, status: 'ACTIVE' }, _sum: { outstandingBalance: true, emiAmount: true } }),
      prisma.portfolio.findUnique({ where: { userId }, select: { totalInvested: true, currentValue: true } }),
    ]);

    const totalBalance = parseFloat(accounts._sum.balance || 0);
    const totalDebt = parseFloat(loans._sum.outstandingBalance || 0);
    const investmentValue = parseFloat(portfolio?.currentValue || 0);
    const netWorth = totalBalance + investmentValue - totalDebt;

    const rows = [
      ['Summary Report - FinPro'],
      ['Generated', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
      [],
      ['Metric', 'Value (INR)'],
      ['Total Bank Balance', totalBalance.toFixed(2)],
      ['Investment Portfolio Value', investmentValue.toFixed(2)],
      ['Total Outstanding Loans', totalDebt.toFixed(2)],
      ['Monthly EMI', parseFloat(loans._sum.emiAmount || 0).toFixed(2)],
      ['Net Worth', netWorth.toFixed(2)],
      [],
      ['Goals', 'Target', 'Current', 'Progress'],
      ...goals.map(g => [g.name, parseFloat(g.targetAmount).toFixed(2), parseFloat(g.currentAmount).toFixed(2), `${Math.round((parseFloat(g.currentAmount) / parseFloat(g.targetAmount)) * 100)}%`]),
    ];

    const csvContent = rows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const filename = `jinay_finance_summary_${todayDateOnly()}.csv`;
    return sendOrStoreExport(req, res, { filename, csvContent, exportType: 'summary' });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/export/loans.csv
 */
const exportLoansCSV = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const loans = await prisma.loan.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });

    const rows = [
      ['Lender', 'Loan Type', 'Principal Amount (INR)', 'Interest Rate (%)', 'Tenure (Months)', 'EMI Amount (INR)', 'Outstanding (INR)', 'Status'],
      ...loans.map(l => [
        l.lenderName || 'N/A',
        l.loanType,
        parseFloat(l.principalAmount).toFixed(2),
        parseFloat(l.interestRate).toFixed(2),
        l.tenureMonths,
        l.emiAmount ? parseFloat(l.emiAmount).toFixed(2) : '0.00',
        parseFloat(l.outstandingBalance).toFixed(2),
        l.status,
      ]),
    ];

    const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const filename = `jinay_finance_loans_${todayDateOnly()}.csv`;
    return sendOrStoreExport(req, res, { filename, csvContent, exportType: 'loans' });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/export/insurance.csv
 */
const exportInsuranceCSV = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const policies = await prisma.insurancePolicy.findMany({ where: { userId }, orderBy: { renewalDate: 'asc' } });

    const rows = [
      ['Policy Name', 'Insurer', 'Policy Type', 'Coverage (INR)', 'Premium (INR)', 'Premium Cycle', 'Renewal Date', 'Status'],
      ...policies.map(p => [
        p.policyName,
        p.insurer || 'N/A',
        p.policyType,
        parseFloat(p.coverageAmount).toFixed(2),
        parseFloat(p.premium).toFixed(2),
        p.premiumCycle,
        formatDateOnly(p.renewalDate),
        p.isActive ? 'ACTIVE' : 'INACTIVE',
      ]),
    ];

    const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const filename = `jinay_finance_insurance_${todayDateOnly()}.csv`;
    return sendOrStoreExport(req, res, { filename, csvContent, exportType: 'insurance' });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/export/subscriptions.csv
 */
const exportSubscriptionsCSV = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const subs = await prisma.subscription.findMany({ where: { userId }, orderBy: { nextBillingDate: 'asc' } });

    const rows = [
      ['Service Name', 'Category', 'Cost (INR)', 'Billing Cycle', 'Next Billing Date', 'Status'],
      ...subs.map(s => [
        s.serviceName,
        s.category || 'General',
        parseFloat(s.cost).toFixed(2),
        s.billingCycle,
        formatDateOnly(s.nextBillingDate),
        s.isActive ? 'ACTIVE' : 'PAUSED',
      ]),
    ];

    const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const filename = `jinay_finance_subscriptions_${todayDateOnly()}.csv`;
    return sendOrStoreExport(req, res, { filename, csvContent, exportType: 'subscriptions' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  exportTransactionsCSV,
  exportAccountsCSV,
  exportBudgetsCSV,
  exportGoalsCSV,
  exportInvestmentsCSV,
  exportLoansCSV,
  exportInsuranceCSV,
  exportSubscriptionsCSV,
  exportSummaryCSV,
};
