/**
 * FinPro — AI Assistant Engine (Gemini function-calling)
 *
 * Turns the chat box into a real personal assistant: the model decides which
 * domain tool to call, the tool mutates the database atomically and emits a
 * realtime event, and the model then explains the outcome in natural language.
 *
 * Implementation note — why we do NOT use the SDK's ChatSession:
 *   @google/generative-ai 0.21.0 serialises function responses with
 *   `role: "function"`, which Gemini 3 era models reject with
 *   "Role 'function' is not supported ...". We therefore build the
 *   `contents` array ourselves and send function responses on a `user`
 *   turn (the role the API accepts), echoing the model's raw functionCall
 *   parts back verbatim so thought signatures survive.
 *
 * Returns `null` when Gemini is unavailable so the caller can fall back.
 */

'use strict';

const aiService = require('./aiService');
const { TOOL_MAP, DECLARATIONS } = require('./aiTools');
const { formatINR } = require('../utils/inr');

const MODEL = process.env.AI_MODEL || 'gemini-3.5-flash-lite';
const MODEL_CHAIN = Array.from(
  new Set([MODEL, ...(aiService.CANDIDATE_MODELS || [])].filter(Boolean))
);
const MAX_ROUNDS = 6;
const TIMEOUT_MS = 20_000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('AI request timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function buildSystemPrompt(ctx) {
  const name = ctx.user?.firstName || 'the user';
  const email = ctx.user?.email || '';
  return `You are FinPro AI — ${name}'s personal financial assistant.
The account you are serving: ${name}${email ? ` <${email}>` : ''}.

You can BOTH answer questions AND actually perform financial actions using your tools.

RULES:
- Any money-moving or data-changing request MUST go through a tool. Never claim you did something unless a tool returned ok:true.
- If a required detail is missing (for example the amount), ask a short follow-up question instead of guessing.
- Never invent balances, transactions or prices — read them with a tool first.
- For questions about the user's identity, profile or account details (name, email, risk profile), call get_profile.
- Currency is INR. Write amounts with ₹ and Indian grouping (lakh / crore).
- Reply concisely, like a sharp human assistant. Lead with the outcome, then one supporting detail.
- After a successful action, confirm briefly and quote the new balance/state the tool returned.
- Only ever discuss ${name}'s own finances.

LIVE SNAPSHOT (as of now):
- Net worth: ${formatINR(ctx.netWorth)}
- Total balance: ${formatINR(ctx.totalBalance)}
- This month: income ${formatINR(ctx.incomeThisMonth)}, expenses ${formatINR(
    ctx.expensesThisMonth
  )}, savings ${formatINR(ctx.savingsThisMonth)}
- Debt: ${formatINR(ctx.totalDebt)} (EMI ${formatINR(ctx.monthlyEMI)})
- Investments: ${formatINR(ctx.investmentValue)} (P&L ${formatINR(ctx.investmentPnl)})
- Health score: ${ctx.healthScore}/100
- Active goals: ${(ctx.goals || []).length}, budgets: ${ctx.budgetCount}`;
}

/**
 * Execute the model's chosen tool against the live database.
 * @returns {Promise<{ok:boolean, summary:string, data:object}>}
 */
async function executeTool(userId, call) {
  const tool = TOOL_MAP[call.name];
  if (!tool) return { ok: false, error: `Unknown tool: ${call.name}` };
  try {
    const out = await tool.execute(userId, call.args || {});
    return out && typeof out === 'object' ? out : { ok: true, summary: String(out ?? 'Done.') };
  } catch (err) {
    console.error(`[AI-ASSISTANT] tool ${call.name} failed:`, err.message);
    return { ok: false, error: err.message };
  }
}

function extractCalls(response) {
  if (!response) return [];
  try {
    if (typeof response.functionCalls === 'function') return response.functionCalls() || [];
  } catch (_) {
    /* fall through to manual parsing */
  }
  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p && p.functionCall).map((p) => p.functionCall);
}

