/**
 * FinPro — AI action confirmation gate.
 *
 * Anything the AI can do that changes money or stored data goes through a
 * proposal:
 *
 *   model/parser -> proposal (no writes) -> user confirms -> execute once
 *
 * The client only ever sees a random 256-bit token. The database stores a
 * SHA-256 hash. Claiming a proposal is one conditional UPDATE
 * (`status = PENDING` + not expired) that moves it to `EXECUTING`.
 * The action then ends in `COMPLETED` or `FAILED`. A consumed token is never
 * returned to `PENDING`, so replay, cross-user use, post-expiry execution and
 * concurrent double-execution all fail closed.
 */

'use strict';

const crypto = require('crypto');
const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');

const TOKEN_TTL_MS = (() => {
  const raw = Number(process.env.AI_ACTION_TOKEN_TTL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 5 * 60 * 1000;
  // Keep the window short enough that a stale proposal cannot linger.
  return Math.min(Math.max(raw, 30 * 1000), 15 * 60 * 1000);
})();

const READ_ONLY_PREFIXES = ['get_', 'list_', 'analyse_', 'analyze_'];
const TOKEN_RE = /^[a-f0-9]{64}$/i;

/** Read-only tools may run inline. Everything else requires confirmation. */
function isMutatingTool(toolName) {
  const name = String(toolName || '');
  if (!name) return true;
  return !READ_ONLY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

const TOOL_LABELS = {
  create_transaction: 'Create a transaction',
  update_transaction: 'Update a transaction',
  delete_transaction: 'Delete a transaction',
  create_goal: 'Create a financial goal',
  update_goal: 'Update a financial goal',
  add_goal_contribution: 'Add money to a goal',
  create_budget: 'Create a budget',
  update_budget: 'Update a budget',
  create_loan: 'Record a loan',
  update_loan: 'Update a loan',
  create_insurance_policy: 'Add an insurance policy',
  update_insurance_policy: 'Update an insurance policy',
  create_subscription: 'Add a subscription',
  update_subscription: 'Update a subscription',
  create_calendar_event: 'Create a calendar event',
  confirm_pending_sms: 'Confirm a pending SMS transaction',
  reject_pending_sms: 'Reject a pending SMS transaction',
  ocr_import_transactions: 'Import transactions from a receipt',
  bulk_import_transactions: 'Bulk-import transactions',
  transfer_between_accounts: 'Transfer money between accounts',
  create_account: 'Open a new account',
  update_account: 'Update an account',
};

const LEGACY_LABELS = {
  ADD_TRANSACTION: 'Record a transaction from your message',
  DELETE_TRANSACTION: 'Delete a transaction from your message',
  EDIT_TRANSACTION: 'Edit a transaction from your message',
};

function humanizeTool(toolName) {
  return String(toolName || 'action')
    .replace(/^legacy:/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const MONEY_KEYS = new Set([
  'amount', 'balance', 'cost', 'premium', 'coverageAmount', 'principalAmount',
  'emiAmount', 'outstandingBalance', 'targetAmount', 'currentAmount',
  'monthlyLimit', 'monthlyContribution', 'salary', 'value',
]);

/** Render the exact arguments the user is approving, minus secrets. */
function summarizeArgs(args = {}) {
  const entries = Object.entries(args || {}).filter(([key]) => {
    const k = String(key);
    if (/token|password|secret|authorization|cookie/i.test(k)) return false;
    const v = args[key];
    return v !== undefined && v !== null && v !== '';
  });
  if (entries.length === 0) return [];
  return entries.slice(0, 8).map(([key, value]) => {
    let shown;
    if (MONEY_KEYS.has(key) && Number.isFinite(Number(value))) {
      shown = formatINR(Number(value));
    } else if (typeof value === 'object') {
      shown = JSON.stringify(value);
    } else {
      shown = String(value);
    }
    if (shown.length > 160) shown = `${shown.slice(0, 157)}...`;
    return `- **${key}:** ${shown}`;
  });
}

function describeAction(toolName, args = {}) {
  if (String(toolName).startsWith('legacy:')) {
    const intent = String(toolName).slice('legacy:'.length);
    return LEGACY_LABELS[intent] || `Run ${humanizeTool(intent)}`;
  }
  return TOOL_LABELS[toolName] || humanizeTool(toolName);
}

function buildProposalMessage(description, args, expiresAt) {
  const detail = summarizeArgs(args);
  const expiry = new Date(expiresAt).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });
  return [
    '### Confirmation required',
    `**${description}**`,
    detail.length ? detail.join('\n') : '',
    '',
    'Nothing has been changed yet. Press **Confirm** to apply this change, or **Cancel** to discard it.',
    `_This request expires at ${expiry} IST and can be used once._`,
  ].filter(Boolean).join('\n');
}

/**
 * Create a pending proposal. Returns the plaintext token exactly once.
 */
async function createProposal({ userId, toolName, args = {}, description }) {
  if (!userId) throw new Error('createProposal requires a userId');
  if (!toolName) throw new Error('createProposal requires a toolName');

  let safeArgs;
  try {
    // Normalise to plain JSON: strips undefined values and protects Prisma's
    // Json input from class instances.
    safeArgs = JSON.parse(JSON.stringify(args || {}));
  } catch (_) {
    safeArgs = { note: 'arguments could not be serialized' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const label = description || describeAction(toolName, safeArgs);

  const proposal = await prisma.aiActionProposal.create({
    data: {
      userId,
      toolName,
      args: safeArgs,
      description: label,
      tokenHash,
      status: 'PENDING',
      expiresAt,
    },
  });

  return {
    ok: true,
    token,
    proposal,
    message: buildProposalMessage(label, safeArgs, expiresAt),
    confirmation: {
      token,
      id: proposal.id,
      toolName,
      description: label,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: Math.round(TOKEN_TTL_MS / 1000),
    },
  };
}

function failure(status, code, message, extra = {}) {
  return {
    ok: false,
    status,
    error: { code, message, ...extra },
  };
}

function normalizeToken(token) {
  const value = String(token || '').trim();
  return TOKEN_RE.test(value) ? value.toLowerCase() : null;
}

/**
 * Explain why a token cannot be executed without ever making it usable again.
 * A token that may have reached the mutation is never marked retryable.
 */
function resolvedFailure(proposal) {
  const state = String(proposal?.status || 'UNKNOWN').toUpperCase();

  if (state === 'EXECUTING') {
    return failure(
      409,
      'ACTION_IN_PROGRESS',
      'This action is already being applied. Do not retry; check your records first.',
      { executionState: 'EXECUTING', retryable: false }
    );
  }
  if (state === 'COMPLETED' || state === 'CONFIRMED') {
    return failure(
      409,
      'ACTION_ALREADY_COMPLETED',
      'This action was already completed. It will not be run again.',
      { executionState: 'COMPLETED', retryable: false }
    );
  }
  if (state === 'FAILED') {
    return failure(
      409,
      'ACTION_ALREADY_FAILED',
      'This action already failed and cannot be retried with the same confirmation. Check your records, then prepare a new request if needed.',
      { executionState: 'FAILED', retryable: false }
    );
  }
  if (state === 'EXPIRED') {
    return failure(
      410,
      'ACTION_EXPIRED',
      'This confirmation request has expired. Ask again to prepare a new one.',
      { executionState: 'EXPIRED', retryable: false }
    );
  }
  if (state === 'CANCELLED') {
    return failure(
      409,
      'ACTION_ALREADY_CANCELLED',
      'This action was cancelled and will not be run.',
      { executionState: 'CANCELLED', retryable: false }
    );
  }
  return failure(
    409,
    'ACTION_ALREADY_RESOLVED',
    'This confirmation request has already been resolved.',
    { executionState: state, retryable: false }
  );
}

/**
 * Atomically claim a pending proposal and move it to EXECUTING.
 *
 * The caller runs the mutation only after this returns ok:true. The conditional
 * update is the concurrency boundary: exactly one request can move a token out
 * of PENDING, so two clicks cannot execute the same mutation twice. Once a
 * token is EXECUTING it can never return to PENDING, even if the mutation fails.
 */
async function beginExecution(userId, token) {
  const normalized = normalizeToken(token);
  if (!normalized) return failure(400, 'INVALID_ACTION_TOKEN', 'A valid confirmation token is required.');

  const tokenHash = sha256(normalized);
  const proposal = await prisma.aiActionProposal.findFirst({
    where: { tokenHash, userId },
  });
  if (!proposal) {
    // Do not reveal whether the token exists for another user.
    return failure(404, 'ACTION_NOT_FOUND', 'This confirmation request was not found.');
  }
  if (proposal.status !== 'PENDING') return resolvedFailure(proposal);

  const now = new Date();
  if (new Date(proposal.expiresAt).getTime() <= now.getTime()) {
    const expired = await prisma.aiActionProposal.updateMany({
      where: { id: proposal.id, userId, status: 'PENDING' },
      data: { status: 'EXPIRED', resolvedAt: now, retryable: false },
    });
    if (expired.count === 1) {
      return failure(
        410,
        'ACTION_EXPIRED',
        'This confirmation request has expired. Ask again to prepare a new one.',
        { executionState: 'EXPIRED', retryable: false }
      );
    }
    // Another request won the race (confirmed, cancelled or expired it).
    const current = await prisma.aiActionProposal.findFirst({ where: { id: proposal.id, userId } });
    return current ? resolvedFailure(current) : resolvedFailure(proposal);
  }

  const started = await prisma.aiActionProposal.updateMany({
    where: {
      id: proposal.id,
      userId,
      status: 'PENDING',
      expiresAt: { gt: now },
    },
    data: {
      status: 'EXECUTING',
      executionStartedAt: now,
      attempts: { increment: 1 },
      resolvedAt: null,
      resultSummary: null,
      lastError: null,
      retryable: false,
    },
  });

  if (started.count !== 1) {
    const current = await prisma.aiActionProposal.findFirst({ where: { id: proposal.id, userId } });
    return current ? resolvedFailure(current) : resolvedFailure(proposal);
  }

  return {
    ok: true,
    proposal: {
      ...proposal,
      status: 'EXECUTING',
      executionStartedAt: now,
      attempts: Number(proposal.attempts || 0) + 1,
      retryable: false,
    },
  };
}

/** Backwards-compatible name for the pre-Phase-4 call site. */
const consumeProposal = beginExecution;

/** Mark an action as successfully applied. This never reopens the token. */
async function completeProposal(proposalId, summary) {
  const completed = await prisma.aiActionProposal.updateMany({
    where: { id: proposalId, status: 'EXECUTING' },
    data: {
      status: 'COMPLETED',
      resolvedAt: new Date(),
      resultSummary: String(summary || '').slice(0, 2000),
      lastError: null,
      retryable: false,
    },
  });
  if (completed.count !== 1) {
    console.error('[AI-CONFIRM] Executed action could not be marked COMPLETED:', proposalId);
    return false;
  }
  return true;
}

/**
 * Mark a failed action as terminal. `retryable` is recorded for audit but the
 * token remains unusable because execution may already have touched data.
 */
async function failProposal(proposalId, summary, { retryable = false } = {}) {
  const message = String(summary || 'Action failed.').slice(0, 2000);
  const failed = await prisma.aiActionProposal.updateMany({
    where: { id: proposalId, status: 'EXECUTING' },
    data: {
      status: 'FAILED',
      resolvedAt: new Date(),
      resultSummary: message,
      lastError: message,
      retryable: Boolean(retryable),
    },
  });
  if (failed.count !== 1) {
    console.error('[AI-CONFIRM] Failed action could not be marked FAILED:', proposalId);
    return false;
  }
  return true;
}

/** Cancel a pending proposal without executing it. Idempotent for the owner. */
async function cancelProposal(userId, token) {
  const normalized = normalizeToken(token);
  if (!normalized) return failure(400, 'INVALID_ACTION_TOKEN', 'A valid confirmation token is required.');

  const tokenHash = sha256(normalized);
  const proposal = await prisma.aiActionProposal.findFirst({
    where: { tokenHash, userId },
  });
  if (!proposal) return failure(404, 'ACTION_NOT_FOUND', 'This confirmation request was not found.');
  if (proposal.status === 'CANCELLED') return { ok: true, alreadyCancelled: true, proposal };
  if (proposal.status !== 'PENDING') return resolvedFailure(proposal);

  const now = new Date();
  const cancelled = await prisma.aiActionProposal.updateMany({
    where: { id: proposal.id, userId, status: 'PENDING' },
    data: { status: 'CANCELLED', resolvedAt: now, retryable: false },
  });
  if (cancelled.count !== 1) {
    const current = await prisma.aiActionProposal.findFirst({ where: { id: proposal.id, userId } });
    return current ? resolvedFailure(current) : resolvedFailure(proposal);
  }
  return { ok: true, proposal };
}

/**
 * Backwards-compatible audit helper. It may only annotate a terminal proposal;
 * it can never attach a result to PENDING/EXECUTING or reopen a token.
 */
async function recordResult(proposalId, summary) {
  if (!proposalId) return;
  try {
    await prisma.aiActionProposal.updateMany({
      where: { id: proposalId, status: { in: ['COMPLETED', 'FAILED', 'CONFIRMED'] } },
      data: { resultSummary: String(summary || '').slice(0, 2000) },
    });
  } catch (err) {
    console.warn('[AI-CONFIRM] Could not record result:', err.message);
  }
}

/**
 * Read the current state of a proposal without changing it.
 *
 * This exists for one situation: the client sent a confirmation and the
 * network dropped the answer. The client then cannot know whether the
 * mutation was applied. Asking the server resolves the ambiguity honestly
 * instead of guessing ("nothing was changed") or blindly retrying (which
 * could duplicate a committed mutation).
 *
 * The token is only ever accepted for its owner, exactly like the confirm
 * endpoint.
 */
async function getProposalStatus(userId, token) {
  const normalized = normalizeToken(token);
  if (!normalized) return failure(400, 'INVALID_ACTION_TOKEN', 'A valid confirmation token is required.');

  const tokenHash = sha256(normalized);
  const proposal = await prisma.aiActionProposal.findFirst({
    where: { tokenHash, userId },
  });
  if (!proposal) {
    return failure(404, 'ACTION_NOT_FOUND', 'This confirmation request was not found.');
  }

  let state = String(proposal.status || 'UNKNOWN').toUpperCase();
  const expired =
    state === 'PENDING' && new Date(proposal.expiresAt).getTime() <= Date.now();
  if (expired) state = 'EXPIRED';

  const executed = state === 'COMPLETED' || state === 'CONFIRMED';
  const inProgress = state === 'EXECUTING';

  return {
    ok: true,
    status: {
      toolName: proposal.toolName,
      description: proposal.description,
      status: state,
      executionState: state,
      executed,
      // Only a proposal that provably never started may be retried.
      retryable: state === 'PENDING' && !expired,
      applied: executed,
      outcomeKnown: executed || state === 'FAILED' || state === 'CANCELLED' || expired,
      expiresAt: new Date(proposal.expiresAt).toISOString(),
      createdAt: new Date(proposal.createdAt).toISOString(),
      resolvedAt: proposal.resolvedAt ? new Date(proposal.resolvedAt).toISOString() : null,
      result: proposal.resultSummary ? String(proposal.resultSummary).slice(0, 300) : null,
    },
  };
}

module.exports = {
  TOKEN_TTL_MS,
  isMutatingTool,
  describeAction,
  createProposal,
  beginExecution,
  consumeProposal,
  completeProposal,
  failProposal,
  cancelProposal,
  getProposalStatus,
  recordResult,
  buildProposalMessage,
};
