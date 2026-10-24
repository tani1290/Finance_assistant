const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const analyticsEngine = require('./analyticsEngine');

/**
 * Financial Twin & Predictive Intelligence Service
 * Owner: Jinay Golecha (jinay_golecha)
 */

/**
 * Calculate 10-Factor AI Financial Health Score with Explainability & History
 */
const calculateDetailedHealthScore = async (userId) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [
    accounts,
    monthlyIncomeAgg,
    monthlyExpenseAgg,
    allIncomeAgg,
    allExpenseAgg,
    loans,
    portfolio,
    goals,
    insurancePolicies,
    subscriptions,
    financialProfile,
  ] = await Promise.all([
    prisma.financialAccount.findMany({ where: { userId, isActive: true } }),
    prisma.transaction.aggregate({
      where: { userId, transactionType: 'INCOME', date: { gte: startOfMonth, lte: endOfMonth } },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ['transactionType'],
      where: { userId, transactionType: { in: analyticsEngine.SPENDING_TYPES }, date: { gte: startOfMonth, lte: endOfMonth } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, transactionType: 'INCOME' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.transaction.groupBy({
      by: ['transactionType'],
      where: { userId, transactionType: { in: analyticsEngine.SPENDING_TYPES } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.loan.findMany({ where: { userId, status: 'ACTIVE' } }),
    prisma.portfolio.findUnique({ where: { userId }, include: { investments: true } }),
    prisma.goal.findMany({ where: { userId, status: 'ACTIVE' } }),
    prisma.insurancePolicy.findMany({ where: { userId, isActive: true } }),
    prisma.subscription.findMany({ where: { userId, isActive: true } }),
    prisma.financialProfile.findUnique({ where: { userId } }),
  ]);

  const totalBankBalance = accounts.reduce((sum, a) => sum + parseFloat(a.balance), 0);
  const monthlyIncome = parseFloat(monthlyIncomeAgg._sum.amount || 0) || parseFloat(financialProfile?.monthlySalary || 0);
  const monthlyExpenses = analyticsEngine.signedTotal(monthlyExpenseAgg) || parseFloat(financialProfile?.estimatedMonthlyExpenses || 0);
  const totalDebt = loans.reduce((sum, l) => sum + parseFloat(l.outstandingBalance), 0);
  const monthlyEMI = loans.reduce((sum, l) => sum + parseFloat(l.emiAmount || 0), 0);
  const investmentValue = parseFloat(portfolio?.currentValue || 0) || (portfolio?.investments || []).reduce((sum, i) => sum + (parseFloat(i.quantity) * parseFloat(i.averageBuyPrice)), 0);
  const monthlySubscriptions = subscriptions.reduce((sum, s) => sum + (s.billingCycle === 'ANNUAL' ? parseFloat(s.cost) / 12 : parseFloat(s.cost)), 0);

  const positiveReasons = [];
  const attentionReasons = [];
  const recommendations = [];

  // Factor 1: Income Stability (Max 10)
  let incomeStabilityScore = 7;
  if (monthlyIncome > 50000) {
    incomeStabilityScore = 10;
    positiveReasons.push('Strong monthly income foundation');
  } else if (monthlyIncome > 0) {
    incomeStabilityScore = 8;
  } else {
    incomeStabilityScore = 3;
    attentionReasons.push('No steady monthly income recorded');
    recommendations.push('Record regular monthly income to establish cash-flow baseline.');
  }

  // Factor 2: Savings Rate (Max 15)
  let savingsScore = 5;
  const savingsRate = monthlyIncome > 0 ? (monthlyIncome - monthlyExpenses) / monthlyIncome : 0;
  if (savingsRate >= 0.3) {
    savingsScore = 15;
    positiveReasons.push(`Exceptional savings rate of ${Math.round(savingsRate * 100)}%`);
  } else if (savingsRate >= 0.2) {
    savingsScore = 12;
    positiveReasons.push(`Healthy savings rate of ${Math.round(savingsRate * 100)}% (meets 20% benchmark)`);
  } else if (savingsRate >= 0.1) {
    savingsScore = 8;
    attentionReasons.push(`Moderate savings rate of ${Math.round(savingsRate * 100)}%`);
    recommendations.push('Aim to increase savings rate towards 20% by curbing discretionary spending.');
  } else {
    savingsScore = 2;
    attentionReasons.push('Low or negative monthly savings rate');
    recommendations.push('Review monthly expenses against budget to prevent deficit.');
  }

  // Factor 3: Expense Ratio (Max 15)
  let expenseScore = 7;
  const expenseRatio = monthlyIncome > 0 ? monthlyExpenses / monthlyIncome : 1;
  if (expenseRatio <= 0.5) {
    expenseScore = 15;
    positiveReasons.push('Expenses well-controlled under 50% of income');
  } else if (expenseRatio <= 0.7) {
    expenseScore = 11;
  } else if (expenseRatio <= 0.9) {
    expenseScore = 6;
    attentionReasons.push('Expenses consume over 70% of monthly income');
  } else {
    expenseScore = 2;
    attentionReasons.push('High expense ratio; living paycheck-to-paycheck');
    recommendations.push('Create strict category budgets for shopping and dining out.');
  }

  // Factor 4: Debt-to-Income / DTI (Max 10)
  let dtiScore = 10;
  const monthlyDTI = monthlyIncome > 0 ? monthlyEMI / monthlyIncome : 0;
  if (totalDebt === 0) {
    dtiScore = 10;
    positiveReasons.push('Completely debt-free');
  } else if (monthlyDTI <= 0.2) {
    dtiScore = 8;
    positiveReasons.push(`Manageable debt-to-income ratio (${Math.round(monthlyDTI * 100)}%)`);
  } else if (monthlyDTI <= 0.4) {
    dtiScore = 5;
    attentionReasons.push(`Debt payments take ${Math.round(monthlyDTI * 100)}% of income`);
    recommendations.push('Consider loan prepayment to reduce ongoing EMI obligations.');
  } else {
    dtiScore = 1;
    attentionReasons.push(`High debt burden (${Math.round(monthlyDTI * 100)}% DTI)`);
    recommendations.push('Prioritize aggressive repayment of highest interest debt.');
  }

  // Factor 5: Emergency Fund (Max 15)
  let emergencyScore = 4;
  const monthsCovered = monthlyExpenses > 0 ? totalBankBalance / monthlyExpenses : totalBankBalance > 0 ? 6 : 0;
  if (monthsCovered >= 6) {
    emergencyScore = 15;
    positiveReasons.push(`Solid emergency runway of ${monthsCovered.toFixed(1)} months`);
  } else if (monthsCovered >= 3) {
    emergencyScore = 10;
    positiveReasons.push(`Adequate emergency buffer of ${monthsCovered.toFixed(1)} months`);
  } else if (monthsCovered >= 1) {
    emergencyScore = 5;
    attentionReasons.push(`Emergency fund only covers ${monthsCovered.toFixed(1)} months`);
    recommendations.push('Build emergency liquid reserves to cover at least 3–6 months of essential expenses.');
  } else {
    emergencyScore = 2;
    attentionReasons.push('Critically low emergency liquidity buffer');
    recommendations.push('Establish a dedicated Emergency Fund goal immediately.');
  }

  // Factor 6: Investment Diversification (Max 10)
  let investmentScore = 3;
  const holdings = portfolio?.investments || [];
  if (investmentValue > 0) {
    const assetTypes = new Set(holdings.map(h => h.assetType));
    if (assetTypes.size >= 3) {
      investmentScore = 10;
      positiveReasons.push('Well-diversified portfolio across multiple asset classes');
    } else if (assetTypes.size >= 1) {
      investmentScore = 7;
      positiveReasons.push('Active investment portfolio');
      recommendations.push('Diversify across equities, gold, and debt instruments to mitigate market volatility.');
    }
  } else {
    attentionReasons.push('No active investments recorded');
    recommendations.push('Start regular investments (SIP in index funds or gold) for long-term compounding.');
  }

  // Factor 7: Goal Progress (Max 10)
  let goalScore = 5;
  if (goals.length > 0) {
    const totalTarget = goals.reduce((s, g) => s + parseFloat(g.targetAmount), 0);
    const totalCurrent = goals.reduce((s, g) => s + parseFloat(g.currentAmount), 0);
    const progress = totalTarget > 0 ? totalCurrent / totalTarget : 0;
    if (progress >= 0.5) {
      goalScore = 10;
      positiveReasons.push(`Strong progress on financial goals (${Math.round(progress * 100)}%)`);
    } else {
      goalScore = 7;
      positiveReasons.push(`${goals.length} active financial goal(s) tracked`);
    }
  } else {
    goalScore = 3;
    recommendations.push('Define clear short-term and long-term financial goals.');
  }

  // Factor 8: Insurance Coverage (Max 5)
  let insuranceScore = 2;
  const lifeCover = insurancePolicies.filter(p => p.policyType === 'LIFE').reduce((s, p) => s + parseFloat(p.coverageAmount), 0);
  const healthCover = insurancePolicies.filter(p => p.policyType === 'HEALTH').reduce((s, p) => s + parseFloat(p.coverageAmount), 0);
  if (lifeCover > 0 && healthCover > 0) {
    insuranceScore = 5;
    positiveReasons.push('Both Life and Health insurance protections active');
  } else if (insurancePolicies.length > 0) {
    insuranceScore = 3;
    attentionReasons.push('Partial insurance protection; review term life or health gaps');
  } else {
    insuranceScore = 1;
    attentionReasons.push('No active insurance policies registered');
    recommendations.push('Secure comprehensive health insurance and term life cover for income protection.');
  }

  // Factor 9: Subscription Burden (Max 5)
  let subscriptionScore = 5;
  const subRatio = monthlyIncome > 0 ? monthlySubscriptions / monthlyIncome : 0;
  if (subRatio > 0.1) {
    subscriptionScore = 2;
    attentionReasons.push(`High recurring subscription cost (${formatINR(monthlySubscriptions)}/month)`);
    recommendations.push('Audit recurring subscriptions to eliminate redundant or unused services.');
  } else if (subRatio > 0.05) {
    subscriptionScore = 4;
  }

  // Factor 10: Cash Flow Stability (Max 5)
  let cashFlowScore = totalBankBalance > 5000 ? 5 : 2;

  const overallScore = Math.min(100, Math.max(0, 
    incomeStabilityScore +
    savingsScore +
    expenseScore +
    dtiScore +
    emergencyScore +
    investmentScore +
    goalScore +
    insuranceScore +
    subscriptionScore +
    cashFlowScore
  ));

  // Store in history
  const historyEntry = await prisma.financialHealthHistory.create({
    data: {
      userId,
      overallScore,
      savingsScore,
      debtScore: dtiScore,
      emergencyScore,
      investmentScore,
      goalScore,
      insuranceScore,
      cashFlowScore,
      subscriptionScore,
      dtiScore,
      incomeStabilityScore,
      positiveReasons,
      attentionReasons,
      recommendations,
    },
  });

  return {
    overallScore,
    components: {
      savings: { score: savingsScore, max: 15, label: 'Savings Rate' },
      expense: { score: expenseScore, max: 15, label: 'Expense Control' },
      emergency: { score: emergencyScore, max: 15, label: 'Emergency Fund' },
      debt: { score: dtiScore, max: 10, label: 'Debt & DTI' },
      investment: { score: investmentScore, max: 10, label: 'Investments' },
      goal: { score: goalScore, max: 10, label: 'Goal Progress' },
      income: { score: incomeStabilityScore, max: 10, label: 'Income Stability' },
      insurance: { score: insuranceScore, max: 5, label: 'Insurance' },
      subscription: { score: subscriptionScore, max: 5, label: 'Subscription Health' },
      cashFlow: { score: cashFlowScore, max: 5, label: 'Cash Flow Stability' },
    },
    positiveReasons,
    attentionReasons,
    recommendations,
    historyId: historyEntry.id,
    calculatedAt: new Date().toISOString(),
  };
};

/**
 * Cash Flow Prediction Engine (7, 30, 90 Days)
 */
const predictCashFlow = async (userId, timeframeDays = 30) => {
  const accounts = await prisma.financialAccount.findMany({ where: { userId, isActive: true } });
  const currentBalance = accounts.reduce((sum, a) => sum + parseFloat(a.balance), 0);

  // Past 60 days transactions to calculate daily averages
  const past60Days = new Date();
  past60Days.setDate(past60Days.getDate() - 60);

  const [incomes, expenses, loans, subscriptions] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, transactionType: 'INCOME', date: { gte: past60Days } },
    }),
    prisma.transaction.findMany({
      where: { userId, transactionType: { in: analyticsEngine.SPENDING_TYPES }, date: { gte: past60Days } },
    }),
    prisma.loan.findMany({ where: { userId, status: 'ACTIVE' } }),
    prisma.subscription.findMany({ where: { userId, isActive: true } }),
  ]);

  const totalPastIncome = incomes.reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalPastExpense = Math.max(
    0,
    expenses.reduce((s, t) => s + analyticsEngine.signedSpendingAmount(t), 0)
  );
  const avgDailyIncome = totalPastIncome > 0 ? totalPastIncome / 60 : 0;
  const avgDailyExpense = totalPastExpense > 0 ? totalPastExpense / 60 : 0;

  const monthlyEMI = loans.reduce((s, l) => s + parseFloat(l.emiAmount || 0), 0);
  const monthlySub = subscriptions.reduce((s, sub) => s + (sub.billingCycle === 'ANNUAL' ? parseFloat(sub.cost) / 12 : parseFloat(sub.cost)), 0);

  const projections = [];
  let runningBalance = currentBalance;
  let expectedTotalIncome = 0;
  let expectedTotalExpenses = 0;
  let lowBalanceDate = null;
  let lowBalanceAmount = null;

  const today = new Date();

  for (let d = 1; d <= timeframeDays; d++) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + d);

    // Salary typically on 1st or 28th
    let dailyInc = avgDailyIncome;
    if (targetDate.getDate() === 1 && totalPastIncome > 0) {
      dailyInc += totalPastIncome / 2;
    }

    let dailyExp = avgDailyExpense;
    // EMI typically on 5th
    if (targetDate.getDate() === 5 && monthlyEMI > 0) {
      dailyExp += monthlyEMI;
    }
    // Subscriptions on 10th
    if (targetDate.getDate() === 10 && monthlySub > 0) {
      dailyExp += monthlySub;
    }

    runningBalance = runningBalance + dailyInc - dailyExp;
    expectedTotalIncome += dailyInc;
    expectedTotalExpenses += dailyExp;

    if (runningBalance < 10000 && !lowBalanceDate) {
      lowBalanceDate = targetDate.toISOString().split('T')[0];
      lowBalanceAmount = runningBalance;
    }

    projections.push({
      day: d,
      date: targetDate.toISOString().split('T')[0],
      projectedIncome: Math.round(dailyInc * 100) / 100,
      projectedExpense: Math.round(dailyExp * 100) / 100,
      projectedBalance: Math.round(runningBalance * 100) / 100,
    });
  }

  // Save to DB
  await prisma.cashFlowPrediction.create({
    data: {
      userId,
      timeframeDays,
      expectedIncome: Math.round(expectedTotalIncome * 100) / 100,
      expectedExpenses: Math.round(expectedTotalExpenses * 100) / 100,
      expectedBalance: Math.round(runningBalance * 100) / 100,
      lowBalanceDate: lowBalanceDate ? new Date(lowBalanceDate) : null,
      lowBalanceAmount: lowBalanceAmount ? Math.round(lowBalanceAmount * 100) / 100 : null,
      projections,
    },
  });

  return {
    timeframeDays,
    currentBalance,
    formattedCurrentBalance: formatINR(currentBalance),
    expectedIncome: Math.round(expectedTotalIncome * 100) / 100,
    formattedExpectedIncome: formatINR(expectedTotalIncome),
    expectedExpenses: Math.round(expectedTotalExpenses * 100) / 100,
    formattedExpectedExpenses: formatINR(expectedTotalExpenses),
    expectedBalance: Math.round(runningBalance * 100) / 100,
    formattedExpectedBalance: formatINR(runningBalance),
    lowBalanceWarning: lowBalanceDate ? {
      date: lowBalanceDate,
      projectedAmount: lowBalanceAmount,
      formattedAmount: formatINR(lowBalanceAmount),
      message: `Projected balance may fall below ₹10,000 around ${new Date(lowBalanceDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.`,
    } : null,
    projections,
  };
};

