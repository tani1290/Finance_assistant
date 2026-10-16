const prisma = require('../config/database');

/**
 * Category Management Controller
 *
 * Categories are the ledger's classification axis (a Transaction and a Budget
 * both point at one). They come in two flavours:
 *   - system categories  (userId === null, isDefault === true) — shared, read-only
 *   - user categories    (userId === <the caller>)             — fully editable
 *
 * Deleting a category is safe at the DB level (transaction.categoryId and
 * budget.categoryId are both `onDelete: SetNull`), but silently orphaning live
 * transactions is surprising, so deletion of an in-use category requires
 * `?force=true`. Untouched categories delete freely.
 */

const CATEGORY_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER'];

const normaliseType = (value, fallback = 'EXPENSE') => {
  const v = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return CATEGORY_TYPES.includes(v) ? v : fallback;
};

const shape = (c, usage = 0) => ({
  id: c.id,
  name: c.name,
  categoryType: c.categoryType,
  icon: c.icon,
  color: c.color,
  isDefault: c.isDefault,
  isSystem: c.userId === null,
  usageCount: usage,
  createdAt: c.createdAt,
});

// ---------------------------------------------------------------- GET /categories
const getCategories = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const where = { OR: [{ userId }, { userId: null }] };
    if (req.query.type) where.categoryType = normaliseType(req.query.type);

    const categories = await prisma.category.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { transactions: true, budgets: true } } },
    });

    return res.status(200).json({
      success: true,
      data: {
        categories: categories.map((c) =>
          shape(c, (c._count?.transactions || 0) + (c._count?.budgets || 0))
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------- POST /categories
const createCategory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, categoryType = 'EXPENSE', icon, color } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Category name is required.' },
      });
    }

    const cleanName = String(name).trim();
    const duplicate = await prisma.category.findFirst({
      where: { userId, name: { equals: cleanName, mode: 'insensitive' } },
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_CATEGORY', message: `You already have a category named "${cleanName}".` },
      });
    }

    const created = await prisma.category.create({
      data: {
        userId,
        name: cleanName,
        categoryType: normaliseType(categoryType),
        icon: icon || null,
        color: color || null,
      },
    });

    return res.status(201).json({ success: true, data: shape(created) });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------- GET /categories/:id
const getCategory = async (req, res, next) => {
  try {
    const category = await prisma.category.findFirst({
      where: { id: req.params.id, OR: [{ userId: req.user.id }, { userId: null }] },
      include: { _count: { select: { transactions: true, budgets: true } } },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Category not found.' },
      });
    }

    return res.status(200).json({
      success: true,
      data: shape(category, (category._count?.transactions || 0) + (category._count?.budgets || 0)),
    });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------- PATCH /categories/:id
const updateCategory = async (req, res, next) => {
  try {
    const category = await prisma.category.findFirst({
      where: { id: req.params.id, OR: [{ userId: req.user.id }, { userId: null }] },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Category not found.' },
      });
    }
    if (category.userId === null) {
      return res.status(403).json({
        success: false,
        error: { code: 'SYSTEM_CATEGORY_READ_ONLY', message: 'System categories cannot be edited. Create your own instead.' },
      });
    }

    const { name, categoryType, icon, color } = req.body;
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Category name cannot be empty.' },
      });
    }

    const updated = await prisma.category.update({
      where: { id: category.id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(categoryType !== undefined && { categoryType: normaliseType(categoryType, category.categoryType) }),
        ...(icon !== undefined && { icon: icon || null }),
        ...(color !== undefined && { color: color || null }),
      },
    });

    return res.status(200).json({ success: true, data: shape(updated) });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------- DELETE /categories/:id
const deleteCategory = async (req, res, next) => {
  try {
    const category = await prisma.category.findFirst({
      where: { id: req.params.id, OR: [{ userId: req.user.id }, { userId: null }] },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Category not found.' },
      });
    }
    if (category.userId === null) {
      return res.status(403).json({
        success: false,
        error: { code: 'SYSTEM_CATEGORY_READ_ONLY', message: 'System categories cannot be deleted.' },
      });
    }

    const usage = await prisma.transaction.count({ where: { categoryId: category.id } });
    if (usage > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'CATEGORY_IN_USE',
          message: `This category is used by ${usage} transaction(s). Re-run with ?force=true to delete and unlink them.`,
          usageCount: usage,
        },
      });
    }

    await prisma.category.delete({ where: { id: category.id } });
    return res.status(200).json({
      success: true,
      data: { deleted: true, unlinkedTransactions: usage },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getCategories, createCategory, getCategory, updateCategory, deleteCategory };
