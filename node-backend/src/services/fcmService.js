/**
 * Firebase Cloud Messaging (FCM) Service
 * FinPro — Personal Finance & Investment Platform
 *
 * Sends push notifications to Android/iOS devices via Firebase Admin SDK.
 * Gracefully degrades when Firebase credentials are not configured.
 */

let admin = null;
let isInitialized = false;

/**
 * Lazily initialise Firebase Admin SDK.
 * Uses FIREBASE_SERVICE_ACCOUNT_JSON env var (JSON string of service account key).
 */
const initFirebase = () => {
  if (isInitialized) return isInitialized;

  try {
    admin = require('firebase-admin');

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson || serviceAccountJson === 'YOUR_FIREBASE_SERVICE_ACCOUNT_JSON') {
      console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT_JSON not set — push notifications disabled.');
      isInitialized = false;
      return false;
    }

    const serviceAccount = JSON.parse(serviceAccountJson);

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    console.log('[FCM] Firebase Admin SDK initialized ✓');
    isInitialized = true;
    return true;
  } catch (err) {
    console.error('[FCM] Failed to initialize Firebase Admin SDK:', err.message);
    isInitialized = false;
    return false;
  }
};

/**
 * Send a push notification to a single FCM token.
 * @param {string} fcmToken - The device FCM registration token
 * @param {object} notification - { title, body }
 * @param {object} data - Optional key-value data payload
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendToDevice = async (fcmToken, notification, data = {}) => {
  if (!initFirebase()) {
    return { success: false, error: 'FCM not configured' };
  }

  if (!fcmToken) {
    return { success: false, error: 'No FCM token provided' };
  }

  try {
    const message = {
      token: fcmToken,
      notification: {
        title: notification.title || 'FinPro',
        body: notification.body || '',
      },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: {
          icon: 'ic_notification',
          color: '#5B6EF5',
          channelId: 'finpro_transactions',
          sound: 'default',
        },
      },
    };

    const messageId = await admin.messaging().send(message);
    return { success: true, messageId };
  } catch (err) {
    console.error('[FCM] sendToDevice error:', err.message);
    // Token is invalid/expired — caller should remove it from DB
    if (err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token') {
      return { success: false, error: 'INVALID_TOKEN', shouldRemoveToken: true };
    }
    return { success: false, error: err.message };
  }
};

/**
 * Send a push notification to multiple FCM tokens (batch, max 500).
 * @param {string[]} fcmTokens
 * @param {object} notification - { title, body }
 * @param {object} data
 */
const sendToMultiple = async (fcmTokens, notification, data = {}) => {
  if (!initFirebase()) return { success: false, error: 'FCM not configured' };
  if (!fcmTokens?.length) return { success: false, error: 'No FCM tokens provided' };

  try {
    const message = {
      notification: {
        title: notification.title || 'FinPro',
        body: notification.body || '',
      },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: {
          icon: 'ic_notification',
          color: '#5B6EF5',
          channelId: 'finpro_transactions',
          sound: 'default',
        },
      },
      tokens: fcmTokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (err) {
    console.error('[FCM] sendToMultiple error:', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Send a transaction alert push notification.
 * @param {string} fcmToken - Device FCM token
 * @param {object} tx - Transaction object { amount, merchantName, transactionType, category }
 */
const sendTransactionAlert = async (fcmToken, tx) => {
  if (!fcmToken) return { success: false, error: 'No token' };

  const emoji = tx.transactionType === 'EXPENSE' ? '💸' : '💰';
  const typeLabel = tx.transactionType === 'EXPENSE' ? 'Spent' : 'Received';
  const amount = parseFloat(tx.amount).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

  return sendToDevice(
    fcmToken,
    {
      title: `${emoji} ${typeLabel} ${amount}`,
      body: `${tx.merchantName || tx.description || 'Transaction'} · ${tx.category || 'Uncategorised'}`,
    },
    {
      transactionId: tx.id || '',
      type: tx.transactionType || '',
      amount: String(tx.amount),
      screen: 'transactions',
    }
  );
};

/**
 * Send a budget alert push notification.
 * @param {string} fcmToken
 * @param {object} budget - { categoryName, percentage, remaining }
 */
const sendBudgetAlert = async (fcmToken, budget) => {
  if (!fcmToken) return { success: false, error: 'No token' };

  const exceeded = budget.percentage >= 100;
  return sendToDevice(
    fcmToken,
    {
      title: exceeded
        ? `🚨 Budget Exceeded: ${budget.categoryName}`
        : `⚠️ Budget Alert: ${budget.categoryName} at ${Math.round(budget.percentage)}%`,
      body: exceeded
        ? `You've exceeded your ${budget.categoryName} budget this month.`
        : `₹${Number(budget.remaining).toLocaleString('en-IN')} remaining in your ${budget.categoryName} budget.`,
    },
    { screen: 'budget', category: budget.categoryName || '' }
  );
};

/**
 * Verify a Firebase ID token (for Firebase Auth login flow).
 * Returns decoded token payload or throws.
 */
const verifyIdToken = async (idToken) => {
  if (!initFirebase()) {
    throw new Error('Firebase not initialized');
  }
  return admin.auth().verifyIdToken(idToken);
};

module.exports = {
  sendToDevice,
  sendToMultiple,
  sendTransactionAlert,
  sendBudgetAlert,
  verifyIdToken,
  isFirebaseEnabled: () => initFirebase(),
};
