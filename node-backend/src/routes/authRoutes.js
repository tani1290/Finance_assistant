const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController');

router.post('/register', auth.register);
router.post('/login', auth.login);
router.post('/refresh', auth.refresh);
router.post('/logout', auth.logout);
router.get('/me', require('../middleware/auth').authenticate, auth.getMe);
router.get('/profile', require('../middleware/auth').authenticate, auth.getMe);
router.patch('/profile', require('../middleware/auth').authenticate, auth.updateProfile);
router.get('/providers', auth.getAuthProviders);
router.get('/google', auth.googleAuthRedirect);
router.get('/google/callback', auth.googleAuthCallback);
router.post('/google/token', auth.googleAuthWithToken);
router.get('/seed-demo', auth.seedDemo);
router.post('/seed-demo', auth.seedDemo);

module.exports = router;
