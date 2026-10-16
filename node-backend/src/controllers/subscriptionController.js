const prisma = require('../config/database');

const formatINR = (val) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(parseFloat(val) || 0);

/**
 * GET /api/v1/subscriptions
 */
const getSubscriptions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const subscriptions = await prisma.subscription.findMany({
      where: { userId },
      orderBy: { nextBillingDate: 'asc' },
    });

    const monthlyTotal = subscriptions.reduce((sum, s) => {
      const cost = parseFloat(s.cost);
      if (s.billingCycle === 'ANNUAL') return sum + (cost / 12);
      if (s.billingCycle === 'QUARTERLY') return sum + (cost / 3);
      return sum + cost;
    }, 0);

    const annualTotal = monthlyTotal * 12;

    return res.status(200).json({
      success: true,
      data: {
        subscriptions: subscriptions.map(s => ({
          ...s,
          formattedCost: formatINR(s.cost),
        })),
        summary: {
          totalSubscriptions: subscriptions.length,
          activeSubscriptions: subscriptions.filter(s => s.isActive).length,
          monthlyTotal,
          formattedMonthlyTotal: formatINR(monthlyTotal),
          annualTotal,
          formattedAnnualTotal: formatINR(annualTotal),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/subscriptions/:id
 */
const getSubscription = async (req, res, next) => {
  try {
    const sub = await prisma.subscription.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!sub) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subscription not found.' } });
    }

    return res.status(200).json({ success: true, data: { ...sub, formattedCost: formatINR(sub.cost) } });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/subscriptions
 */
const createSubscription = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { serviceName, cost, billingCycle, nextBillingDate, category } = req.body;

    if (!serviceName || !cost || !nextBillingDate) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Service name, cost, and next billing date are required.' },
      });
    }

    const sub = await prisma.subscription.create({
      data: {
        userId,
        serviceName: serviceName.trim(),
        cost: parseFloat(cost),
        billingCycle: billingCycle || 'MONTHLY',
        nextBillingDate: new Date(nextBillingDate),
        category: category ? category.trim() : 'Entertainment',
        isActive: true,
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        ...sub,
        formattedCost: formatINR(sub.cost),
        message: 'Subscription added successfully.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/subscriptions/:id
 */
const updateSubscription = async (req, res, next) => {
  try {
    const sub = await prisma.subscription.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!sub) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subscription not found.' } });
    }

    const { serviceName, cost, billingCycle, nextBillingDate, category, isActive } = req.body;

    const updated = await prisma.subscription.update({
      where: { id: req.params.id },
      data: {
        ...(serviceName && { serviceName: serviceName.trim() }),
        ...(cost !== undefined && { cost: parseFloat(cost) }),
        ...(billingCycle && { billingCycle }),
        ...(nextBillingDate && { nextBillingDate: new Date(nextBillingDate) }),
        ...(category && { category: category.trim() }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        ...updated,
        formattedCost: formatINR(updated.cost),
        message: 'Subscription updated successfully.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/subscriptions/:id
 */
const deleteSubscription = async (req, res, next) => {
  try {
    const sub = await prisma.subscription.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!sub) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subscription not found.' } });
    }

    await prisma.subscription.delete({ where: { id: req.params.id } });

    return res.status(200).json({ success: true, data: { message: 'Subscription removed.' } });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSubscriptions,
  getSubscription,
  createSubscription,
  updateSubscription,
  deleteSubscription,
};
