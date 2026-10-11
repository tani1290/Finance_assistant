/**
 * FCM Token Controller
 * FinPro — Handles device FCM token registration and push notification dispatch.
 */

const prisma = require('../config/database');
const fcmService = require('../services/fcmService');

/**
 * POST /api/v1/notifications/fcm-token
 * Register or update the FCM token for the authenticated user's device.
 * Body: { fcmToken: string, deviceId?: string, platform?: 'android' | 'ios' }
 */
const registerFcmToken = async (req, res, next) => {
  try {
    const { fcmToken, deviceId, platform = 'android' } = req.body;
    const userId = req.user.id;

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'fcmToken is required.' },
      });
    }

    // Upsert the FCM token — one token per deviceId, or update by userId if no deviceId
    const key = deviceId
      ? { userId_deviceId: { userId, deviceId } }
      : undefined;

    let record;
    if (key) {
      record = await prisma.fcmToken.upsert({
        where: key,
        update: { token: fcmToken, platform, updatedAt: new Date() },
        create: { userId, token: fcmToken, deviceId, platform },
      });
    } else {
      // Fallback: delete existing tokens for user and create fresh
      await prisma.fcmToken.deleteMany({ where: { userId } });
      record = await prisma.fcmToken.create({
        data: { userId, token: fcmToken, deviceId: deviceId || 'default', platform },
      });
    }

    res.json({
      success: true,
      message: 'FCM token registered successfully.',
      data: { id: record.id, platform: record.platform },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/notifications/fcm-token
 * Remove FCM token on logout.
 * Body: { fcmToken?: string } — if omitted, removes all tokens for user.
 */
const removeFcmToken = async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user.id;

    if (fcmToken) {
      await prisma.fcmToken.deleteMany({ where: { userId, token: fcmToken } });
    } else {
      await prisma.fcmToken.deleteMany({ where: { userId } });
    }

    res.json({ success: true, message: 'FCM token removed.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/notifications/test-push  (dev/debug only)
 * Send a test push to the calling user's registered devices.
 */
const sendTestPush = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tokens = await prisma.fcmToken.findMany({ where: { userId } });

    if (!tokens.length) {
      return res.status(404).json({
        success: false,
        error: { code: 'NO_TOKENS', message: 'No FCM tokens registered for this user.' },
      });
    }

    const results = await Promise.all(
      tokens.map((t) =>
        fcmService.sendToDevice(
          t.token,
          { title: '🔔 FinPro Test', body: 'Push notifications are working!' },
          { screen: 'dashboard', test: 'true' }
        )
      )
    );

    res.json({ success: true, message: 'Test push sent.', results });
  } catch (error) {
    next(error);
  }
};

module.exports = { registerFcmToken, removeFcmToken, sendTestPush };
