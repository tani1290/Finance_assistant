const prisma = require('../config/database');

/**
 * Financial Tasks & To-Do Controller (Phase 29)
 * Manages action items: EMI payments, SIP investments, card dues, budget reviews, tax filing.
 */

// GET /api/v1/tasks
const getTasks = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { isCompleted, category, priority } = req.query;

    const where = { userId };
    if (isCompleted !== undefined) {
      where.isCompleted = isCompleted === 'true';
    }
    if (category) {
      where.category = category.toUpperCase();
    }
    if (priority) {
      where.priority = priority.toUpperCase();
    }

    const tasks = await prisma.financialTask.findMany({
      where,
      orderBy: [
        { isCompleted: 'asc' },
        { dueDate: 'asc' },
      ],
    });

    const summary = {
      total: tasks.length,
      pending: tasks.filter(t => !t.isCompleted).length,
      completed: tasks.filter(t => t.isCompleted).length,
      overdue: tasks.filter(t => !t.isCompleted && new Date(t.dueDate) < new Date()).length,
    };

    return res.status(200).json({
      success: true,
      data: {
        tasks,
        summary,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/tasks/:id
const getTask = async (req, res, next) => {
  try {
    const task = await prisma.financialTask.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task not found or access denied.' },
      });
    }

    return res.status(200).json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/tasks
const createTask = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      title,
      category = 'GENERAL',
      dueDate,
      priority = 'MEDIUM',
      reminderTime,
      notes,
    } = req.body;

    if (!title || !dueDate) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Task title and due date are required.' },
      });
    }

    const task = await prisma.financialTask.create({
      data: {
        userId,
        title: title.trim(),
        category: category.toUpperCase(),
        dueDate: new Date(dueDate),
        priority: ['HIGH', 'MEDIUM', 'LOW'].includes(priority.toUpperCase()) ? priority.toUpperCase() : 'MEDIUM',
        reminderTime: reminderTime ? new Date(reminderTime) : null,
        notes: notes ? notes.trim() : null,
      },
    });

    return res.status(201).json({
      success: true,
      data: task,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/tasks/:id
const updateTask = async (req, res, next) => {
  try {
    const task = await prisma.financialTask.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task not found or access denied.' },
      });
    }

    const {
      title,
      category,
      dueDate,
      priority,
      isCompleted,
      reminderTime,
      notes,
    } = req.body;

    const data = {};
    if (title !== undefined) data.title = title.trim();
    if (category !== undefined) data.category = category.toUpperCase();
    if (dueDate !== undefined) data.dueDate = new Date(dueDate);
    if (priority !== undefined) data.priority = priority.toUpperCase();
    if (reminderTime !== undefined) data.reminderTime = reminderTime ? new Date(reminderTime) : null;
    if (notes !== undefined) data.notes = notes ? notes.trim() : null;

    if (isCompleted !== undefined) {
      data.isCompleted = Boolean(isCompleted);
      data.completedAt = isCompleted ? new Date() : null;
    }

    const updated = await prisma.financialTask.update({
      where: { id: task.id },
      data,
    });

    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/tasks/:id
const deleteTask = async (req, res, next) => {
  try {
    const task = await prisma.financialTask.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task not found or access denied.' },
      });
    }

    await prisma.financialTask.delete({ where: { id: task.id } });
    return res.status(200).json({ success: true, message: 'Financial task removed.' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
};
