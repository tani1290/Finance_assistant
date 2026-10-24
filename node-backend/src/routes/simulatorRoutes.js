/**
 * Synthetic payment-simulator routes.
 *
 * Mounted below `router.use(authenticate)` in routes/index.js, so every request
 * is already attributable to a user. `requireSimulatorEnabled` then gates all
 * mutations behind the environment policy while leaving `/status` readable so
 * the UI can explain why the simulator is unavailable.
 */

'use strict';

const express = require('express');
const { requireSimulatorEnabled } = require('../services/simulatorConfig');
const simulator = require('../controllers/simulatorController');

const router = express.Router();

router.get('/status', simulator.getSimulatorStatus);

// Everything below mutates (or exposes) simulated financial state.
router.use(requireSimulatorEnabled);

router.post('/seed', simulator.seedSimulatorFunds);
router.post('/reset', simulator.resetSimulator);

router.get('/payments', simulator.listSimulatedPayments);
router.get('/payments/:id', simulator.getSimulatedPayment);
router.post('/payments', simulator.createSimulatedPayment);
router.post('/payments/:id/confirm', simulator.confirmSimulatedPayment);
router.post('/payments/:id/fail', simulator.failSimulatedPayment);
router.post('/payments/:id/refund', simulator.refundSimulatedPayment);
router.post('/payments/:id/reverse', simulator.reverseSimulatedPayment);

module.exports = router;