function extractText(response) {
  try {
    if (typeof response.text === 'function') return response.text() || '';
  } catch (_) {
    /* some responses have no text part */
  }
  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((p) => p && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
}

/**
 * Run one conversational turn with tool-calling enabled.
 *
 * @param {string} userId
 * @param {string} userMessage
 * @param {Array<{role:string, content:string}>} chatHistory  oldest → newest
 * @returns {Promise<null | {handled:boolean, response:string, action:string|null,
 *   steps:Array, model:string, source:string}>}
 */
async function run(userId, userMessage, chatHistory = []) {
  if (!userId || !userMessage || !String(userMessage).trim()) return null;

  let client;
  try {
    client = aiService.getGeminiClient();
  } catch (err) {
    console.warn('[AI-ASSISTANT] Gemini unavailable:', err.message);
    return null;
  }

  let ctx;
  try {
    ctx = await aiService.getUserFinancialContext(userId);
  } catch (err) {
    console.warn('[AI-ASSISTANT] context load failed:', err.message);
    ctx = {
      user: null,
      netWorth: 0,
      totalBalance: 0,
      incomeThisMonth: 0,
      expensesThisMonth: 0,
      savingsThisMonth: 0,
      totalDebt: 0,
      monthlyEMI: 0,
      investmentValue: 0,
      investmentPnl: 0,
      healthScore: 0,
      goals: [],
      budgetCount: 0,
    };
  }

  const systemInstruction = buildSystemPrompt(ctx);
  const history = (chatHistory || [])
    .slice(-10)
    .filter((m) => m && m.content && String(m.content).trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }],
    }));

  const baseContents = [
    ...history,
    { role: 'user', parts: [{ text: String(userMessage) }] },
  ];

  let lastError = null;

  for (const modelName of MODEL_CHAIN) {
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction,
      tools: [{ functionDeclarations: DECLARATIONS }],
    });

    const contents = baseContents.slice();
    const steps = [];
    let executedAny = false;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await withTimeout(
          model.generateContent({
            contents,
            generationConfig: { temperature: 0.4, maxOutputTokens: 1600 },
          }),
          TIMEOUT_MS
        );
        const response = result.response;
        const calls = extractCalls(response);

        if (!calls.length) {
          const text = extractText(response);
          const acted = steps.length > 0;
          if (!text && !acted) {
            lastError = new Error('empty model response');
            break; // try the next model
          }
          return {
            handled: acted,
            response: text || 'Done.',
            action: acted ? steps[steps.length - 1].name : null,
            steps,
            model: modelName,
            source: 'gemini-tools',
          };
        }

        // Echo the model's own parts back verbatim, then append our results.
        const modelParts = response.candidates?.[0]?.content?.parts || [];
        contents.push({
          role: 'model',
          parts: modelParts.length
            ? modelParts
            : calls.map((c) => ({ functionCall: { name: c.name, args: c.args || {} } })),
        });

        const responseParts = [];
        for (const call of calls) {
          const out = await executeTool(userId, call);
          executedAny = true;
          steps.push({
            name: call.name,
            args: call.args || {},
            ok: out.ok !== false,
            summary: out.summary || out.error || '',
          });
          responseParts.push({
            functionResponse: { name: call.name, response: out },
          });
        }
        // The API accepts function responses on a `user` turn.
        contents.push({ role: 'user', parts: responseParts });
      }

      // Ran out of rounds with calls still pending — report what was done.
      return {
        handled: steps.length > 0,
        response: steps.length
          ? 'Completed the requested actions.'
          : 'I could not complete that request.',
        action: steps.length ? steps[steps.length - 1].name : null,
        steps,
        model: modelName,
        source: 'gemini-tools',
      };
    } catch (err) {
      lastError = err;
      console.warn(`[AI-ASSISTANT] model "${modelName}" failed:`, err.message);
      // Never retry after a mutation — that would double-apply user actions.
      // Instead, fall back to the human-readable summary each tool already
      // produced, so the user still gets a real answer.
      if (executedAny) {
        const lastOk = [...steps].reverse().find((s) => s.ok && s.summary);
        return {
          handled: true,
          response:
            lastOk?.summary ||
            'The action completed, but I could not fetch a summary. Please refresh.',
          action: steps.length ? steps[steps.length - 1].name : null,
          steps,
          model: modelName,
          source: 'gemini-tools',
        };
      }
    }
  }

  if (lastError) console.warn('[AI-ASSISTANT] all models exhausted:', lastError.message);
  return null;
}

module.exports = { run, executeTool };
