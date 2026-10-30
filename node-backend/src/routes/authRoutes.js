const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController');

router.get('/config', auth.getAuthConfig);
router.post('/register', auth.register);
router.post('/login', auth.login);
router.post('/google', auth.googleLogin);
router.post('/google/link', require('../middleware/auth').authenticate, auth.linkGoogle);
router.post('/refresh', auth.refresh);
router.post('/logout', auth.logout);
router.get('/me', require('../middleware/auth').authenticate, auth.getMe);
router.get('/profile', require('../middleware/auth').authenticate, auth.getMe);
router.patch('/profile', require('../middleware/auth').authenticate, auth.updateProfile);
router.delete('/account', require('../middleware/auth').authenticate, auth.deleteAccount);

module.exports = router;
