/**
 * Phase 3 — AI confirmation gate regressions.
 *
 * A model response is not consent. These tests prove that:
 *  - mutating tools only create a proposal and never execute inline;
 *  - the client token is random, stored hashed, single-use and user-bound;
 *  - expired / replayed / cross-user / cancelled tokens fail closed;
 *  - the confirm endpoint executes exactly once, and only after consumption;
 *  - the assistant returns the proposal immediately (one change per turn).
 */

process.env.AI_MODEL = 'test-model';
process.env.AI_ASSISTANT_TOTAL_TIMEOUT_MS = '5000';

jest.mock('../config/database', () => {
  const proposals = [];
  let nextId = 1;
  let nextUpdateError = null;

  return {
    __proposals: proposals,
    __reset() {
      proposals.length = 0;
      nextId = 1;
      nextUpdateError = null;
    },
    __failNextUpdate(err) {
      nextUpdateError = err;
    },
    aiActionProposal: {
      create: jest.fn(async ({ data }) => {
        const row = {
          id: `proposal-${nextId++}`,
          ...data,
          resolvedAt: null,
          resultSummary: null,
          executionStartedAt: null,
          attempts: 0,
          lastError: null,
          retryable: false,
          createdAt: new Date(),
        };
        proposals.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }) => {
        return proposals.find((p) =>
          (!where.id || p.id === where.id)
          && (!where.tokenHash || p.tokenHash === where.tokenHash)
          && (!where.userId || p.userId === where.userId)) || null;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        if (nextUpdateError) {
          const err = nextUpdateError;
          nextUpdateError = null;
          throw err;
        }
        let count = 0;
        for (const p of proposals) {
          if (where.id && p.id !== where.id) continue;
          if (where.userId && p.userId !== where.userId) continue;
          if (where.status?.in) {
            if (!where.status.in.includes(p.status)) continue;
          } else if (where.status && p.status !== where.status) continue;
          if (where.expiresAt?.gt && !(new Date(p.expiresAt) > new Date(where.expiresAt.gt))) continue;
          const update = { ...data };
          if (update.attempts && typeof update.attempts === 'object' && update.attempts.increment) {
            update.attempts = Number(p.attempts || 0) + update.attempts.increment;
          }
          Object.assign(p, update);
          count++;
        }
        return { count };
      }),
      update: jest.fn(async ({ where, data }) => {
        const p = proposals.find((x) => x.id === where.id);
        if (!p) throw new Error('proposal not found');
        Object.assign(p, data);
        return p;
      }),
    },
    chatMessage: {
      create: jest.fn(async ({ data }) => data),
    },
  };
});

jest.mock('../services/aiTools', () => ({
  TOOL_MAP: {
    fake_mutate: { execute: jest.fn() },
    get_balance: { execute: jest.fn() },
  },
  DECLARATIONS: [],
  TOOL_LIST: [],
}));

jest.mock('../services/aiService', () => ({
  CANDIDATE_MODELS: [],
  getGeminiClient: jest.fn(),
  getUserFinancialContext: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

const prisma = require('../config/database');
const aiConfirmation = require('../services/aiConfirmationService');
const aiAssistant = require('../services/aiAssistantService');
const { TOOL_MAP } = require('../services/aiTools');
const aiService = require('../services/aiService');
const aiController = require('../controllers/aiController');

const USER_A = 'user-a';
const USER_B = 'user-b';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: req.get('x-user') || USER_A };
    next();
  });
  app.post('/ai/actions/confirm', aiController.resolveAction);
  app.post('/ai/actions/status', aiController.getActionStatus);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

const app = buildApp();

beforeEach(() => {
  prisma.__reset();
  jest.clearAllMocks();
  TOOL_MAP.fake_mutate.execute.mockResolvedValue({ ok: true, response: 'Applied.', data: { id: 'x' } });
  TOOL_MAP.get_balance.execute.mockResolvedValue({ ok: true, summary: 'Balance is ₹100.' });
});

describe('isMutatingTool', () => {
  test('allows only the documented read-only prefixes', () => {
    expect(aiConfirmation.isMutatingTool('get_balance')).toBe(false);
    expect(aiConfirmation.isMutatingTool('list_transactions')).toBe(false);
    expect(aiConfirmation.isMutatingTool('analyse_spending')).toBe(false);
    expect(aiConfirmation.isMutatingTool('analyze_spending')).toBe(false);
  });

  test('fails closed for money-moving, unknown and malformed tool names', () => {
    expect(aiConfirmation.isMutatingTool('create_transaction')).toBe(true);
    expect(aiConfirmation.isMutatingTool('transfer_between_accounts')).toBe(true);
    expect(aiConfirmation.isMutatingTool('getBalance')).toBe(true);
    expect(aiConfirmation.isMutatingTool('')).toBe(true);
    expect(aiConfirmation.isMutatingTool(undefined)).toBe(true);
  });
});

