/**
 * Payment simulator configuration and environment gating.
 *
 * The simulator is a teaching/demo surface: it moves no real money, contacts
 * no payment network and never accepts real card/CVV/UPI credentials. It is
 * enabled by default outside production, but production is a deliberate
 * two-key decision:
 *
 *   PAYMENT_SIMULATOR_ENABLED=true
 *   PAYMENT_SIMULATOR_ALLOW_PRODUCTION=true
 *
 * Both are required in production. Anything else is disabled, so a deployment
 * that forgets to configure it cannot expose synthetic payment endpoints by
 * accident.
 */

'use strict';

const DEFAULT_MAX_PAYMENT = 100000;
const DEFAULT_SEED_AMOUNT = 50000;
const MAX_SEED_AMOUNT = 1000000;

const DISCLAIMER =
  'Synthetic simulator only. No real money moves, no bank/UPI/payment network is contacted, ' +
  'and no real card, CVV or UPI PIN is ever collected. Balances and transactions created here ' +
  'exist only inside this demo account.';

const parseBoolean = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
};

const parsePositiveAmount = (value, fallback, maximum) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.round(n * 100) / 100, maximum);
};

/**
 * Resolve the effective simulator settings for a given environment.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
function getSimulatorConfig(env = process.env) {
  const production = (env.NODE_ENV || 'development') === 'production';

  const explicit = parseBoolean(env.PAYMENT_SIMULATOR_ENABLED);
  const productionOptIn = parseBoolean(env.PAYMENT_SIMULATOR_ALLOW_PRODUCTION) === true;

  // Outside production the simulator defaults to on; inside production it
  // defaults to off and needs both flags.
  const requested = explicit === null ? !production : explicit;
  const enabled = requested && (!production || productionOptIn);

  const maxAmount = parsePositiveAmount(
    env.PAYMENT_SIMULATOR_MAX_AMOUNT,
    DEFAULT_MAX_PAYMENT,
    MAX_SEED_AMOUNT
  );
  const seedAmount = parsePositiveAmount(
    env.PAYMENT_SIMULATOR_SEED_AMOUNT,
    DEFAULT_SEED_AMOUNT,
    MAX_SEED_AMOUNT
  );

  let disabledReason = null;
  if (!requested) disabledReason = 'PAYMENT_SIMULATOR_ENABLED is off for this environment.';
  else if (production && !productionOptIn) {
    disabledReason =
      'The simulator is disabled in production unless PAYMENT_SIMULATOR_ALLOW_PRODUCTION=true.';
  }

  return {
    enabled,
    production,
    maxAmount,
    seedAmount,
    currency: 'INR',
    synthetic: true,
    disclaimer: DISCLAIMER,
    disabledReason,
  };
}

/** True when simulator mutations are allowed right now. */
function isSimulatorEnabled(env = process.env) {
  return getSimulatorConfig(env).enabled;
}

/**
 * Express middleware that refuses every mutating simulator request while the
 * simulator is disabled. Mounted after authentication, so the caller is still
 * identified in logs.
 */
function requireSimulatorEnabled(req, res, next) {
  const config = getSimulatorConfig();
  if (!config.enabled) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'SIMULATOR_DISABLED',
        message: config.disabledReason || 'The payment simulator is disabled in this environment.',
      },
    });
  }
  return next();
}

module.exports = {
  DISCLAIMER,
  getSimulatorConfig,
  isSimulatorEnabled,
  requireSimulatorEnabled,
};
