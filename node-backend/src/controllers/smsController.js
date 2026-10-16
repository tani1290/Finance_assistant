const prisma = require('../config/database');
const smsParserService = require('../services/smsParserService');
const fcmService = require('../services/fcmService');
const realtime = require('../services/realtimeService');

/**
 * Controller for Bank SMS Ingestion, Pending Review, and Confirmation
 * Conforms to Master Engineering Directive Sections 4, 7, 8, 9.
 */

/** Which device initiated this action (web | mobile | ai). */
const deviceSource = (req) => String(req.headers['x-client'] || 'server');

// Ingest a single SMS message
exports.ingestSms = async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageText, sender, rawMessageHash } = req.body;

    if (!messageText || typeof messageText !== 'string' || messageText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'Valid messageText is required'
      });
    }

    // 1. Parse and classify
    const parsed = await smsParserService.parseMessage(messageText, sender, userId);

    if (!parsed.isTransaction) {
      return res.status(422).json({
        success: false,
        error: 'NON_TRANSACTION_MESSAGE',
        classificationType: parsed.classificationType,
        message: parsed.rejectionReason || 'Message was classified as a non-transaction',
        rawMessageHash: parsed.rawMessageHash
      });
    }

    // 2. Check for duplicate
    const dupCheck = await smsParserService.checkDuplicate(userId, parsed);
    if (dupCheck.isDuplicate && dupCheck.existingPendingId) {
      return res.status(409).json({
        success: false,
        error: 'DUPLICATE_PENDING_TRANSACTION',
        message: dupCheck.reason,
        existingPendingId: dupCheck.existingPendingId
      });
    }

    // 3. Match user account by accountHint if available
    let matchedAccountId = null;
    if (parsed.accountHint) {
      const account = await prisma.financialAccount.findFirst({
        where: {
          userId,
          isActive: true,
          OR: [
            { accountNumberMasked: { contains: parsed.accountHint, mode: 'insensitive' } },
            { name: { contains: parsed.accountHint, mode: 'insensitive' } }
          ]
        }
      });
      if (account) {
        matchedAccountId = account.id;
      }
    }

    // If no specific account matched, find primary active bank account
    if (!matchedAccountId) {
      const primaryAccount = await prisma.financialAccount.findFirst({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'asc' }
      });
      if (primaryAccount) {
        matchedAccountId = primaryAccount.id;
      }
    }

    // 4. Create pending transaction
    const pendingItem = await prisma.pendingSmsTransaction.create({
      data: {
        userId,
        amount: parsed.amount,
        currency: parsed.currency || 'INR',
        transactionType: parsed.transactionType || 'EXPENSE',
        merchant: parsed.merchant,
        accountHint: parsed.accountHint,
        matchedAccountId,
        suggestedCategory: parsed.suggestedCategory,
        confidence: parsed.categoryConfidence,
        categoryReason: parsed.categoryReason,
        status: 'PENDING',
        source: 'BANK_SMS',
        rawSender: parsed.rawSender,
        rawMessageHash: parsed.rawMessageHash,
        bankReference: parsed.bankReference,
        transactionDate: parsed.transactionDate,
        isDuplicate: dupCheck.isDuplicate,
        duplicateReason: dupCheck.reason || null
      },
      include: {
        matchedAccount: true
      }
    });

    // Realtime: SMS arrived on a device — reflect it on every other device now.
    realtime.publish(userId, 'sms.pending', {
      id: pendingItem.id,
      amount: pendingItem.amount,
      transactionType: pendingItem.transactionType,
      merchant: pendingItem.merchant,
      suggestedCategory: pendingItem.suggestedCategory,
      matchedAccountId: pendingItem.matchedAccountId,
      transactionDate: pendingItem.transactionDate,
      rawSender: pendingItem.rawSender,
    }, { source: deviceSource(req) });

    return res.status(201).json({
      success: true,
      message: 'SMS transaction candidate ingested into pending review',
      data: pendingItem
    });
  } catch (err) {
    console.error('[SMS] Ingestion error:', err);
    return res.status(500).json({
      success: false,
      error: 'INGESTION_ERROR',
      message: 'Failed to ingest SMS candidate'
    });
  }
};

