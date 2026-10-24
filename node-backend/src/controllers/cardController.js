const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { parseDateOnly, formatDateOnly } = require('../utils/dateOnly');

/**
 * Card Management Controller (Phase 26)
 * Credit Card & Debit Card tracking without storing sensitive CVV, PIN, or full card numbers.
 */

// GET /api/v1/cards
const getCards = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const cards = await prisma.card.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    let totalLimit = 0;
    let totalOutstanding = 0;

    const formattedCards = cards.map(c => {
      const limit = c.creditLimit ? parseFloat(c.creditLimit) : 0;
      const outstanding = parseFloat(c.outstandingAmount || 0);
      const minDue = c.minimumDue ? parseFloat(c.minimumDue) : 0;
      const utilization = limit > 0 ? Math.round((outstanding / limit) * 10000) / 100 : 0;

      if (c.cardType === 'CREDIT') {
        totalLimit += limit;
        totalOutstanding += outstanding;
      }

      return {
        id: c.id,
        cardNickname: c.cardNickname,
        cardType: c.cardType,
        issuer: c.issuer,
        maskedNumber: `•••• •••• •••• ${c.lastFourDigits}`,
        lastFourDigits: c.lastFourDigits,
        creditLimit: limit,
        formattedLimit: formatINR(limit),
        outstandingAmount: outstanding,
        formattedOutstanding: formatINR(outstanding),
        minimumDue: minDue,
        formattedMinimumDue: formatINR(minDue),
        billingCycleDay: c.billingCycleDay,
        dueDate: formatDateOnly(c.dueDate),
        rewardCategory: c.rewardCategory || 'General',
        utilizationPct: utilization,
        utilizationSeverity: utilization > 50 ? 'HIGH' : utilization > 30 ? 'MODERATE' : 'HEALTHY',
        createdAt: c.createdAt,
      };
    });

    const overallUtilization = totalLimit > 0 ? Math.round((totalOutstanding / totalLimit) * 10000) / 100 : 0;

    return res.status(200).json({
      success: true,
      data: {
        cards: formattedCards,
        summary: {
          totalCards: cards.length,
          creditCardsCount: cards.filter(c => c.cardType === 'CREDIT').length,
          debitCardsCount: cards.filter(c => c.cardType === 'DEBIT').length,
          totalCreditLimit: totalLimit,
          formattedTotalCreditLimit: formatINR(totalLimit),
          totalOutstandingBalance: totalOutstanding,
          formattedTotalOutstanding: formatINR(totalOutstanding),
          overallUtilizationPct: overallUtilization,
          utilizationStatus: overallUtilization > 50 ? 'HIGH_RISK' : overallUtilization > 30 ? 'ATTENTION_NEEDED' : 'HEALTHY',
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/cards
const createCard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      cardNickname,
      cardType = 'CREDIT',
      issuer,
      lastFourDigits,
      creditLimit,
      outstandingAmount = 0,
      minimumDue = 0,
      billingCycleDay,
      dueDate,
      rewardCategory,
    } = req.body;

    if (!cardNickname || !issuer || !lastFourDigits) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Card nickname, issuer, and last 4 digits are required.' },
      });
    }

    const cleanDigits = String(lastFourDigits).trim().replace(/\D/g, '');
    if (cleanDigits.length !== 4) {
      return res.status(400).json({
        success: false,
        error: { code: 'SECURITY_VALIDATION_ERROR', message: 'Only provide the last 4 digits of the card. NEVER enter full card numbers, CVV, or PIN.' },
      });
    }

    // Explicit security check: ensure no CVV or PIN in request payload
    if (req.body.cvv || req.body.cvc || req.body.pin || req.body.securityCode) {
      return res.status(400).json({
        success: false,
        error: { code: 'SECURITY_VIOLATION', message: 'Card security codes (CVV/PIN) are strictly prohibited and never stored.' },
      });
    }

    const newCard = await prisma.card.create({
      data: {
        userId,
        cardNickname: cardNickname.trim(),
        cardType: cardType.toUpperCase() === 'DEBIT' ? 'DEBIT' : 'CREDIT',
        issuer: issuer.trim(),
        lastFourDigits: cleanDigits,
        creditLimit: creditLimit ? parseFloat(creditLimit) : null,
        outstandingAmount: parseFloat(outstandingAmount || 0),
        minimumDue: minimumDue ? parseFloat(minimumDue) : null,
        billingCycleDay: billingCycleDay ? parseInt(billingCycleDay, 10) : null,
        dueDate: dueDate ? parseDateOnly(dueDate, 'dueDate') : null,
        rewardCategory: rewardCategory ? rewardCategory.trim() : null,
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        id: newCard.id,
        cardNickname: newCard.cardNickname,
        cardType: newCard.cardType,
        issuer: newCard.issuer,
        lastFourDigits: newCard.lastFourDigits,
        creditLimit: newCard.creditLimit ? parseFloat(newCard.creditLimit) : null,
        outstandingAmount: parseFloat(newCard.outstandingAmount),
        createdAt: newCard.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    next(error);
  }
};

// GET /api/v1/cards/:id
const getCard = async (req, res, next) => {
  try {
    const card = await prisma.card.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!card) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Card not found or access denied.' },
      });
    }

    return res.status(200).json({
      success: true,
      data: { ...card, dueDate: formatDateOnly(card.dueDate) },
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/cards/:id
const updateCard = async (req, res, next) => {
  try {
    const card = await prisma.card.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!card) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Card not found or access denied.' },
      });
    }

    const {
      cardNickname,
      outstandingAmount,
      minimumDue,
      creditLimit,
      dueDate,
      billingCycleDay,
      rewardCategory,
    } = req.body;

    const updated = await prisma.card.update({
      where: { id: card.id },
      data: {
        ...(cardNickname && { cardNickname: cardNickname.trim() }),
        ...(outstandingAmount !== undefined && { outstandingAmount: parseFloat(outstandingAmount) }),
        ...(minimumDue !== undefined && { minimumDue: parseFloat(minimumDue) }),
        ...(creditLimit !== undefined && { creditLimit: parseFloat(creditLimit) }),
        ...(dueDate && { dueDate: parseDateOnly(dueDate, 'dueDate') }),
        ...(billingCycleDay !== undefined && { billingCycleDay: parseInt(billingCycleDay, 10) }),
        ...(rewardCategory && { rewardCategory: rewardCategory.trim() }),
      },
    });

    return res.status(200).json({
      success: true,
      data: { ...updated, dueDate: formatDateOnly(updated.dueDate) },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    next(error);
  }
};

// DELETE /api/v1/cards/:id
const deleteCard = async (req, res, next) => {
  try {
    const card = await prisma.card.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!card) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Card not found or access denied.' },
      });
    }

    await prisma.card.delete({ where: { id: card.id } });
    return res.status(200).json({ success: true, message: 'Card successfully removed.' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCards,
  createCard,
  getCard,
  updateCard,
  deleteCard,
};