/**
 * Statistical Anomaly Detection for Transactions
 */
const detectExpenseAnomaly = async (userId, transaction) => {
  const { amount, categoryId, merchant, description } = transaction;
  const txAmount = parseFloat(amount);

  // Fetch category history
  const pastTransactions = await prisma.transaction.findMany({
    where: {
      userId,
      transactionType: 'EXPENSE',
      ...(categoryId ? { categoryId } : {}),
    },
    take: 30,
  });

  if (pastTransactions.length < 3) {
    return { isAnomaly: false, severity: 'NORMAL', baselineAverage: txAmount, reason: 'Insufficient history for baseline' };
  }

  const amounts = pastTransactions.map(t => parseFloat(t.amount));
  const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / amounts.length;
  const stdDev = Math.sqrt(variance) || 1;
  const zScore = (txAmount - avg) / stdDev;

  let severity = 'NORMAL';
  let reason = 'Transaction is within normal historical range.';

  if (zScore >= 3.0 || (avg > 0 && txAmount > avg * 2.5)) {
    severity = 'HIGHLY_UNUSUAL';
    reason = `Spend of ${formatINR(txAmount)} is significantly higher than your category average of ${formatINR(avg)}.`;
  } else if (zScore >= 2.0 || (avg > 0 && txAmount > avg * 1.8)) {
    severity = 'UNUSUAL';
    reason = `Spend of ${formatINR(txAmount)} is higher than usual (average: ${formatINR(avg)}).`;
  }

  if (severity !== 'NORMAL') {
    await prisma.expenseAnomaly.create({
      data: {
        userId,
        transactionId: transaction.id || null,
        amount: txAmount,
        category: categoryId || 'General',
        merchant: merchant || description || 'Expense',
        baselineAverage: Math.round(avg * 100) / 100,
        severity,
        reason,
        userFeedback: 'PENDING',
      },
    });
  }

  return {
    isAnomaly: severity !== 'NORMAL',
    severity,
    baselineAverage: Math.round(avg * 100) / 100,
    formattedBaselineAverage: formatINR(avg),
    reason,
  };
};