// Batch ingest multiple SMS messages (e.g., initial sync from Android device)
exports.batchIngestSms = async (req, res) => {
  try {
    const userId = req.user.id;
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'messages array is required'
      });
    }

    // Limit batch size to 100 items per request for performance
    const batch = messages.slice(0, 100);
    const results = {
      total: batch.length,
      ingested: 0,
      rejectedNonTx: 0,
      duplicatesSkipped: 0,
      items: []
    };

    // ACID: the batch is one logical unit ("this device's SMS backlog"), so its
    // writes commit atomically — a mid-batch failure rolls the whole backlog
    // back instead of leaving the device half-synced. Parsing runs outside the
    // transaction, and the rawMessageHash duplicate check makes re-sending a
    // failed batch safe.
    await prisma.$transaction(
      async (tx) => {
        for (const msg of batch) {
          const text = typeof msg === 'string' ? msg : msg.messageText || msg.body;
          const sender = typeof msg === 'object' ? msg.sender || msg.address : null;

          if (!text || typeof text !== 'string') continue;

          const parsed = await smsParserService.parseMessage(text, sender, userId);
          if (!parsed.isTransaction) {
            results.rejectedNonTx++;
            continue;
          }

          const dupCheck = await smsParserService.checkDuplicate(userId, parsed);
          if (dupCheck.isDuplicate && dupCheck.existingPendingId) {
            results.duplicatesSkipped++;
            continue;
          }

          // Find account
          let matchedAccountId = null;
          if (parsed.accountHint) {
            const account = await tx.financialAccount.findFirst({
              where: {
                userId,
                isActive: true,
                accountNumberMasked: { contains: parsed.accountHint }
              }
            });
            if (account) matchedAccountId = account.id;
          }

          const item = await tx.pendingSmsTransaction.create({
            data: {
              userId,
              amount: parsed.amount,
              currency: parsed.currency || 'INR',
              transactionType: parsed.transactionType || 'EXPENSE',
              merchant: parsed.merchant,
              accountHint: parsed.accountHint,
              matchedAccountId,
              suggestedCategory: parsed.suggestedCategory,
              confidence: parsed.categoryConfidence,
              categoryReason: parsed.categoryReason,
              status: 'PENDING',
              source: 'BANK_SMS',
              rawSender: parsed.rawSender,
              rawMessageHash: parsed.rawMessageHash,
              bankReference: parsed.bankReference,
              transactionDate: parsed.transactionDate,
              isDuplicate: dupCheck.isDuplicate,
              duplicateReason: dupCheck.reason || null
            }
          });

          results.ingested++;
          results.items.push(item);
        }
      },
      { timeout: 30000, maxWait: 10000 }
    );

    // Realtime: one summary event for the whole batch (cheap, avoids N frames).
    if (results.ingested > 0) {
      realtime.publish(userId, 'sms.pending', {
        batch: true,
        count: results.ingested,
        items: results.items.slice(0, 20).map((it) => ({
          id: it.id,
          amount: it.amount,
          transactionType: it.transactionType,
          merchant: it.merchant,
          suggestedCategory: it.suggestedCategory,
          transactionDate: it.transactionDate,
        })),
      }, { source: deviceSource(req) });
    }

    return res.status(200).json({
      success: true,
      message: `Batch processed: ${results.ingested} ingested, ${results.duplicatesSkipped} duplicates skipped, ${results.rejectedNonTx} non-transactions filtered`,
      data: results
    });
  } catch (err) {
    console.error('[SMS] Batch ingest error:', err);
    return res.status(500).json({
      success: false,
      error: 'BATCH_INGEST_ERROR',
      message: 'Failed to process batch SMS ingestion'
    });
  }
};

