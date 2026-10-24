# AI Assistant — Architecture, Tools & Guardrails

**Entry point:** `POST /api/v1/ai/chat` (authenticated)
**Files:** `node-backend/src/controllers/aiController.js`, `services/aiAssistantService.js`, `services/aiTools.js`, `services/aiActionService.js`, `services/aiConfirmationService.js`, `services/ragService.js`, `services/aiService.js`
**Clients:** `frontend/public/ai-advisor.html`, `mobile/lib/features/ai_advisor/ai_advisor_screen.dart`

---

## 1. Request flow

Every turn goes through the same three-stage pipeline. A stage is only reached if the previous one did not produce an answer.

```
POST /ai/chat { message }
        │
        ├─ 1. Validate: empty/whitespace → 400 VALIDATION_ERROR
        ├─ 2. Load the last 10 chat messages (oldest → newest) for context
        ├─ 3. Persist the user message
        │
        ├─ 4. TOOL-CALLING ASSISTANT  (aiAssistantService.run)
        │      Gemini + 60 function declarations, max 6 rounds
        │      A read-only tool runs inline.
        │      A mutating tool is NOT executed: it becomes a hashed,
        │      user-bound proposal with a 5-minute token, returned as
        │      pendingConfirmation (one proposal per turn).
        │      Total wall-clock budget: 45 s (AI_ASSISTANT_TOTAL_TIMEOUT_MS)
        │      → returns text  ⟹ 200, source: "gemini-tools"
        │      → throws / null ⟹ continue
        │
        ├─ 5. DETERMINISTIC ACTION ENGINE  (aiActionService)
        │      Read-only intents execute normally.
        │      ADD_TRANSACTION / EDIT_TRANSACTION / DELETE_TRANSACTION
        │      are wrapped as legacy:<INTENT> proposals and NOT executed.
        │      → handled ⟹ 200, source: "ai_action_engine (<INTENT>)"
        │
        └─ 6. RAG PIPELINE  (ragService.runRAGPipeline)
               Intent detection → user-scoped DB retrieval → grounded answer
               → 200, source: "rag" / deterministic template

POST /ai/actions/confirm { token, decision: CONFIRM | CANCEL }
        │
        ├─ CONFIRM: claim the token atomically (one use, not expired,
        │           same user): PENDING → EXECUTING → run the bound tool/args
        │           → COMPLETED | FAILED (both terminal, never retried)
        └─ CANCEL:  mark CANCELLED; execute nothing
```

The assistant is **assistant-first, not LLM-only**: if the provider is unreachable, the deterministic engine still handles read-only intents and prepares the core mutations for confirmation, and the RAG stage still answers from the database. The provider is never on the critical path for correctness.

### Confirmation state machine (Phase 4)

```
PENDING ──confirm──▶ EXECUTING ──▶ COMPLETED   (mutation applied)
                        │
                        └──────────▶ FAILED      (terminal; outcome may be partial)

PENDING ──cancel───▶ CANCELLED
PENDING ──timeout──▶ EXPIRED
```

- The claim is a single conditional `UPDATE ... WHERE status = 'PENDING' AND expiresAt > now()`.
  Exactly one concurrent request can win, so two clicks can never execute the
  same mutation twice.
- A token that has been claimed is **never** returned to `PENDING`. A failed
  write leaves the proposal in `FAILED` and the user must prepare a new
  request; there is no blind retry of a consumed token.
- The only retryable failure is a failure **before** the mutation started
  (`503 ACTION_START_UNAVAILABLE`), where the server states that no change was
  applied.
- Every response carries `executionState` and `retryable`; see `API.md` §7.1
  for the full error table.
- A chat-history write failure after a successful mutation never turns the
  result into an error: the action is already applied and the response says so.

### Response shape

```jsonc
{
  "success": true,
  "data": {
    "response": "...",
    "source": "gemini-tools | ai_action_engine (ADD_TRANSACTION) | ai_confirmation_gate | rag",
    "sources": ["..."],
    "pendingConfirmation": true,
    "confirmation": {
      "token": "64-hex-characters",       // shown once; stored SHA-256 hashed
      "toolName": "create_transaction",
      "description": "Create a transaction: Coffee · ₹500 · Food",
      "expiresAt": "2026-10-21T12:05:00.000Z",
      "ttlSeconds": 300
    },
    "action": {              // null when nothing was executed
      "executed": true,
      "type": "create_transaction",
      "data": null,
      "steps": [{ "name": "create_transaction", "args": {...}, "ok": true, "summary": "..." }]
    },
    "rag": {
      "enabled": true,
      "sources": ["..."],
      "retrievedDocCount": 3,
      "intents": ["TRANSACTIONS"],
      "tenantVerified": true,
      "model": "gemini-3.5-flash-lite"
    }
  }
}
```

