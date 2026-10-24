const prisma = require('../config/database');
const analyticsEngine = require('../services/analyticsEngine');

/**
 * Controller for Mobile Device Registration and Fast Client Synchronization
 * Conforms to Master Engineering Directive Sections 8 & 12.
 */

exports.registerDevice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, deviceModel, osVersion, appVersion, fcmToken } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'deviceId is required'
      });
    }

    const device = await prisma.mobileDevice.upsert({
      where: {
        userId_deviceId: {
          userId,
          deviceId
        }
      },
      update: {
        deviceModel,
        osVersion,
        appVersion,
        fcmToken,
        lastSyncAt: new Date(),
        isActive: true
      },
      create: {
        userId,
        deviceId,
        deviceModel,
        osVersion,
        appVersion,
        fcmToken,
        lastSyncAt: new Date(),
        isActive: true
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Mobile device registered / updated successfully',
      data: device
    });
  } catch (err) {
    console.error('[Mobile] Register device error:', err);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to register mobile device'
    });
  }
};

exports.getMobileSyncState = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.query;

    if (deviceId) {
      // Update device lastSyncAt
      await prisma.mobileDevice.updateMany({
        where: { userId, deviceId },
        data: { lastSyncAt: new Date() }
      }).catch(() => {});
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Fetch core financial state in parallel
    const [
      accounts,
      recentTransactions,
      pendingSmsCount,
      budgets,
      user,
      portfolio,
      monthlyIncomeAgg,
      monthlyExpenseAgg,
      activeLoan
    ] = await Promise.all([
      prisma.financialAccount.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        take: 30,
        include: {
          category: { select: { id: true, name: true } },
          account: { select: { id: true, name: true, accountType: true } }
        }
      }),
      prisma.pendingSmsTransaction.count({
        where: { userId, status: 'PENDING' }
      }),
      prisma.budget.findMany({
        where: { userId, month: currentMonth, year: currentYear }
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          currency: true,
          isPremium: true
        }
      }),
      prisma.portfolio.findUnique({
        where: { userId },
        select: { totalInvested: true, currentValue: true }
      }),
      prisma.transaction.aggregate({
        where: { userId, transactionType: 'INCOME', date: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true }
      }),
      prisma.transaction.groupBy({
        by: ['transactionType'],
        where: { userId, transactionType: { in: analyticsEngine.SPENDING_TYPES }, date: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true }
      }),
      prisma.loan.aggregate({
        where: { userId, status: 'ACTIVE' },
        _sum: { outstandingBalance: true }
      })
    ]);

    // Calculate total balance, investments, debt and true net worth
    // (mirrors GET /dashboard so mobile and web never disagree)
    let totalBalance = 0;
    accounts.forEach(acc => {
      totalBalance += parseFloat(acc.balance || 0);
    });

    const investmentValue = parseFloat(portfolio?.currentValue || 0);
    const loanOutstanding = parseFloat(activeLoan._sum.outstandingBalance || 0);
    const netWorth = totalBalance + investmentValue - loanOutstanding;

    const monthlyIncome = parseFloat(monthlyIncomeAgg._sum.amount || 0);
    const monthlyExpenses = analyticsEngine.signedTotal(monthlyExpenseAgg);
    const monthlySavings = monthlyIncome - monthlyExpenses;
    const savingsRate = monthlyIncome > 0
      ? Math.round((monthlySavings / monthlyIncome) * 100)
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        serverTime: new Date().toISOString(),
        user,
        summary: {
          totalBalance,
          investmentValue,
          loanOutstanding,
          netWorth,
          monthlyIncome,
          monthlyExpenses,
          monthlySavings,
          savingsRate,
          pendingSmsCount,
          activeAccountsCount: accounts.length
        },
        accounts,
        recentTransactions,
        budgets
      }
    });
  } catch (err) {
    console.error('[Mobile] Sync state error:', err);
    return res.status(500).json({
      success: false,
      error: 'SYNC_ERROR',
      message: 'Failed to retrieve synchronization state'
    });
  }
};
