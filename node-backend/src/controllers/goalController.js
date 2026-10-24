const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { parseDateOnly, formatDateOnly } = require('../utils/dateOnly');

/**
 * GET /api/v1/goals
 */
const getGoals = async (req, res, next) => {
  try {
    const goals = await prisma.goal.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: goals.map((g) => {
        const target = parseFloat(g.targetAmount);
        const current = parseFloat(g.currentAmount);
        const progress = target > 0 ? Math.round((current / target) * 100) : 0;
        const remaining = Math.max(0, target - current);

        return {
          id: g.id,
          name: g.name,
          goalType: g.goalType,
          targetAmount: target,
          formattedTarget: formatINR(target),
          currentAmount: current,
          formattedCurrent: formatINR(current),
          remaining,
          formattedRemaining: formatINR(remaining),
          progress,
          targetDate: formatDateOnly(g.targetDate),
          monthlyContribution: parseFloat(g.monthlyContribution || 0),
          formattedMonthlyContribution: formatINR(g.monthlyContribution || 0),
          priority: g.priority,
          status: g.status,
          createdAt: g.createdAt,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/goals
 */
const createGoal = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, goalType = 'OTHER', targetAmount, currentAmount = 0, targetDate, monthlyContribution = 0, priority = 'MEDIUM' } = req.body;

    const target = parseFloat(targetAmount);
    if (!name || !target || target <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Goal name and a positive target amount are required.' },
      });
    }

    const goal = await prisma.goal.create({
      data: {
        userId,
        name: name.trim(),
        goalType,
        targetAmount: target,
        currentAmount: parseFloat(currentAmount) || 0,
        targetDate: targetDate ? parseDateOnly(targetDate, 'targetDate') : null,
        monthlyContribution: parseFloat(monthlyContribution) || 0,
        priority,
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        ...goal,
        targetDate: formatDateOnly(goal.targetDate),
        formattedTarget: formatINR(goal.targetAmount),
        message: `Goal "${name}" created successfully!`,
      },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    next(error);
  }
};

/**
 * PATCH /api/v1/goals/:id/contribute
 */
const contributeToGoal = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const goal = await prisma.goal.findFirst({ where: { id: req.params.id, userId } });

    if (!goal) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Goal not found.' },
      });
    }

    const contribution = parseFloat(req.body.amount);
    if (!contribution || contribution <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Contribution amount must be positive.' },
      });
    }

    const newAmount = parseFloat(goal.currentAmount) + contribution;
    const isComplete = newAmount >= parseFloat(goal.targetAmount);

    const updated = await prisma.goal.update({
      where: { id: req.params.id },
      data: {
        currentAmount: newAmount,
        status: isComplete ? 'COMPLETED' : 'ACTIVE',
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        ...updated,
        targetDate: formatDateOnly(updated.targetDate),
        formattedCurrent: formatINR(updated.currentAmount),
        formattedTarget: formatINR(updated.targetAmount),
        progress: Math.min(100, Math.round((newAmount / parseFloat(goal.targetAmount)) * 100)),
        message: isComplete ? `Congratulations! Goal "${goal.name}" completed! 🎉` : `Added ${formatINR(contribution)} to "${goal.name}"!`,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/goals/:id
 */
const getGoal = async (req, res, next) => {
  try {
    const goal = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!goal) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Goal not found.' } });
    }
    const target = parseFloat(goal.targetAmount);
    const current = parseFloat(goal.currentAmount);
    return res.status(200).json({
      success: true,
      data: {
        ...goal,
        targetDate: formatDateOnly(goal.targetDate),
        targetAmount: target,
        currentAmount: current,
        formattedTarget: formatINR(target),
        formattedCurrent: formatINR(current),
        remaining: Math.max(0, target - current),
        progress: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/goals/:id
 */
const updateGoal = async (req, res, next) => {
  try {
    const goal = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!goal) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Goal not found.' } });
    }

    const { name, goalType, targetAmount, currentAmount, targetDate, monthlyContribution, priority, status } = req.body;
    const updated = await prisma.goal.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name: name.trim() }),
        ...(goalType && { goalType }),
        ...(targetAmount !== undefined && { targetAmount: parseFloat(targetAmount) }),
        ...(currentAmount !== undefined && { currentAmount: parseFloat(currentAmount) }),
        ...(targetDate && { targetDate: parseDateOnly(targetDate, 'targetDate') }),
        ...(monthlyContribution !== undefined && { monthlyContribution: parseFloat(monthlyContribution) }),
        ...(priority && { priority }),
        ...(status && { status }),
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        ...updated,
        targetDate: formatDateOnly(updated.targetDate),
        formattedTarget: formatINR(updated.targetAmount),
        formattedCurrent: formatINR(updated.currentAmount),
        message: 'Goal updated successfully.',
      },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    next(error);
  }
};

/**
 * DELETE /api/v1/goals/:id
 */
const deleteGoal = async (req, res, next) => {
  try {
    const goal = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!goal) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Goal not found.' } });
    }
    await prisma.goal.delete({ where: { id: req.params.id } });
    return res.status(200).json({ success: true, data: { message: 'Goal deleted.' } });
  } catch (error) {
    next(error);
  }
};

module.exports = { getGoals, getGoal, createGoal, updateGoal, contributeToGoal, deleteGoal };
