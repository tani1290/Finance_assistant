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
    // Expose per-token failures (never log tokens) so the retry queue can retry
    // only the failed devices and drop permanently invalid registrations.
    const failures = [];
    response.responses.forEach((result, index) => {
      if (!result.success) {
        failures.push({
          token: fcmTokens[index],
          code: result.error?.code || 'FCM_ERROR',
          message: result.error?.message || '',
        });
      }
    });
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      failures,
    };
  } catch (err) {
    console.error('[FCM] sendToMultiple error:', err.message);
    return { success: false, error: err.message };
  }
};

module.exports = {
  sendToDevice,
  sendToMultiple,
};