`action.steps` is the audit trail of what the model actually called. Both clients render it as chips, so the user can see which tools ran without reading the prose. When `pendingConfirmation` is true, `action.executed` is **false** and the only way to apply the change is the confirm endpoint.

---

## 2. Tool registry (`aiTools.js`)

60 declarations. Every executor has the signature `(userId, args)` and reads/writes **only** rows matching that `userId`.

| Group | Examples | Mutates? |
|---|---|---|
| Profile & snapshot | `get_profile`, `get_financial_overview` | no |
| Ledger reads | `list_transactions`, `list_accounts`, `list_budgets`, `list_goals`, `list_loans`, `list_investments`, `analyse_spending`, `list_pending_sms`, `list_cards`, `list_tasks`, `list_subscriptions` | no |
| Transactions | `create_transaction`, `update_transaction`, `delete_transaction`, `transfer_between_accounts` | **yes** |
| Budgets | `create_budget`, `update_budget`, `delete_budget` | **yes** |
| Goals | `create_goal`, `contribute_to_goal`, `update_goal`, `delete_goal` | **yes** |
| Loans | `create_loan`, `record_loan_payment`, `update_loan`, `delete_loan` | **yes** |
| Investments | `add_investment`, `update_investment`, `delete_investment` | **yes** |
| Cards | `create_card`, `pay_credit_card` | **yes** |
| Insurance / subscriptions | `create_insurance`, `update_insurance`, `delete_insurance`, `create_subscription`, `update_subscription`, `delete_subscription` | **yes** |
| Calendar / tasks | `create_calendar_event`, `create_task`, `complete_task` | **yes** |
| SMS review | `confirm_pending_sms`, `reject_pending_sms` | **yes** |

Design rules enforced in the code:

- **Validated arguments.** Money is checked before it reaches Prisma, e.g. `create_transaction` rejects `amount <= 0`; billing-cycle fields are clamped to their enum; day-of-month is clamped to 1–31.
- **Account resolution is user-scoped.** `pickAccount(userId, ref)` looks up by name or id with `where: { userId, isActive: true }`; an unknown account falls back to the primary account instead of another user's row.
- **Atomic writes.** Balance movement and the ledger row are written in one `prisma.$transaction`, so a failure cannot leave a transaction without its balance change (or vice versa).
- **Honest results.** A tool returns `{ ok, summary, data }`. The model is instructed to quote that result and never to claim success on its own; a thrown error returns `ok: false` and the step is recorded as failed.
- **Realtime side-effect.** Mutations call `emit(userId, tool, resource, …)` so the web SSE clients refresh (see `PARITY.md` §4 for mobile).

---

## 3. Context assembly

### 3.1 System prompt snapshot

Each turn embeds a live, server-computed snapshot, so the model does not have to guess or call a tool just to know the basics:

```
Income this month (recorded ledger) · expenses · savings · period
Net worth · total balance
Debt + monthly EMI · investment value + P&L · health score
active goals · budget count · onboarding salary estimate
```

These values come from the same aggregation functions the dashboard uses. The prompt explicitly separates **recorded ledger income** (authoritative `Transaction` rows) from the profile's `monthlySalary` (an onboarding estimate that must never be reported as actual inflow). The prompt also carries the user's first name and email, and an explicit instruction to discuss only that user's finances.

### 3.2 Conversation memory

- The chat handler loads the **last 10** messages (`orderBy createdAt desc, take 10`, then reversed to ascending) and passes them as `contents`.
- `GET /ai/history` returns the **most recent 50** messages, oldest-first (fixed in this pass — see `PARITY.md` §7.4). That is the transcript both clients restore on open.
- `DELETE /ai/history` deletes all messages for the user and returns `{ message: 'Chat history cleared.' }`. Both clients confirm before calling it.

### 3.3 Retrieval bounds (RAG)

`ragService` detects the intent first (budgets, transactions, goals, investments, insurance, …), then runs **targeted, bounded** Prisma queries — for example the 25 most recent transactions, 10 budgets, 5 goals — and builds fact documents from them. It never loads an unbounded ledger into the prompt.

Deterministic arithmetic (sums, percentages, budget utilisation, over/under status) happens in JavaScript **before** the model sees anything. The model is asked to explain the numbers, not to compute them.

---

## 4. Determinism and arithmetic

| Concern | Handling |
|---|---|
| Totals, savings rate, utilisation | Computed in JS from the DB rows, then formatted with `formatINR` (Indian grouping) |
| Balance after a mutation | Read back from the updated row inside the transaction and returned in `summary`/`data` |
| Model arithmetic | Discouraged by the prompt and unnecessary: tools return the computed values. Residual risk: the model can still mis-transcribe a number it was given — this is a known, bounded limitation, not something a prompt can eliminate |
| Currency | Always INR with `₹` and lakh/crore grouping; both clients render the server strings |

