const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { calculateHealthScore } = require('../utils/financialMath');
const financialTwin = require('../services/financialTwinService');

/**
 * POST /api/v1/onboarding
 */
const submitOnboarding = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      age, city, monthlySalary, otherMonthlyIncome = 0,
      estimatedMonthlyExpenses, currentSavings, totalDebt = 0,
      riskProfile = 'MODERATE', budgetMethod = 'FIFTY_THIRTY_TWENTY',
      financialPriorities = '', customBudgetCategories,
    } = req.body;

    const salary = parseFloat(monthlySalary) || 0;
    const expenses = parseFloat(estimatedMonthlyExpenses) || 0;
    const savings = parseFloat(currentSavings) || 0;
    const debt = parseFloat(totalDebt) || 0;
    const otherIncome = parseFloat(otherMonthlyIncome) || 0;
    // Process custom budget categories if method is CUSTOM
    let sanitizedPriorities = financialPriorities?.trim() || '';
    if (budgetMethod === 'CUSTOM' && Array.isArray(customBudgetCategories) && customBudgetCategories.length > 0) {
      // Validate non-negative numbers and sanitize names
      const validCategories = customBudgetCategories.map(cat => ({
        name: String(cat.name || 'Category').trim().slice(0, 50),
        percentage: Math.max(0, parseFloat(cat.percentage) || 0)
      }));
      sanitizedPriorities = JSON.stringify({ customBudgetCategories: validCategories });
    }


    // Upsert FinancialProfile
    const profile = await prisma.financialProfile.upsert({
      where: { userId },
      update: {
        age: parseInt(age) || 25,
        city: city?.trim() || 'Mumbai',
        monthlySalary: salary,
        otherMonthlyIncome: otherIncome,
        estimatedMonthlyExpenses: expenses,
        currentSavings: savings,
        totalDebt: debt,
        riskProfile,
        budgetMethod,
        financialPriorities: sanitizedPriorities,
        isOnboardingComplete: true,
      },
      create: {
        userId,
        age: parseInt(age) || 25,
        city: city?.trim() || 'Mumbai',
        monthlySalary: salary,
        otherMonthlyIncome: otherIncome,
        estimatedMonthlyExpenses: expenses,
        currentSavings: savings,
        totalDebt: debt,
        riskProfile,
        budgetMethod,
        financialPriorities: sanitizedPriorities,
        isOnboardingComplete: true,
      },
    });

    // Ensure default account exists first so health score engine picks up initial savings
    const existingAccount = await prisma.financialAccount.findFirst({ where: { userId } });
    if (!existingAccount) {
      await prisma.financialAccount.create({
        data: { userId, name: 'Primary Account', accountType: 'BANK', balance: savings, currency: 'INR' },
      });
    } else if (savings > 0) {
      await prisma.financialAccount.update({
        where: { id: existingAccount.id },
        data: { balance: savings },
      });
    }

    // Generate FinancialPlan with unified 10-factor score
    const totalMonthlyIncome = salary + otherIncome;
    const savingsTarget = totalMonthlyIncome * 0.20; // 20% target
    const emergencyFundTarget = expenses * 6; // 6 months
    const investmentTarget = totalMonthlyIncome * 0.15; // 15% target
    const debtRepaymentTarget = debt > 0 ? debt * 0.05 : 0; // 5% of total debt/month

    let healthScore = 50;
    try {
      const detailed = await financialTwin.calculateDetailedHealthScore(userId);
      healthScore = detailed.overallScore;
    } catch (err) {
      console.warn('[Onboarding] 10-factor health score calculation error:', err.message);
      healthScore = calculateHealthScore({
        monthlyIncome: totalMonthlyIncome,
        monthlyExpenses: expenses,
        totalSavings: savings,
        totalDebt: debt,
      });
    }

    const planSummary = `Based on your monthly income of ${formatINR(totalMonthlyIncome)}, aim to save ${formatINR(savingsTarget)}/month, build an emergency fund of ${formatINR(emergencyFundTarget)}, and invest ${formatINR(investmentTarget)}/month. Your current financial health score is ${healthScore}/100.`;

    await prisma.financialPlan.upsert({
      where: { userId },
      update: {
        income: totalMonthlyIncome,
        expenses,
        savingsTarget,
        emergencyFundTarget,
        investmentTarget,
        debtRepaymentTarget,
        financialHealthScore: healthScore,
        riskProfile,
        planSummary,
      },
      create: {
        userId,
        income: totalMonthlyIncome,
        expenses,
        savingsTarget,
        emergencyFundTarget,
        investmentTarget,
        debtRepaymentTarget,
        financialHealthScore: healthScore,
        riskProfile,
        planSummary,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        isOnboardingComplete: true,
        healthScore,
        planSummary,
        formatted: {
          savingsTarget: formatINR(savingsTarget),
          emergencyFundTarget: formatINR(emergencyFundTarget),
          investmentTarget: formatINR(investmentTarget),
        },
        message: 'Onboarding complete! Your financial plan has been generated.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/onboarding/status
 */
const getOnboardingStatus = async (req, res, next) => {
  try {
    const profile = await prisma.financialProfile.findUnique({
      where: { userId: req.user.id },
    });

    return res.status(200).json({
      success: true,
      data: {
        isOnboardingComplete: profile?.isOnboardingComplete || false,
        profile: profile || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { submitOnboarding, getOnboardingStatus };
