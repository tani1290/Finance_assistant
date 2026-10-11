/**
 * Notification Routes — FCM + In-App Alerts
 * FinPro
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { registerFcmToken, removeFcmToken, sendTestPush } = require('../controllers/fcmController');

// FCM Device Token management
router.post('/fcm-token', authenticate, registerFcmToken);
router.delete('/fcm-token', authenticate, removeFcmToken);

// Test push (only in non-production or debug builds)
router.post('/test-push', authenticate, sendTestPush);

module.exports = router;
