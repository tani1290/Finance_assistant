/**
 * Phase 4 — optional AI provider must never block a request indefinitely.
 *
 * Guards the bounded-budget behaviour of runRAGPipeline: when the (optional)
 * Gemini provider is slow or unreachable, the pipeline must degrade to the
 * deterministic grounded engine within a bounded time instead of hanging the
 * request handler for (candidateModels × per-model timeout) seconds.
 *
 * Deterministic by construction: the database and the AI SDK are mocked; no
 * network call is made and no credentials are required.
 */

jest.mock('../config/database', () => ({
  user: { findUnique: jest.fn().mockResolvedValue(null) },
  financialAccount: {
    findMany: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _sum: { balance: 0 } }),
  },
  transaction: {
    findMany: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
  },
  budget: { findMany: jest.fn().mockResolvedValue([]) },
  goal: { findMany: jest.fn().mockResolvedValue([]) },
  portfolio: { findUnique: jest.fn().mockResolvedValue(null) },
  loan: {
    findMany: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _sum: { outstandingBalance: 0, emiAmount: 0 } }),
  },
  subscription: { findMany: jest.fn().mockResolvedValue([]) },
  receiptScan: { findMany: jest.fn().mockResolvedValue([]) },
}));

// Provider stub whose chat call never resolves — an unreachable/hung network.
const hangingSendMessage = jest.fn(() => new Promise(() => {}));
const fastSendMessage = jest.fn().mockResolvedValue({ response: { text: () => 'Grounding from Gemini.' } });

// Must be prefixed with `mock` so jest.mock's out-of-scope variable guard (and
// its hoisting) accepts the reference from inside the factory below.
let mockSendMessage = hangingSendMessage;

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({
      startChat: () => ({
        sendMessage: (...args) => mockSendMessage(...args),
      }),
    }),
  })),
}));

const ragService = require('../services/ragService');

const ENV_KEYS = ['GEMINI_API_KEY', 'AI_LLM_TOTAL_TIMEOUT_MS', 'AI_MODEL'];
const ORIGINAL_ENV = {};
ENV_KEYS.forEach((k) => { ORIGINAL_ENV[k] = process.env[k]; });

afterEach(() => {
  jest.restoreAllMocks();
  mockSendMessage = hangingSendMessage;
  ENV_KEYS.forEach((k) => {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  });
});

describe('runRAGPipeline — bounded AI provider budget', () => {
  it('uses the deterministic engine when no provider key is configured', async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await ragService.runRAGPipeline('user-1', 'What is my current bank balance?');
    expect(result.source).toBe('deterministic_grounded_engine');
    expect(typeof result.response).toBe('string');
    expect(result.response.length).toBeGreaterThan(10);
  });

  it('rejects an unauthenticated request', async () => {
    await expect(ragService.runRAGPipeline(null, 'hi')).rejects.toThrow(/Authentication required/);
  });

  it('degrades to the deterministic engine within the budget when the provider hangs', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.AI_LLM_TOTAL_TIMEOUT_MS = '400';
    delete process.env.AI_MODEL;

    const started = Date.now();
    const result = await ragService.runRAGPipeline('user-1', 'What is my current bank balance?');
    const elapsed = Date.now() - started;

    expect(result.source).toBe('deterministic_grounded_engine');
    expect(typeof result.response).toBe('string');
    expect(result.response.length).toBeGreaterThan(10);
    // Must resolve well within a request budget rather than after N × 12s.
    expect(elapsed).toBeLessThan(3000);
  });

  it('uses the live provider response when it returns within the budget', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.AI_LLM_TOTAL_TIMEOUT_MS = '4000';
    mockSendMessage = fastSendMessage;

    const result = await ragService.runRAGPipeline('user-1', 'What is my current bank balance?');
    expect(result.source).toMatch(/^gemini-rag \(/);
    expect(result.response).toBe('Grounding from Gemini.');
  });
});
