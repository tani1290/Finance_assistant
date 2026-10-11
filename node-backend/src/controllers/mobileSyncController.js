const prisma = require('../config/database');

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

    // Fetch core financial state in parallel
    const [accounts, recentTransactions, pendingSmsCount, budgets, user] = await Promise.all([
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
      })
    ]);

    // Calculate total net worth
    let totalBalance = 0;
    accounts.forEach(acc => {
      totalBalance += parseFloat(acc.balance || 0);
    });

    return res.status(200).json({
      success: true,
      data: {
        serverTime: new Date().toISOString(),
        user,
        summary: {
          totalBalance,
          netWorth: totalBalance,
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