/**
 * Smart Budget Optimizer (50/30/20, Zero-Based, Custom)
 */
const optimizeBudget = async (userId, method = '50/30/20') => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [incomes, currentBudgets, expensesByCategory] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, transactionType: 'INCOME', date: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
    prisma.budget.findMany({ where: { userId } }),
    prisma.transaction.groupBy({
      by: ['categoryId', 'transactionType'],
      where: { userId, transactionType: { in: analyticsEngine.SPENDING_TYPES }, date: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
  ]);

  const totalIncome = parseFloat(incomes._sum.amount || 0) || 50000;
  const categories = await prisma.category.findMany({ where: { OR: [{ userId }, { isDefault: true }] } });
  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]));

  const recommendations = [];

  if (method === '50/30/20') {
    const needsBudget = totalIncome * 0.50;
    const wantsBudget = totalIncome * 0.30;
    const savingsBudget = totalIncome * 0.20;

    recommendations.push({
      group: 'Needs (50%)',
      allocated: needsBudget,
      formattedAllocated: formatINR(needsBudget),
      explanation: 'Covers essential expenses such as Rent, Groceries, Utilities, and EMIs.',
    });
    recommendations.push({
      group: 'Wants (30%)',
      allocated: wantsBudget,
      formattedAllocated: formatINR(wantsBudget),
      explanation: 'Covers dining out, entertainment, shopping, and discretionary hobbies.',
    });
    recommendations.push({
      group: 'Savings & Investments (20%)',
      allocated: savingsBudget,
      formattedAllocated: formatINR(savingsBudget),
      explanation: 'Directly allocated towards Emergency Fund, SIPs, and loan prepayments.',
    });
  }

  // Category specific recommendations. Refund/reversal rows are netted per
  // category so an optimiser never suggests a budget based on gross spend.
  const netExpensesByCategory = (() => {
    const totals = new Map();
    for (const row of expensesByCategory) {
      const key = row.categoryId || null;
      totals.set(key, (totals.get(key) || 0) + analyticsEngine.signedTotal([row]));
    }
    return Array.from(totals.entries())
      .map(([categoryId, amount]) => ({ categoryId, amount: analyticsEngine.round2(amount) }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  })();

  const categoryOptimizations = netExpensesByCategory.map(exp => {
    const catName = catMap[exp.categoryId] || 'General';
    const spent = exp.amount;
    const existingBudget = currentBudgets.find(b => b.categoryId === exp.categoryId || b.categoryName === catName);
    const currentLimit = existingBudget ? parseFloat(existingBudget.monthlyLimit) : 0;
    
    let suggestedLimit = currentLimit > 0 ? Math.round(currentLimit * 0.95) : Math.round(spent * 1.1);
    let why = 'Aligned with historical category velocity with room for 5% optimization.';

    if (spent > currentLimit && currentLimit > 0) {
      suggestedLimit = Math.round(spent * 1.05);
      why = `Current limit of ${formatINR(currentLimit)} was exceeded (spent ${formatINR(spent)}). Adjusted to realistic limit.`;
    }

    return {
      categoryId: exp.categoryId,
      categoryName: catName,
      currentSpent: spent,
      formattedCurrentSpent: formatINR(spent),
      currentLimit,
      formattedCurrentLimit: formatINR(currentLimit),
      suggestedLimit,
      formattedSuggestedLimit: formatINR(suggestedLimit),
      difference: suggestedLimit - currentLimit,
      reason: why,
    };
  });

  return {
    method,
    monthlyIncome: totalIncome,
    formattedMonthlyIncome: formatINR(totalIncome),
    recommendations,
    categoryOptimizations,
  };
};

/**
 * What-If Financial Simulator
 */
const simulateScenario = async (userId, scenarioData) => {
  const {
    scenarioName = 'Custom What-If Scenario',
    scenarioType, // SALARY_INCREASE, EXPENSE_INCREASE, EXTRA_INVESTMENT, LOAN_PREPAY, MAJOR_PURCHASE
    salaryChangePercent = 0,
    expenseChangePercent = 0,
    extraMonthlyInvestment = 0,
    loanPrepaymentAmount = 0,
    majorPurchaseAmount = 0,
  } = scenarioData;

  const [accounts, profile, loans, portfolio, goals] = await Promise.all([
    prisma.financialAccount.findMany({ where: { userId, isActive: true } }),
    prisma.financialProfile.findUnique({ where: { userId } }),
    prisma.loan.findMany({ where: { userId, status: 'ACTIVE' } }),
    prisma.portfolio.findUnique({ where: { userId } }),
    prisma.goal.findMany({ where: { userId, status: 'ACTIVE' } }),
  ]);

  const currentCash = accounts.reduce((s, a) => s + parseFloat(a.balance), 0);
  const currentSalary = parseFloat(profile?.monthlySalary || 60000);
  const currentExpenses = parseFloat(profile?.estimatedMonthlyExpenses || 35000);
  const currentInvestments = parseFloat(portfolio?.currentValue || 0);
  const currentDebt = loans.reduce((s, l) => s + parseFloat(l.outstandingBalance), 0);
  const currentMonthlyEMI = loans.reduce((s, l) => s + parseFloat(l.emiAmount || 0), 0);

  const currentMonthlySavings = currentSalary - currentExpenses - currentMonthlyEMI;
  const currentNetWorth = currentCash + currentInvestments - currentDebt;

  // Scenario calculations
  const scenarioSalary = currentSalary * (1 + salaryChangePercent / 100);
  const scenarioExpenses = currentExpenses * (1 + expenseChangePercent / 100);
  const scenarioCash = Math.max(0, currentCash - majorPurchaseAmount - loanPrepaymentAmount);
  const scenarioDebt = Math.max(0, currentDebt - loanPrepaymentAmount);
  const scenarioMonthlySavings = scenarioSalary - scenarioExpenses - currentMonthlyEMI - extraMonthlyInvestment;

  // 5-year compounding comparison (10% CAGR)
  const current5YearCorpus = (currentInvestments * Math.pow(1.10, 5)) + (currentMonthlySavings * 12 * 5 * 1.25);
  const scenario5YearCorpus = ((currentInvestments + extraMonthlyInvestment * 12) * Math.pow(1.10, 5)) + (scenarioMonthlySavings * 12 * 5 * 1.25);

  const scenarioNetWorth = scenarioCash + (currentInvestments + extraMonthlyInvestment * 12) - scenarioDebt;

  const summary = `Under this scenario, your monthly cash flow becomes ${formatINR(scenarioMonthlySavings)} (vs current ${formatINR(currentMonthlySavings)}). Projected 5-year net asset impact is ${formatINR(scenario5YearCorpus - current5YearCorpus)}.`;

  const record = await prisma.financialSimulation.create({
    data: {
      userId,
      scenarioName,
      scenarioType: scenarioType || 'CUSTOM',
      parameters: scenarioData,
      currentCashFlow: currentMonthlySavings,
      scenarioCashFlow: scenarioMonthlySavings,
      currentNetWorth,
      scenarioNetWorth,
      impactSummary: summary,
      detailedImpact: {
        current: {
          monthlySalary: currentSalary,
          monthlyExpenses: currentExpenses,
          monthlySavings: currentMonthlySavings,
          netWorth: currentNetWorth,
          projected5Year: current5YearCorpus,
        },
        scenario: {
          monthlySalary: scenarioSalary,
          monthlyExpenses: scenarioExpenses,
          monthlySavings: scenarioMonthlySavings,
          netWorth: scenarioNetWorth,
          projected5Year: scenario5YearCorpus,
        },
        delta: {
          monthlySavingsDelta: scenarioMonthlySavings - currentMonthlySavings,
          netWorthDelta: scenarioNetWorth - currentNetWorth,
          projected5YearDelta: scenario5YearCorpus - current5YearCorpus,
        },
      },
    },
  });

  return {
    simulationId: record.id,
    scenarioName,
    summary,
    comparison: {
      monthlyCashFlow: {
        current: currentMonthlySavings,
        formattedCurrent: formatINR(currentMonthlySavings),
        scenario: scenarioMonthlySavings,
        formattedScenario: formatINR(scenarioMonthlySavings),
        change: scenarioMonthlySavings - currentMonthlySavings,
      },
      netWorth: {
        current: currentNetWorth,
        formattedCurrent: formatINR(currentNetWorth),
        scenario: scenarioNetWorth,
        formattedScenario: formatINR(scenarioNetWorth),
        change: scenarioNetWorth - currentNetWorth,
      },
      fiveYearProjection: {
        current: current5YearCorpus,
        formattedCurrent: formatINR(current5YearCorpus),
        scenario: scenario5YearCorpus,
        formattedScenario: formatINR(scenario5YearCorpus),
        change: scenario5YearCorpus - current5YearCorpus,
      },
    },
  };
};

/**
 * Goal Forecasting Engine
 */
const forecastGoal = (goal, extraMonthly = 0) => {
  const target = parseFloat(goal.targetAmount);
  const current = parseFloat(goal.currentAmount);
  const remaining = Math.max(0, target - current);
  const monthly = parseFloat(goal.monthlyContribution || 0) + extraMonthly;

  const monthsRemaining = monthly > 0 ? Math.ceil(remaining / monthly) : 999;
  const projectedDate = new Date();
  projectedDate.setMonth(projectedDate.getMonth() + (monthsRemaining < 999 ? monthsRemaining : 120));

  const progressPercent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  return {
    goalId: goal.id,
    name: goal.name,
    targetAmount: target,
    formattedTarget: formatINR(target),
    currentAmount: current,
    formattedCurrent: formatINR(current),
    remainingAmount: remaining,
    formattedRemaining: formatINR(remaining),
    monthlyContribution: monthly,
    formattedMonthlyContribution: formatINR(monthly),
    progressPercent,
    predictedCompletionDate: monthsRemaining < 999 ? projectedDate.toISOString().split('T')[0] : 'Indefinite (requires monthly contribution)',
    scenarios: {
      currentPlan: monthsRemaining < 999 ? `${monthsRemaining} months (${projectedDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })})` : 'Set contribution',
      plus2000: monthly + 2000 > 0 ? `${Math.ceil(remaining / (monthly + 2000))} months` : 'N/A',
      plus5000: monthly + 5000 > 0 ? `${Math.ceil(remaining / (monthly + 5000))} months` : 'N/A',
    },
  };
};

/**
 * Retirement Planner
 */
const planRetirement = ({
  currentAge = 25,
  retirementAge = 60,
  currentSavings = 500000,
  monthlyContribution = 15000,
  inflationRate = 6, // 6%
  expectedReturn = 12, // 12%
  targetMonthlyExpenseInRetirement = 50000,
}) => {
  const yearsToRetire = Math.max(1, retirementAge - currentAge);
  const monthsToRetire = yearsToRetire * 12;

  // Monthly return rate
  const r = expectedReturn / 100 / 12;
  
  // Future corpus = Current * (1+r)^n + PMT * [((1+r)^n - 1) / r]
  const compoundedCurrent = currentSavings * Math.pow(1 + r, monthsToRetire);
  const compoundedAnnuity = monthlyContribution * ((Math.pow(1 + r, monthsToRetire) - 1) / r);
  const estimatedCorpus = Math.round(compoundedCurrent + compoundedAnnuity);

  // Required corpus at retirement adjusting for inflation over retirement years (assumed 25 yrs)
  const inflatedMonthlyExpense = targetMonthlyExpenseInRetirement * Math.pow(1 + inflationRate / 100, yearsToRetire);
  const requiredCorpus = Math.round(inflatedMonthlyExpense * 12 * 22); // 22x rule
  const shortfall = Math.max(0, requiredCorpus - estimatedCorpus);

  return {
    currentAge,
    retirementAge,
    yearsToRetire,
    estimatedCorpus,
    formattedEstimatedCorpus: formatINR(estimatedCorpus),
    requiredCorpus,
    formattedRequiredCorpus: formatINR(requiredCorpus),
    shortfall,
    formattedShortfall: formatINR(shortfall),
    status: estimatedCorpus >= requiredCorpus ? 'ON_TRACK' : 'SHORTFALL_DETECTED',
    scenarios: {
      conservative: { returnRate: '8%', estimatedCorpus: formatINR(currentSavings * Math.pow(1.08, yearsToRetire) + monthlyContribution * 12 * yearsToRetire * 1.5) },
      base: { returnRate: `${expectedReturn}%`, estimatedCorpus: formatINR(estimatedCorpus) },
      optimistic: { returnRate: '15%', estimatedCorpus: formatINR(estimatedCorpus * 1.35) },
    },
    disclaimer: 'Educational retirement projections. Assumptions: 6% inflation, 22x annual expenses corpus rule.',
  };
};

/**
 * Financial Risk Radar
 */
const evaluateRiskRadar = async (userId) => {
  const [health, accounts, loans, portfolio] = await Promise.all([
    calculateDetailedHealthScore(userId),
    prisma.financialAccount.findMany({ where: { userId, isActive: true } }),
    prisma.loan.findMany({ where: { userId, status: 'ACTIVE' } }),
    prisma.portfolio.findUnique({ where: { userId }, include: { investments: true } }),
  ]);

  const totalCash = accounts.reduce((s, a) => s + parseFloat(a.balance), 0);
  const totalDebt = loans.reduce((s, l) => s + parseFloat(l.outstandingBalance), 0);
  const holdings = portfolio?.investments || [];

  const risks = [
    {
      category: 'Debt Burden Risk',
      level: totalDebt > 500000 ? 'HIGH' : totalDebt > 100000 ? 'MODERATE' : 'LOW',
      score: health.components.debt.score,
      reason: totalDebt > 0 ? `Outstanding active debt of ${formatINR(totalDebt)}.` : 'No outstanding debt obligations.',
      action: totalDebt > 0 ? 'Accelerate debt payoff using loan prepayment simulator.' : 'Maintain debt-free lifestyle.',
    },
    {
      category: 'Liquidity / Emergency Risk',
      level: totalCash < 25000 ? 'HIGH' : totalCash < 75000 ? 'MODERATE' : 'LOW',
      score: health.components.emergency.score,
      reason: `Liquid bank reserves standing at ${formatINR(totalCash)}.`,
      action: totalCash < 50000 ? 'Accumulate 3–6 months essential living expenses in liquid accounts.' : 'Liquidity buffer is healthy.',
    },
    {
      category: 'Investment Concentration Risk',
      level: holdings.length <= 1 && holdings.length > 0 ? 'HIGH' : holdings.length <= 3 ? 'MODERATE' : 'LOW',
      score: health.components.investment.score,
      reason: holdings.length > 0 ? `Portfolio contains ${holdings.length} distinct asset(s).` : 'No invested holdings recorded.',
      action: 'Broaden holdings across Equities, Gold, and Debt instruments.',
    },
    {
      category: 'Insurance Protection Gap',
      level: health.components.insurance.score <= 2 ? 'HIGH' : health.components.insurance.score <= 4 ? 'MODERATE' : 'LOW',
      score: health.components.insurance.score,
      reason: health.components.insurance.score <= 2 ? 'Inadequate health or term insurance protection identified.' : 'Adequate primary coverage active.',
      action: 'Ensure term life coverage equals at least 10x annual income plus liabilities.',
    },
  ];

  return {
    overallRisk: risks.some(r => r.level === 'HIGH') ? 'HIGH' : risks.some(r => r.level === 'MODERATE') ? 'MODERATE' : 'LOW',
    risks,
    evaluatedAt: new Date().toISOString(),
  };
};

module.exports = {
  calculateDetailedHealthScore,
  predictCashFlow,
  detectExpenseAnomaly,
  optimizeBudget,
  simulateScenario,
  forecastGoal,
  planRetirement,
  evaluateRiskRadar,
};