describe('proposal lifecycle', () => {
  test('stores only a hash of a random 256-bit token', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'create_transaction',
      args: { amount: 500, category: 'Food' },
    });

    const stored = prisma.__proposals[0];
    expect(prepared.token).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.tokenHash).not.toBe(prepared.token);
    expect(JSON.stringify(stored)).not.toContain(prepared.token);
    expect(prepared.confirmation.token).toBe(prepared.token);
    expect(prepared.confirmation.description).toMatch(/transaction/i);
    // Money arguments are shown to the user before approval.
    expect(prepared.message).toContain('₹500');
  });

  test('claims a pending token exactly once and moves it to EXECUTING', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: { amount: 1 },
    });

    const first = await aiConfirmation.beginExecution(USER_A, prepared.token);
    expect(first.ok).toBe(true);
    expect(prisma.__proposals[0].status).toBe('EXECUTING');
    expect(prisma.__proposals[0].attempts).toBe(1);
    expect(prisma.__proposals[0].executionStartedAt).toBeInstanceOf(Date);

    const replay = await aiConfirmation.beginExecution(USER_A, prepared.token);
    expect(replay.ok).toBe(false);
    expect(replay.status).toBe(409);
    expect(replay.error.code).toBe('ACTION_IN_PROGRESS');
    expect(replay.error.retryable).toBe(false);

    await aiConfirmation.completeProposal(prisma.__proposals[0].id, 'Applied.');
    const afterCompletion = await aiConfirmation.beginExecution(USER_A, prepared.token);
    expect(afterCompletion.status).toBe(409);
    expect(afterCompletion.error.code).toBe('ACTION_ALREADY_COMPLETED');
  });

  test('a failed action is terminal and cannot be reopened or retried', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });

    const started = await aiConfirmation.beginExecution(USER_A, prepared.token);
    expect(started.ok).toBe(true);
    await aiConfirmation.failProposal(started.proposal.id, 'FAILED: database unavailable');

    expect(prisma.__proposals[0].status).toBe('FAILED');
    expect(prisma.__proposals[0].retryable).toBe(false);
    expect(prisma.__proposals[0].lastError).toContain('database unavailable');

    const retry = await aiConfirmation.beginExecution(USER_A, prepared.token);
    expect(retry.ok).toBe(false);
    expect(retry.status).toBe(409);
    expect(retry.error.code).toBe('ACTION_ALREADY_FAILED');
    expect(retry.error.retryable).toBe(false);
  });

  test('concurrent confirmation cannot execute the same proposal twice', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });

    const [first, second] = await Promise.all([
      aiConfirmation.beginExecution(USER_A, prepared.token),
      aiConfirmation.beginExecution(USER_A, prepared.token),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const rejected = first.ok ? second : first;
    expect(rejected.status).toBe(409);
    expect(rejected.error.code).toBe('ACTION_IN_PROGRESS');
    expect(prisma.__proposals[0].attempts).toBe(1);
  });

  test('a token from another user is not found', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });

    const result = await aiConfirmation.consumeProposal(USER_B, prepared.token);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(prisma.__proposals[0].status).toBe('PENDING');
  });

  test('an expired token is rejected and marked expired', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });
    prisma.__proposals[0].expiresAt = new Date(Date.now() - 1000);

    const result = await aiConfirmation.beginExecution(USER_A, prepared.token);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(410);
    expect(result.error.code).toBe('ACTION_EXPIRED');
    expect(prisma.__proposals[0].status).toBe('EXPIRED');

    // Once expired it cannot be confirmed later.
    const retry = await aiConfirmation.beginExecution(USER_A, prepared.token);
    expect(retry.ok).toBe(false);
    expect(retry.status).toBe(410);
    expect(retry.error.code).toBe('ACTION_EXPIRED');
  });

  test('cancel is idempotent for the owner and blocks confirmation', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });

    const cancelled = await aiConfirmation.cancelProposal(USER_A, prepared.token);
    expect(cancelled.ok).toBe(true);
    expect(prisma.__proposals[0].status).toBe('CANCELLED');

    const again = await aiConfirmation.cancelProposal(USER_A, prepared.token);
    expect(again.ok).toBe(true);
    expect(again.alreadyCancelled).toBe(true);

    const confirm = await aiConfirmation.beginExecution(USER_A, prepared.token);
    expect(confirm.ok).toBe(false);
    expect(confirm.status).toBe(409);
    expect(confirm.error.code).toBe('ACTION_ALREADY_CANCELLED');
  });

  test('malformed tokens are rejected before touching the database', async () => {
    const result = await aiConfirmation.consumeProposal(USER_A, 'yes');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(prisma.aiActionProposal.findFirst).not.toHaveBeenCalled();
  });
});

