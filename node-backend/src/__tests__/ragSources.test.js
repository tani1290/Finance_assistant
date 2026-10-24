/**
 * Phase 3 — RAG citation regressions.
 *
 * The advisor must cite only what was actually retrieved for the signed-in
 * user. Model-invented `Sources:` blocks are stripped and replaced with the
 * canonical list; when nothing was retrieved the section is omitted entirely.
 */

jest.mock('../config/database', () => ({
  user: { findUnique: jest.fn() },
  loan: { findMany: jest.fn() },
}));

const mockSendMessage = jest.fn();

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({
      startChat: () => ({ sendMessage: mockSendMessage }),
    }),
  })),
}));

const prisma = require('../config/database');
const {
  runRAGPipeline,
  analyzeQueryIntent,
  retrieveFinancialKnowledge,
  buildGroundedRAGContext,
} = require('../services/ragService');

const USER_ID = 'user-rag';

const loan = {
  id: 'loan-1',
  lenderName: 'HDFC Bank',
  loanType: 'HOME',
  outstandingBalance: '2500000',
  emiAmount: '22000',
  interestRate: '8.5',
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

function primeRetrieval({ loans = [] } = {}) {
  prisma.user.findUnique.mockResolvedValue({
    id: USER_ID,
    firstName: 'Test',
    lastName: 'User',
    currency: 'INR',
  });
  prisma.loan.findMany.mockResolvedValue(loans);
}

beforeEach(() => {
  jest.clearAllMocks();
  primeRetrieval();
  process.env.GEMINI_API_KEY = '';
  process.env.AI_MODEL = '';
});

describe('query intent and tenant scoping', () => {
  test('loan questions route to the loans domain', () => {
    expect(analyzeQueryIntent('show my loans and EMIs')).toEqual(expect.arrayContaining(['LOANS']));
  });

  test('retrieval is always scoped to the requested user', async () => {
    await retrieveFinancialKnowledge(USER_ID, ['LOANS']);
    expect(prisma.loan.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: 'ACTIVE' },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: USER_ID },
    }));
  });
});

describe('grounding context', () => {
  test('with no retrieved records it forbids a Sources section', () => {
    const context = buildGroundedRAGContext({
      user: { id: USER_ID, firstName: 'Test' },
      knowledgeDocs: [],
      sources: [],
    }, 'What are my loans?');

    expect(context.sources).toEqual([]);
    expect(context.factsBlock).toMatch(/No financial records found/i);
    expect(context.systemInstruction).toMatch(/Do NOT add a Sources section/i);
    expect(context.systemInstruction).not.toMatch(/list only these exact retrieved sources/i);
  });

  test('with records it lists exactly the retrieved sources, deduplicated', () => {
    const context = buildGroundedRAGContext({
      user: { id: USER_ID, firstName: 'Test' },
      knowledgeDocs: [{ sourceTitle: 'Loan — HDFC Bank', text: 'Outstanding ₹1' }],
      sources: ['Loan — HDFC Bank', 'Loan — HDFC Bank', 'Account — Savings'],
    }, 'What are my loans?');

    expect(context.sources).toEqual(['Loan — HDFC Bank', 'Account — Savings']);
    expect(context.systemInstruction).toContain('• Loan — HDFC Bank');
    expect(context.systemInstruction).toContain('• Account — Savings');
    expect(context.systemInstruction).not.toMatch(/Do NOT add a Sources section/i);
  });
});

describe('deterministic fallback', () => {
  test('empty retrieval omits the Sources heading entirely', async () => {
    primeRetrieval({ loans: [] });

    const result = await runRAGPipeline(USER_ID, 'show my loans');

    expect(result.response).toMatch(/zero outstanding loans/i);
    expect(result.response).not.toMatch(/Sources:/i);
    expect(result.sources).toEqual([]);
  });

  test('retrieved records produce a canonical Sources section', async () => {
    primeRetrieval({ loans: [loan] });

    const result = await runRAGPipeline(USER_ID, 'show my loans');

    expect(result.response).toContain('**Sources:**');
    expect(result.response).toContain('• Loan — HDFC Bank');
    expect(result.response).not.toMatch(/Made Up Source/);
    expect((result.response.match(/\*\*Sources:\*\*/g) || [])).toHaveLength(1);
  });
});

describe('model citations', () => {
  test('a model-invented Sources block is replaced with retrieved sources', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    primeRetrieval({ loans: [loan] });
    mockSendMessage.mockResolvedValueOnce({
      response: {
        text: () => '**DATABASE FACT:** You have one home loan.\n\n**Sources:**\n• Made Up Source\n• Another Invented Source',
      },
    });

    const result = await runRAGPipeline(USER_ID, 'show my loans');

    expect(result.response).toContain('• Loan — HDFC Bank');
    expect(result.response).not.toContain('Made Up Source');
    expect(result.response).not.toContain('Another Invented Source');
    expect((result.response.match(/\*\*Sources:\*\*/g) || [])).toHaveLength(1);
  });

  test('no retrieved sources means the model cannot add any Sources section', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    primeRetrieval({ loans: [] });
    mockSendMessage.mockResolvedValueOnce({
      response: {
        text: () => '**DATABASE FACT:** No loans found.\n\n**Sources:**\n• Made Up Source',
      },
    });

    const result = await runRAGPipeline(USER_ID, 'show my loans');

    expect(result.response).not.toMatch(/Sources:/i);
    expect(result.response).not.toContain('Made Up Source');
    expect(result.sources).toEqual([]);
  });
});