// List pending SMS transactions for review
exports.getPendingSms = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status = 'PENDING', page = 1, limit = 50 } = req.query;

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const take = Math.min(100, Math.max(1, parseInt(limit, 10)));

    const where = {
      userId,
      ...(status !== 'ALL' && { status })
    };

    const [items, total] = await Promise.all([
      prisma.pendingSmsTransaction.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        skip,
        take,
        include: {
          matchedAccount: {
            select: {
              id: true,
              name: true,
              institution: true,
              accountType: true,
              balance: true
            }
          }
        }
      }),
      prisma.pendingSmsTransaction.count({ where })
    ]);

    return res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page: parseInt(page, 10),
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (err) {
    console.error('[SMS] Get pending error:', err);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to retrieve pending SMS transactions'
    });
  }
};

// Confirm pending SMS transaction -> commits to canonical Transaction model
exports.confirmPendingSms = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      accountId: overrideAccountId,
      categoryName: overrideCategoryName,
      merchant: overrideMerchant,
      notes: overrideNotes,
      amount: overrideAmount,
      transactionType: overrideType
    } = req.body;

    const pendingItem = await prisma.pendingSmsTransaction.findFirst({
      where: { id, userId }
    });

    if (!pendingItem) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Pending SMS transaction not found or access denied'
      });
    }

    if (pendingItem.status === 'CONFIRMED') {
      return res.status(400).json({
        success: false,
        error: 'ALREADY_CONFIRMED',
        message: 'This transaction has already been confirmed',
        transactionId: pendingItem.confirmedTransactionId
      });
    }

    const finalAmount = overrideAmount !== undefined ? parseFloat(overrideAmount) : parseFloat(pendingItem.amount);
    const finalType = overrideType || pendingItem.transactionType;
    const finalMerchant = overrideMerchant !== undefined ? overrideMerchant : pendingItem.merchant;
    const finalCategoryName = overrideCategoryName || pendingItem.suggestedCategory || 'General';

    // Account resolution
    let targetAccountId = overrideAccountId || pendingItem.matchedAccountId;
    if (!targetAccountId) {
      let defaultAccount = await prisma.financialAccount.findFirst({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'asc' }
      });
      if (!defaultAccount) {
        defaultAccount = await prisma.financialAccount.create({
          data: {
            userId,
            name: 'Primary Bank Account',
            accountType: 'BANK',
            balance: 0,
            currency: 'INR'
          }
        });
      }
      targetAccountId = defaultAccount.id;
    }

    // Perform atomic confirmation inside transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Resolve or create category
      let category = await tx.category.findFirst({
        where: {
          name: { equals: finalCategoryName, mode: 'insensitive' },
          OR: [{ userId }, { userId: null }]
        }
      });

      if (!category) {
        category = await tx.category.create({
          data: {
            name: finalCategoryName,
            userId,
            categoryType: finalType === 'INCOME' ? 'INCOME' : 'EXPENSE'
          }
        });
      }

      // 2. Create canonical Transaction
      const canonicalTx = await tx.transaction.create({
        data: {
          userId,
          accountId: targetAccountId,
          categoryId: category.id,
          amount: finalAmount,
          transactionType: finalType,
          merchant: finalMerchant,
          description: `SMS Txn: ${finalMerchant || 'Merchant'} (Ref: ${pendingItem.bankReference || 'N/A'})`,
          notes: overrideNotes || `Auto-detected via bank SMS from ${pendingItem.rawSender || 'Bank'}`,
          paymentMethod: 'UPI',
          date: pendingItem.transactionDate,
          currency: pendingItem.currency,
          aiCategory: pendingItem.suggestedCategory
        }
      });

      // 3. Update account balance atomically
      const delta = finalType === 'INCOME' ? finalAmount : -finalAmount;
      const updatedAccount = await tx.financialAccount.update({
        where: { id: targetAccountId },
        data: {
          balance: { increment: delta }
        }
      });

      // 4. Record category correction if user altered the suggested category
      if (pendingItem.suggestedCategory && finalCategoryName !== pendingItem.suggestedCategory && finalMerchant) {
        await tx.transactionCategoryCorrection.create({
          data: {
            userId,
            merchant: finalMerchant,
            description: pendingItem.merchant,
            originalCategory: pendingItem.suggestedCategory,
            correctedCategory: finalCategoryName
          }
        });
      }

      // 5. Update pending item status
      const updatedPending = await tx.pendingSmsTransaction.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedTransactionId: canonicalTx.id,
          matchedAccountId: targetAccountId
        }
      });

      return {
        transaction: canonicalTx,
        account: updatedAccount,
        pending: updatedPending
      };
    });

    // Fire FCM push notification to EVERY registered device (non-blocking)
    try {
      const tokenRecords = await prisma.fcmToken.findMany({
        where: { userId },
        select: { token: true },
      });
      const tokens = tokenRecords.map((r) => r.token).filter(Boolean);

      if (tokens.length > 0) {
        const emoji = finalType === 'EXPENSE' ? '💸' : '💰';
        const typeLabel = finalType === 'EXPENSE' ? 'Spent' : 'Received';
        const amountLabel = Number(finalAmount).toLocaleString('en-IN', {
          style: 'currency',
          currency: 'INR',
          maximumFractionDigits: 0,
        });

        fcmService.sendToMultiple(
          tokens,
          {
            title: `${emoji} ${typeLabel} ${amountLabel}`,
            body: `${finalMerchant || result.transaction.description || 'Transaction'} · ${finalCategoryName}`,
          },
          {
            transactionId: result.transaction.id,
            type: finalType,
            amount: String(finalAmount),
            screen: 'transactions',
          }
        ).catch(() => {}); // silently ignore push failures
      }
    } catch (_) {}

    // Realtime: the canonical ledger changed — push to every open tab/device.
    realtime.publish(userId, 'transaction.created', {
      id: result.transaction.id,
      amount: parseFloat(result.transaction.amount),
      transactionType: finalType,
      merchant: finalMerchant,
      category: finalCategoryName,
      accountId: targetAccountId,
      accountBalance: parseFloat(result.account.balance),
      date: result.transaction.date,
      origin: 'sms',
    }, { source: deviceSource(req) });

    realtime.publish(userId, 'sms.confirmed', {
      pendingId: id,
      transactionId: result.transaction.id,
    }, { source: deviceSource(req) });

    return res.status(200).json({
      success: true,
      message: 'Transaction successfully confirmed and added to canonical ledger',
      data: result.transaction,
      accountBalance: parseFloat(result.account.balance)
    });
  } catch (err) {
    console.error('[SMS] Confirm error:', err);
    return res.status(500).json({
      success: false,
      error: 'CONFIRM_ERROR',
      message: 'Failed to confirm transaction'
    });
  }
};