describe('POST /ai/actions/confirm', () => {
  test('executes the bound action once and returns the result', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: { amount: 750 },
    });

    const res = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: prepared.token, decision: 'CONFIRM' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.executed).toBe(true);
    expect(res.body.data.pendingConfirmation).toBe(false);
    expect(res.body.data.response).toBe('Applied.');
    expect(res.body.data.executionState).toBe('COMPLETED');
    expect(res.body.data.retryable).toBe(false);
    expect(TOOL_MAP.fake_mutate.execute).toHaveBeenCalledTimes(1);
    expect(TOOL_MAP.fake_mutate.execute).toHaveBeenCalledWith(USER_A, { amount: 750 });
    expect(prisma.chatMessage.create).toHaveBeenCalledTimes(1);
    expect(prisma.__proposals[0].status).toBe('COMPLETED');
    expect(prisma.__proposals[0].attempts).toBe(1);
    expect(prisma.__proposals[0].resultSummary).toBe('Applied.');
  });

  test('a replayed token is rejected and the tool is not executed twice', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });

    const first = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: prepared.token });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: prepared.token });

    expect(replay.status).toBe(409);
    expect(replay.body.success).toBe(false);
    expect(replay.body.error.code).toBe('ACTION_ALREADY_COMPLETED');
    expect(replay.body.error.executionState).toBe('COMPLETED');
    expect(replay.body.error.retryable).toBe(false);
    expect(TOOL_MAP.fake_mutate.execute).toHaveBeenCalledTimes(1);
  });

  test('one user cannot confirm another user\'s token', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });

    const res = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_B)
      .send({ token: prepared.token });

    expect(res.status).toBe(404);
    expect(TOOL_MAP.fake_mutate.execute).not.toHaveBeenCalled();
  });

  test('a plain "yes" without a token cannot execute anything', async () => {
    const res = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ decision: 'CONFIRM' });

    expect(res.status).toBe(400);
    expect(TOOL_MAP.fake_mutate.execute).not.toHaveBeenCalled();
  });

  test('rejects an unknown decision value', async () => {
    const res = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: 'a'.repeat(64), decision: 'MAYBE' });

    expect(res.status).toBe(400);
    expect(TOOL_MAP.fake_mutate.execute).not.toHaveBeenCalled();
  });

  test('cancel never executes the action', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });

    const res = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: prepared.token, decision: 'CANCEL' });

    expect(res.status).toBe(200);
    expect(res.body.data.cancelled).toBe(true);
    expect(res.body.data.executionState).toBe('CANCELLED');
    expect(TOOL_MAP.fake_mutate.execute).not.toHaveBeenCalled();
    expect(prisma.__proposals[0].status).toBe('CANCELLED');
  });

  test('concurrent HTTP confirmations execute the mutation exactly once', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });

    const [first, second] = await Promise.all([
      request(app).post('/ai/actions/confirm').set('x-user', USER_A).send({ token: prepared.token }),
      request(app).post('/ai/actions/confirm').set('x-user', USER_A).send({ token: prepared.token }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    expect(TOOL_MAP.fake_mutate.execute).toHaveBeenCalledTimes(1);

    const rejected = first.status === 409 ? first : second;
    expect(['ACTION_IN_PROGRESS', 'ACTION_ALREADY_COMPLETED']).toContain(rejected.body.error.code);
    expect(rejected.body.error.retryable).toBe(false);
    expect(prisma.__proposals[0].status).toBe('COMPLETED');
  });

  test('a thrown execution error is terminal and never claims nothing changed', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });
    TOOL_MAP.fake_mutate.execute.mockRejectedValueOnce(new Error('write timed out'));

    const res = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: prepared.token });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('ACTION_OUTCOME_UNKNOWN');
    expect(res.body.error.executionState).toBe('FAILED');
    expect(res.body.error.retryable).toBe(false);
    expect(res.body.error.message).not.toMatch(/nothing (else )?was changed/i);
    expect(res.body.error.message).toMatch(/check your records/i);
    expect(prisma.__proposals[0].status).toBe('FAILED');

    const retry = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: prepared.token });
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('ACTION_ALREADY_FAILED');
    expect(TOOL_MAP.fake_mutate.execute).toHaveBeenCalledTimes(1);
  });

  test('a rejected tool result is terminal and cannot be replayed', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });
    TOOL_MAP.fake_mutate.execute.mockResolvedValueOnce({ ok: false, error: 'Amount must be positive.' });

    const res = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: prepared.token });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ACTION_REJECTED');
    expect(res.body.error.message).toContain('Amount must be positive.');
    expect(res.body.error.executionState).toBe('FAILED');
    expect(res.body.error.retryable).toBe(false);
    expect(prisma.__proposals[0].status).toBe('FAILED');
  });

  test('a pre-execution database failure leaves the token safely retryable', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });
    prisma.__failNextUpdate(new Error('connection reset'));

    const res = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: prepared.token });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ACTION_START_UNAVAILABLE');
    expect(res.body.error.retryable).toBe(true);
    expect(res.body.error.message).toMatch(/no change was applied/i);
    expect(TOOL_MAP.fake_mutate.execute).not.toHaveBeenCalled();
    expect(prisma.__proposals[0].status).toBe('PENDING');

    const retry = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: prepared.token });
    expect(retry.status).toBe(200);
    expect(TOOL_MAP.fake_mutate.execute).toHaveBeenCalledTimes(1);
  });

  test('a chat-history write failure does not turn an applied action into an error', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });
    prisma.chatMessage.create.mockRejectedValueOnce(new Error('chat table unavailable'));

    const res = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: prepared.token });

    expect(res.status).toBe(200);
    expect(res.body.data.executed).toBe(true);
    expect(res.body.data.executionState).toBe('COMPLETED');
    expect(prisma.__proposals[0].status).toBe('COMPLETED');
    expect(TOOL_MAP.fake_mutate.execute).toHaveBeenCalledTimes(1);
  });

  test('an executing action cannot be cancelled', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });
    const started = await aiConfirmation.beginExecution(USER_A, prepared.token);
    expect(started.ok).toBe(true);

    const res = await request(app)
      .post('/ai/actions/confirm')
      .set('x-user', USER_A)
      .send({ token: prepared.token, decision: 'CANCEL' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACTION_IN_PROGRESS');
    expect(prisma.__proposals[0].status).toBe('EXECUTING');
  });
});