---

## 5. Failure handling

| Failure | Behaviour |
|---|---|
| Gemini timeout (20 s/call) | Round aborts → next model in `MODEL_CHAIN` → then the action engine |
| Provider error / missing key | `aiAssistantService.run` returns `null` or throws; `chat` logs and falls through, **never** 500 |
| Empty model response | Treated as failure and the next model is tried |
| 6 rounds exhausted with calls still pending | Returns "Completed the requested actions." with the steps performed — no invented completion |
| Tool throws | The step is recorded `ok: false`; the model is told; the turn still returns 200 |
| RAG retrieval empty | Deterministic template states there is no data and suggests the next step |
| Client sees 4xx | Shows the server message and a retry affordance |
| Client sees 5xx / network | Shows a generic failure turn with **Retry** (mobile), never a fabricated answer |
| Client request times out | Mobile says the advisor is "taking longer than expected" and warns to check records before retrying. It deliberately does **not** claim "nothing was changed": the server may still be executing tool calls after the socket closes |

Both clients only render a message bubble after a successful response; the user message is kept with a retry action on failure.

### Latency budget

One assistant turn shares a **45 s total wall-clock budget** (`AI_ASSISTANT_TOTAL_TIMEOUT_MS`, clamped 5–120 s) across model retries and tool rounds. `MODEL_CHAIN × MAX_ROUNDS = 6 × 20 s` is the theoretical per-call ceiling, but the shared deadline cuts the turn short and falls through to the deterministic engine / RAG rather than holding the socket open for minutes.

The mobile client still overrides the global 45 s `receiveTimeout` with **120 s for `POST /ai/chat` only** (`Options` passed from the screen); every other endpoint keeps the 45 s guard. The web client has no client-side timeout and simply waits. The server deadline — not the client timeout — is the authoritative bound.

---

## 6. Security posture

### Implemented

- **Tenant isolation in depth.** Auth middleware resolves `req.user.id`; every tool, `pick*` helper and RAG query filters by it. Cross-tenant access returns 404.
- **No free-form SQL.** The model can only call the declared tools; there is no `run_query` escape hatch.
- **Schema-validated arguments.** Declarations carry types and enums; executors re-validate and clamp.
- **Server-authoritative money.** No client-supplied balance is trusted; deposits and tool mutations recompute server-side.
- **No secrets in prompts or responses.** The prompt contains the user's own profile fields, not credentials or other users' data.
- **Output escaping.** The web advisor escapes model/RAG output before applying its markdown allow-list; the mobile renderer builds `TextSpan`s from parsed runs, so markup cannot inject widgets.
- **Two-phase confirmation for every mutation.** A model tool call, or a deterministic mutating intent, can only create a proposal. The client receives `pendingConfirmation` + a one-time token; execution requires `POST /ai/actions/confirm`. A client-supplied "yes" in chat text is not consent and does not execute anything.
- **One change per turn.** Only the first mutating tool call in a turn becomes a proposal; later mutations are deferred so the user never approves an ambiguous batch.

### Confirmation protocol

| Property | Implementation |
|---|---|
| Token | 32 random bytes (64 hex chars), returned once |
| Storage | SHA-256 hash only; the raw token is never persisted |
| Binding | `userId` + tool name + exact arguments, checked server-side |
| Lifetime | 5 minutes by default (`AI_ACTION_TOKEN_TTL_MS`, clamped 30 s–15 min) |
| Consumption | Atomic `PENDING → EXECUTING` update; a second claim returns `409 ACTION_IN_PROGRESS` and only one request can ever execute the mutation |
| Completion | `EXECUTING → COMPLETED` (success) or `→ FAILED` (failure). Both are terminal; a consumed token is never reopened |
| Expiry | `410 ACTION_EXPIRED`; the row is marked `EXPIRED` |
| Cross-user | `404 ACTION_NOT_FOUND`; the proposal stays pending for its owner |
| Cancel | `CANCEL` marks `CANCELLED`; idempotent for the owner, executes nothing |
| Audit | Proposal row records tool, args, status, `attempts`, `executionStartedAt`, `resolvedAt`, `resultSummary`, `lastError` and `retryable` |
| Pre-execution failure | `503 ACTION_START_UNAVAILABLE` with `retryable: true` — the mutation provably did not start, so the same token may be retried |