// Reject pending SMS transaction
exports.rejectPendingSms = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const pendingItem = await prisma.pendingSmsTransaction.findFirst({
      where: { id, userId }
    });

    if (!pendingItem) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Pending SMS transaction not found or access denied'
      });
    }

    const updated = await prisma.pendingSmsTransaction.update({
      where: { id },
      data: { status: 'REJECTED' }
    });

    // Realtime: remove the pending item from every other device's review list.
    realtime.publish(userId, 'sms.rejected', {
      pendingId: id,
    }, { source: deviceSource(req) });

    return res.status(200).json({
      success: true,
      message: 'Pending SMS transaction candidate rejected',
      data: updated
    });
  } catch (err) {
    console.error('[SMS] Reject error:', err);
    return res.status(500).json({
      success: false,
      error: 'REJECT_ERROR',
      message: 'Failed to reject pending SMS candidate'
    });
  }
};

// Instant parse preview endpoint (without persisting)
exports.parsePreview = async (req, res) => {
  try {
    const { messageText, sender } = req.body;
    if (!messageText) {
      return res.status(400).json({ success: false, error: 'messageText is required' });
    }

    const result = await smsParserService.parseMessage(messageText, sender, req.user?.id);
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'PARSE_ERROR',
      message: err.message
    });
  }
};