describe('POST /ai/actions/status (read-only probe)', () => {
  test('a pending proposal is reported as not applied and still retryable', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });

    const res = await request(app)
      .post('/ai/actions/status')
      .set('x-user', USER_A)
      .send({ token: prepared.token });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.executed).toBe(false);
    expect(res.body.data.applied).toBe(false);
    expect(res.body.data.retryable).toBe(true);
    expect(res.body.data.outcomeKnown).toBe(false);
    // The probe must not change anything.
    expect(prisma.__proposals[0].status).toBe('PENDING');
    expect(prisma.__proposals[0].attempts).toBe(0);
    expect(TOOL_MAP.fake_mutate.execute).not.toHaveBeenCalled();
  });

  test('a completed proposal is reported as applied', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });
    const started = await aiConfirmation.beginExecution(USER_A, prepared.token);
    await aiConfirmation.completeProposal(started.proposal.id, 'Applied.');

    const res = await request(app)
      .post('/ai/actions/status')
      .set('x-user', USER_A)
      .send({ token: prepared.token });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.applied).toBe(true);
    expect(res.body.data.retryable).toBe(false);
    expect(res.body.data.outcomeKnown).toBe(true);
  });

  test('an executing proposal is neither applied nor retryable', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });
    await aiConfirmation.beginExecution(USER_A, prepared.token);

    const res = await request(app)
      .post('/ai/actions/status')
      .set('x-user', USER_A)
      .send({ token: prepared.token });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('EXECUTING');
    expect(res.body.data.applied).toBe(false);
    expect(res.body.data.retryable).toBe(false);
  });

  test('an expired pending proposal is reported as expired and not retryable', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });
    prisma.__proposals[0].expiresAt = new Date(Date.now() - 1000);

    const res = await request(app)
      .post('/ai/actions/status')
      .set('x-user', USER_A)
      .send({ token: prepared.token });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('EXPIRED');
    expect(res.body.data.retryable).toBe(false);
    // The probe does not mutate the row.
    expect(prisma.__proposals[0].status).toBe('PENDING');
  });

  test('another user cannot read the status of a proposal', async () => {
    const prepared = await aiConfirmation.createProposal({
      userId: USER_A,
      toolName: 'fake_mutate',
      args: {},
    });

    const res = await request(app)
      .post('/ai/actions/status')
      .set('x-user', USER_B)
      .send({ token: prepared.token });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACTION_NOT_FOUND');
  });

  test('a malformed token is rejected', async () => {
    const res = await request(app)
      .post('/ai/actions/status')
      .set('x-user', USER_A)
      .send({ token: 'nope' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ACTION_TOKEN');
  });
});