The endpoint accepts `{ token, decision }`, defaults `decision` to `CONFIRM`, and returns `400 VALIDATION_ERROR` for an unknown decision or a malformed token. The `AiActionProposal` table is additive; production must have the schema applied (see `DEPLOYMENT.md` §2.3) before the gate can serve mutations.

### Not solved (and not claimed to be)

- **Prompt injection.** No system prompt can make a model immune to instructions embedded in user text. The real defence is structural: a fixed tool allow-list, server-side scoping, validated args, no arbitrary code/SQL execution, and now a human confirmation gate. If a future tool can move money to an external destination, it must not rely on prompt-level instructions.
- **Mobile confirmation UI.** The web advisor renders Confirm/Cancel and calls the new endpoint. The Flutter advisor renders an explicit **"Not applied"** notice for a pending proposal and never shows a proposal as an executed action, so a mobile user can prepare a change but cannot approve it in-app. Until an in-app approval flow ships, mobile mutating actions are read-only rather than silently applied, and the server still enforces confirmation for every client.

---

## 7. Client behaviour (mobile)

`mobile/lib/features/ai_advisor/ai_advisor_screen.dart` was rebuilt to match the web advisor's capabilities:

- **History restore** on open from `GET /ai/history`, with a skeleton while loading and a greeting only when the transcript is genuinely empty.
- **Markdown-lite rendering**: bold/italic/code/bullets/headings via `_inlineSpans` — tables are shown as plain text rather than dropped.
- **Action chips** derived from `data.action.steps` (tool → human label) and **source chips** from `data.sources`. A proposal is never rendered as a chip: chips are only shown when the server reports `action.executed == true`.
- **"Not applied" notice** for a pending proposal: the change still needs approval and must be confirmed in the web app. The mobile client cannot approve it.
- **Honesty note** under the sources explaining that the answer is grounded in the user's own records.
- **Failure turns** with the error text and a **Retry** that re-sends the same message.
- **Timeout-aware failure copy** — a 120 s `receiveTimeout` for this endpoint, and wording that does not promise the server made no changes.
- **Clear conversation** with a confirmation dialog → `DELETE /ai/history`.
- **In-flight guard** so a second send cannot race the first.
- **Plain-text fast path**: when a message has no markdown, a single `Text` is used, which keeps `find.text(...)` and screen readers exact.
- Suggestion chips on an empty conversation to make the assistant discoverable.

Tests: `mobile/test/ai_advisor_screen_test.dart` (8 cases: history restore, empty greeting, action+source chips, 400 failure + retry recovery, timeout honesty + retry recovery, clear-history dialog + DELETE, a pending confirmation is never presented as applied, a proposal without confirmation metadata is not shown as performed).

---

## 8. Testing strategy

The backend AI tests **stub the provider at the service boundary** and drive the real controller, assistant loop, tool executors and database:

```
realGetGeminiClient  ← replaced for the duration of the suite
  → scripted functionCalls / text
  → real executeTool → real Prisma writes
```

This makes assertions deterministic and keeps CI independent of model wording or quota. Covered cases include: a scripted `create_transaction` call returning a proposal instead of writing, confirm → execute exactly once, replay rejected, provider error mid-flight degrading to a confirmed deterministic proposal, and request validation at the boundary. A live smoke test is opt-in only (`AI_LIVE_SMOKE=1`).

`src/__tests__/aiConfirmation.test.js` covers bypass attempts directly: a plain `"yes"` without a token, cross-user tokens, expired tokens, cancellation, malformed tokens, one-mutation-per-turn, and the total deadline with a stalled provider. Phase 4 extends it with the execution state machine: claiming moves `PENDING → EXECUTING`, a failed action is terminal, a concurrent claim has exactly one winner, a database failure before the write leaves the token retryable, and a chat-history write failure never turns an applied action into an error. `src/__tests__/phase4FinanceDate.test.js` locks the dashboard/AI reporting-period agreement and the date-only edge cases; `src/__tests__/phase4Backup.test.js` covers the backup overwrite and manifest-verification rules. `src/__tests__/ragSources.test.js` covers omission and canonicalization of `Sources:`; `src/__tests__/dateOnly.test.js` and `phase3Finance.test.js` cover the date/income regressions.

`scripts/verify-ai-confirmation.js` proves the same state machine against a **real** PostgreSQL database (it refuses to run against a non-local host): hashed tokens, cross-user isolation, expiry, single-use claiming, five concurrent claims with exactly one winner, terminal `COMPLETED`/`FAILED`/`CANCELLED` states.

The `GET /ai/history` ordering guard (newest 50, ascending) lives in the custom suite and was verified to **fail** against the old ascending-query code before the fix was restored.

**Not covered:** live model quality, prompt-injection resistance, and streaming (not implemented). No test claims to evaluate answer quality — only that the plumbing is correct.
