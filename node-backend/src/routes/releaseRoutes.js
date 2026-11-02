/**
 * Public release routes. Mounted in app.js *before* the authenticated
 * `/api/v1` router so the download centre and pre-login update check work.
 */

'use strict';

const express = require('express');
const releases = require('../controllers/releaseController');

const router = express.Router();

router.get('/', releases.getReleases);
router.get('/latest', releases.getLatest);
router.get('/summary', releases.getSummary);
router.get('/check', releases.checkForUpdate);
router.get('/:version', releases.getRelease);

module.exports = router;