describe('assistant tool gate', () => {
  const context = {
    user: { firstName: 'Test', email: 'test@example.com' },
    period: null,
    netWorth: 0,
    totalBalance: 0,
    incomeThisMonth: 0,
    expensesThisMonth: 0,
    savingsThisMonth: 0,
    profileMonthlySalary: 0,
    totalDebt: 0,
    monthlyEMI: 0,
    investmentValue: 0,
    investmentPnl: 0,
    healthScore: 0,
    goals: [],
    budgetCount: 0,
  };

  function responseWithCalls(calls) {
    return {
      response: {
        functionCalls: () => calls,
        text: () => '',
        candidates: [{ content: { parts: calls.map((c) => ({ functionCall: c })) } }],
      },
    };
  }

  function responseWithText(text) {
    return {
      response: {
        functionCalls: () => [],
        text: () => text,
        candidates: [{ content: { parts: [{ text }] } }],
      },
    };
  }

  test('a mutating call becomes a proposal and is never executed inline', async () => {
    const generateContent = jest.fn().mockResolvedValueOnce(
      responseWithCalls([{ name: 'create_transaction', args: { amount: 100 } }])
    );
    aiService.getGeminiClient.mockReturnValue({
      getGenerativeModel: () => ({ generateContent }),
    });
    aiService.getUserFinancialContext.mockResolvedValue(context);

    const result = await aiAssistant.run(USER_A, 'spend 100 on snacks', []);

    expect(result.pendingConfirmation).toBe(true);
    expect(result.confirmation.token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.response).toContain('Nothing has been changed yet');
    expect(prisma.aiActionProposal.create).toHaveBeenCalledTimes(1);
    // The proposal is returned immediately; no second model round can talk the
    // assistant into claiming the change was applied.
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  test('only one mutating action is prepared per turn', async () => {
    const generateContent = jest.fn().mockResolvedValueOnce(
      responseWithCalls([
        { name: 'create_transaction', args: { amount: 100 } },
        { name: 'create_transaction', args: { amount: 200 } },
      ])
    );
    aiService.getGeminiClient.mockReturnValue({
      getGenerativeModel: () => ({ generateContent }),
    });
    aiService.getUserFinancialContext.mockResolvedValue(context);

    const result = await aiAssistant.run(USER_A, 'two changes', []);

    expect(result.pendingConfirmation).toBe(true);
    expect(prisma.aiActionProposal.create).toHaveBeenCalledTimes(1);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].pendingConfirmation).toBe(true);
    expect(result.steps[1].pendingConfirmation).toBe(true);
    expect(result.steps[1].summary).toMatch(/only one change/i);
  });

  test('read-only tools still execute inline and can be summarized', async () => {
    const generateContent = jest.fn()
      .mockResolvedValueOnce(responseWithCalls([{ name: 'get_balance', args: {} }]))
      .mockResolvedValueOnce(responseWithText('You have ₹100.'));
    aiService.getGeminiClient.mockReturnValue({
      getGenerativeModel: () => ({ generateContent }),
    });
    aiService.getUserFinancialContext.mockResolvedValue(context);

    const result = await aiAssistant.run(USER_A, 'what is my balance?', []);

    expect(result.pendingConfirmation).toBeFalsy();
    expect(result.response).toBe('You have ₹100.');
    expect(TOOL_MAP.get_balance.execute).toHaveBeenCalledTimes(1);
    expect(result.steps[0].ok).toBe(true);
    expect(prisma.aiActionProposal.create).not.toHaveBeenCalled();
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  test('the total wall-clock deadline bounds a stalled provider', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const generateContent = jest.fn(() => new Promise(() => {}));
      aiService.getGeminiClient.mockReturnValue({
        getGenerativeModel: () => ({ generateContent }),
      });
      aiService.getUserFinancialContext.mockResolvedValue(context);

      const pending = aiAssistant.run(USER_A, 'slow request', []);
      await jest.advanceTimersByTimeAsync(6000);
      const result = await pending;

      expect(result).toBeNull();
      expect(generateContent).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      jest.useRealTimers();
    }
  });
});
