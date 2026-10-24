# Web ⇄ Mobile Feature Parity Matrix

**Scope:** `frontend/public` (static web app) · `mobile` (Flutter) · `node-backend` (Express + Prisma)
**Status of this document:** static contract audit + the verification runs recorded in §9. No device/simulator run and no live staging backend were available, so UI behaviour on real hardware is **not** claimed here.

---

## 1. How this matrix was produced

1. Enumerated every backend route (`node-backend/src/routes/index.js`, `notificationRoutes.js`, `authRoutes.js`) and mapped it to the web page and mobile screen that calls it.
2. Compared the *request shape* and the *fields consumed* on each surface against the controller/service that answers it.
3. Read every mobile screen that touches the same endpoint as a web page and diffed the behaviour (filters, pagination, empty/error states, mutations, formatting).
4. Fixed the conflicts found (see §7) and added widget tests for the new mobile screens.
5. Recorded known defects that were **deliberately not** changed (§8) so they do not silently drift.

Endpoint names below are relative to `/api/v1`.

---

## 2. Legend

| Symbol | Meaning |
|---|---|
| ✅ | Functionally equivalent: same endpoint, same mutations, same visible data |
| 🟡 | Works on both, but one surface exposes materially more (stated in the note) |
| ➖ | Intentionally single-surface (native capability or a web-only document page) |
| ⏸ | Not built on this surface; tracked as deferred (§10) |

"Equivalent" means the **contract** matches. Visual design is intentionally different (the web is a desktop-first vanilla-JS app; mobile is Material 3).

---

## 3. P1 — Core money workflows

| Capability | Web | Mobile | Notes |
|---|---|---|---|
| Signup / login / refresh / logout | ✅ | ✅ | Both use `Authorization: Bearer`. Mobile persists the refresh token in `flutter_secure_storage`; the web stores it in the same browser storage the API client expects. |
| Session expiry handling | ✅ | ✅ | Both redirect to login on 401 after the refresh attempt fails. |
| Onboarding | ✅ | ✅ | Same profile fields; mobile is a stepped flow. |
| Dashboard (net worth, income/expense, savings rate, health score) | ✅ | ✅ | Same `/dashboard` payload. |
| Accounts: list / create / update / archive | ✅ | ✅ | The web has no dedicated `accounts.html`; account management lives on `dashboard.html` and in the AI advisor. Mobile has a dedicated `AccountsScreen` with create/edit/archive. Same endpoints, so parity holds. |
| Deposit into an account | ✅ | ✅ | `POST /accounts/:id/deposit` (and `POST /accounts/deposit`). Optional server-side `idempotencyKey`; a replay returns the original transaction — see §8.4 and `API.md` §3.1. Transfers have their own key contract in §8.4 / `API.md` §4.1. |
| Transactions: list / filter / search / CRUD | ✅ | ✅ | Mobile paginates with an infinite scroll footer; the web paginates with page buttons. Same query parameters. |
| Transaction detail + category reassignment | ✅ | ✅ | |
| Budgets: list / create / edit / delete | ✅ | ✅ | Mobile adds a per-category drill-down (`CategoryDetailScreen`). |
| Goals: list / create / contribute / delete | ✅ | ✅ | |
| Loans: list / create / payment / EMI view | ✅ | ✅ | |
| Investments: list / create / update holdings | ✅ | ✅ | The web additionally offers portfolio export (`exportAPI`) — §10. |
| Analytics: overview / categories / trends / forecast / insights | ✅ | ✅ | Same `/analytics/*` contracts; invalid period → 400 on both. |
| AI advisor: chat, history, action chips, RAG sources | ✅ | ✅ | Mobile was rebuilt in this pass: restores server history on open, renders markdown-lite, shows action/source chips, supports retry and clear-history. Backend `/ai/history` ordering was fixed (§7.4). |
| Profile view / update | ✅ | ✅ | Both PATCH only the fields that are submitted. Email, username, phone, password, avatar, role and premium status are immutable on both. |
| Notifications | 🟡 | ✅ | The web exposes a bell dropdown on the dashboard with list + mark-all-read. Mobile has a full `/notifications` screen with unread badges and per-item read state. |
| Financial calendar | ✅ | ✅ | **Added to mobile in this pass.** Month grid, event dots, day filter, create, delete. Derived EMI/subscription/goal events are read-only on both (no `calendar_events` row exists to delete). |
| Insurance & subscriptions | ✅ | ✅ | **Added to mobile in this pass.** Combined screen: server summary headline, per-policy and per-subscription cards, create sheets, delete with confirmation, and the rules-based `/ai/insurance-review` card. |

---

## 4. P2 — Extended planning & data import

| Capability | Web | Mobile | Notes |
|---|---|---|---|
| Market prices / watchlist (`market.html`) | ✅ | ⏸ | The web page is a raw market-data view (`API_BASE` fetch). No mobile feature dir exists. Deferred; the backend endpoints already exist. |
| CSV / bank-statement import (`/import/bank-statement`) | ✅ | ⏸ | Web-only UI (`transactions.html` + AI advisor). Mobile has no import screen. |
| PDF statement import (`/import/statement-pdf`) | ✅ | ⏸ | Web only. |
| Receipt scan + confirm (`/receipts/scan`, `/receipts/confirm`) | ✅ | ⏸ | Web only. |
| Export (`/export/*`) | ✅ | ⏸ | Web only (`investments.html`). |
| Credit cards (create/pay) | ⏸ | ⏸ | Backend endpoints **and** AI tools exist; neither surface has a dedicated UI. The assistant can call the tools. |
| Tasks | ⏸ | ⏸ | Same: API + AI tools, no dedicated UI on either surface. |
| GST / tax helper | 🟡 | 🟡 | Web exposes quick actions in the AI advisor; mobile reaches it through assistant tool calls only. |
| Bank SMS ingestion | ➖ | ✅ | Native Android SMS channel — mobile only by design. |
| Pending SMS review (`/sms/*`) | ➖ | ✅ | Mobile-only queue with confirm/reject. |
| Real-time updates (SSE) | ✅ | ⏸ | The web loads `assets/js/realtime.js` on every app page. Mobile has no SSE client and relies on pull-to-refresh / focus refresh. Deferred; see §10. |

---

## 5. P3 — Presentation & diagnostics

| Capability | Web | Mobile | Notes |
|---|---|---|---|
| Voice intent (`/ai/voice-intent`) | ✅ | ⏸ | Used from `ai-advisor.html` and `transactions.html`. |
| Training / status / presentation pages | ✅ | ➖ | Web-only project/document pages (`training.html`, `status.html`, `presentation.html`). They are not part of the product's money workflows. |

---

## 6. Cross-cutting contract parity

These are the rules both clients must follow. They are asserted by the widget tests where the surface is mobile.

| Rule | Contract |
|---|---|
| **Money** | The API returns `Decimal` values serialised as JSON numbers, plus a pre-formatted `formatted*` string. Clients render the server string when one exists (summary headlines, list subtotals) and only format locally when there is no server string. Mobile uses `CurrencyFormatter` (Indian grouping, `₹`), matching the backend `formatINR`. |
| **Date-only fields** | `calendar_events.event_date`, `insurance_policies.renewal_date` and `subscriptions.next_billing_date` are calendar dates, not instants. Clients send `YYYY-MM-DD` (mobile: `DateFormatter.toDateOnly`) and the server treats them as date-only. Sending a UTC instant is a known day-shift hazard (§8.2). |
| **Percentages** | The API returns ratios already scaled to percent (e.g. `savingsRate: 24.5`), not fractions. Both clients append `%` without multiplying. |
| **Empty vs zero** | `savingsRate` is `0` (not `null`) when income is zero. Clients must not render "—" for a legitimate zero. |
| **Errors** | Backend envelope: `{ success: false, error: { code, message } }`. Mobile shows `error.message` only for 4xx; 5xx falls back to a generic message so internal text is not surfaced. |
| **Auth** | Every domain route is user-scoped server-side (`where: { userId }`). Cross-tenant reads return 404, not 403, to avoid leaking existence. |
| **Mutations from the assistant** | The assistant executes tools directly against the authenticated user (§ AI doc). There is no client-supplied balance anywhere; balances are recomputed server-side. |

---

## 7. Conflicts found and resolved in this pass

| # | Conflict | Resolution |
|---|---|---|
| 7.1 | `frontend/public/calendar.html` sent `notes:` when creating an event, but the controller reads `description`. Notes were **silently dropped**. | Payload now sends `description`. |
| 7.2 | `frontend/public/assets/js/api.js` called `POST /import/bank-statement` with multipart form data while the controller expects a JSON body `{ csvContent, accountId }`. | `bankStatement()` now sends JSON. |
| 7.3 | `ai-advisor.html` inserted model/RAG output with `innerHTML` before escaping. | Added `escapeHtml`; `formatMarkdown` escapes first, then applies a small allow-list of markdown. Source chips are escaped too. Also added history restore from `GET /ai/history`, which the page never called. |
| 7.4 | `GET /ai/history` ordered **ascending** and then took 50, returning the **oldest** 50 messages once a conversation grew past the cap — so both clients restored a stale opening. | Order `desc` + `take: 50` + `reverse()`, mirroring the chat-context query. Regression test added in `run-all-tests.js` (§9) and proven to fail against the old code. |
| 7.5 | Mobile had no calendar or insurance/subscription screens, so two primary planning modules were web-only. | Added `features/calendar/` and `features/insurance/` with models, create sheets, routes and settings tiles. |

---

## 8. Known defects and risks (documented, not fixed)

### 8.1 Aggregates include inactive rows
`GET /insurance` computes `summary.totalCoverage` and `summary.annualPremium` over **all** policies, while `summary.activePolicies` counts only active ones. `GET /subscriptions` does the same for `monthlyTotal` / `annualTotal` vs `activeSubscriptions`.

- **Impact:** a user who deactivates a policy still sees its coverage in the headline total.
- **Why not fixed here:** changing the totals changes numbers users already see on the web; that needs a product decision, not a parity fix.
- **Mobile behaviour:** shows the server summary **and** the active count, so the discrepancy is at least visible (`2 of 2 active`).
- **Suggested patch:** add `where: { isActive: true }` to the aggregate queries (or compute the totals from the active subset) and keep the inactive rows in the list.

### 8.2 Date-only timezone drift
**Resolved for the API contract.** Calendar dates (`Transaction.date`, `Goal.targetDate`, `Loan.startDate`, `InsurancePolicy.renewalDate`, `Subscription.nextBillingDate`, `CalendarEvent.eventDate`, `FinancialTask.dueDate`, `PaymentCard.dueDate`) are parsed as `YYYY-MM-DD` into UTC midnight for `@db.Date` and serialised back as `YYYY-MM-DD` (`utils/dateOnly.js`). Derived loan/goal events in the calendar are built from calendar parts, not the server's local timezone, and month windows use Asia/Kolkata. Impossible dates are rejected with `400`.

**Residual:** a legacy client that sends a full UTC ISO instant for a date-only field can still land on the previous/next local day. The contract is `YYYY-MM-DD`; clients must send that form. Web and mobile now do.

### 8.3 `create` and `list` use different field names
`POST /calendar/events` takes `{ eventType, eventDate }`; `GET /calendar/events` returns `{ type, date }`. Both clients now use the correct name per direction. A future API version should unify them.

### 8.4 Money movement (idempotency — deposits resolved in Phase 5, transfers in Phase 6)
**Original gap (Phase 3–4):** `POST /accounts/:id/deposit` had no idempotency key. A double-submit or a client retry after a timeout could credit twice; the in-flight/disabled button in both clients was not a server-side guarantee.

**Phase 5 — deposits resolved.** `POST /accounts/:id/deposit` and `POST /accounts/deposit` now accept an optional `idempotencyKey`. The guarantee is enforced by the database: the key is claimed in `idempotency_records`, whose primary key is `(userId, scope, key)`. A retry with the same details returns the original `transactionId` with `replayed: true` and does **not** credit the account again; a concurrent request converges on the same original transaction. A key reused with different deposit details (account, amount, date, source or description) returns **`409 IDEMPOTENCY_CONFLICT`** and writes nothing. The key is optional, so a client that does not send one behaves exactly as before. Both clients now send a stable key per logical deposit: the web client keeps one key until a confirmed success, and the mobile deposit sheet generates one per sheet (so every retry of that deposit reuses it). Verified with 16 mocked regression tests and 32 checks against a real PostgreSQL database (`node-backend/scripts/verify-deposit-idempotency.js`).

**Phase 6 — transfers resolved.** `POST /transactions` with `type: "TRANSFER"` accepts the same optional key under the `account_transfer` scope. The key claim, the transaction row, the source debit and the destination credit now commit or roll back together inside one Prisma transaction. A replay returns the original `transactionId` with `replayed: true` and no ledger effect; a conflicting payload returns `409`; concurrent identical requests create at most one transfer; a key whose original transaction was deleted stays claimed and is never recreated. Keys are scoped to the authenticated user. The web and mobile clients retain one key across retries of the same transfer and clear it only on confirmed success. Verified by the mocked `transactionTransferIdempotency.test.js` suite and 62 checks against a disposable PostgreSQL database (`node-backend/scripts/verify-transfer-idempotency.js`). The verifier refuses to run unless the target is explicitly marked and named as a test database.

**Remaining:** generic income/expense creation and loan payments still accept no key, so a retry of those can apply twice.

### 8.5 Web has no automated test harness
`frontend/public` is static HTML/CSS/JS with no `package.json` and no build step, and there is still **no automated browser test in CI**. The web fixes in §7 were verified by static inspection of the request/response contract.
**Phase 4 update:** the full propose → confirm → cancel journey was additionally **executed in a real browser** against the local backend, the local frontend and an isolated test database — including expiry, replay, a simulated network failure and five concurrent confirmations. The gap that remains is *automation*, not verification: the browser run is a manual procedure, documented in `docs/PHASE4_RELEASE_CHECKLIST.md` §5. **Phase 6 update:** the landing-page ripple was also browser-verified (animation, pointer pass-through, pagehide cleanup, no layout contribution and `prefers-reduced-motion` in real headless Chrome), still as a manual check.

### 8.6 Assistant mutations require a second step
**Resolved on the backend and web.** A tool call or deterministic mutating intent no longer executes when the model emits it. The server stores a SHA-256-hashed, user-bound, five-minute proposal and returns `pendingConfirmation` plus a one-time token; execution requires `POST /ai/actions/confirm`. Tokens are single-use, replay returns `409`, expiry returns `410`, and another user's token is `404`. Only one mutation is proposed per turn. See `AI.md` §6.

**Phase 4 update:** the token now moves `PENDING → EXECUTING → COMPLETED | FAILED` (see `AI.md` §6 and `API.md` §7.1). A consumed token is never reopened, a failed action is terminal, and exactly one of several concurrent confirmations can win. A chat-history write failure after a successful mutation no longer turns the result into an error.

**Residual:** the Flutter advisor still cannot approve a proposal. **Phase 4 update:** it now renders an explicit *"Not applied — open the FinPro web app to confirm or cancel it"* notice, and action chips are shown only when the server reports `action.executed == true`, so a proposal can never be presented as an applied change. The action is still not applied, so this fails closed rather than mutating silently.

---

## 9. Verification record

All commands were run from the paths shown on 2026-10-20.

| Check | Command | Result |
|---|---|---|
| Mobile static analysis | `cd mobile && flutter analyze --no-pub` | **No issues found** |
| Mobile tests | `cd mobile && flutter test --no-pub` | **181 passed, 0 failed** (includes the new calendar and insurance suites) |
| Backend syntax/lint | `cd node-backend && node scripts/lint.js` | **99 files, all clean** |
| Backend core suite | `cd node-backend && node run-all-tests.js` | **166 passed, 0 failed** (includes the `/ai/history` newest-50 guard and the propose → confirm → replay checks) |
| Backend SMS suite | `cd node-backend && node test-sms-mobile-suite.js` | **41 passed, 0 failed** |
| Cloud persistence suite | `cd node-backend && node test-cloud-verification.js` | **29 passed, 0 failed** |
| Cloud failure suite | `cd node-backend && node test-cloud-failure.js` | **17 passed, 0 failed** |
| Jest unit/security/failure suite | `cd node-backend && npm run test:unit` | **353 passed, 24 suites, 0 failed** |
| Whitespace / conflict markers | `cd "tanishq version" && git diff --check` | clean (exit 0) |

### Phase 4 verification record (2026-10-22)

| Check | Command | Result |
|---|---|---|
| Jest unit/security/failure suite | `cd node-backend && npx jest --runInBand` | **385 passed, 26 suites, 0 failed** (the Phase 3 run was not reproducible: one suite timed out because `.env` loaded a live provider key; `jest.setup.js` now blanks it) |
| Backend core suite | `cd node-backend && node run-all-tests.js` | **166 passed, 0 failed** |
| Backend SMS suite | `cd node-backend && node test-sms-mobile-suite.js` | **41 passed, 0 failed** |
| Cloud persistence / failure suites | `node test-cloud-verification.js` · `node test-cloud-failure.js` | **29 / 0** · **17 / 0** |
| Mobile tests | `cd mobile && flutter test` | **183 passed, 0 failed** (2 new AI-advisor cases) |
| Backend syntax/lint + secret scan | `cd node-backend && npm run lint` | **101 files clean** · 240 tracked files, **0 secrets** |
| Prisma schema / build | `npx prisma validate` · `npm run build` | valid · passed, client regenerated and field-checked |
| Migration — clean database | `createdb finpro_phase4_verify` → `prisma migrate deploy` | **6/6 applied**, schema, indexes and FK verified |
| Migration — additive upgrade over data | clone of the dev DB → `npm run db:reconcile` | P3005 → additive `db push`; **every row preserved** (71 tx, 85 users, sum 138097.00 before and after) |
| Confirmation state machine (real DB) | `node scripts/verify-ai-confirmation.js` | **31/31** on both databases |
| Backup & recovery drill | `node scripts/verify-backup-restore.js` | **PASSED** (plaintext + encrypted + wrong key + non-empty target refusal) |
| Web propose → confirm → cancel | real browser, local stack, isolated DB | executed end-to-end (expiry, replay, network failure, 5 concurrent confirms) |
| Whitespace / conflict markers | `cd "tanishq version" && git diff --check` | clean (exit 0) |

**Not verified:** live browser rendering, a real Android device/emulator, a live staging backend, and live Gemini responses. The backend AI tests stub the provider at the service boundary by design; see `TESTING.md`.

---

## 10. Deferred work (with the reason)

| Item | Why deferred |
|---|---|
| Market / watchlist on mobile | New feature area, not a parity *fix* of an existing workflow; needs a product decision on which instruments to show. |
| CSV/PDF import on mobile | File picking + multipart upload on Android is a self-contained feature; the web path is unaffected. |
| Receipt scan on mobile | Needs camera permissions and an upload UX; would change the permission surface. |
| Export on mobile | Low value on a phone (share sheet vs file); the backend endpoint already exists. |
| Cards and tasks UI | Neither surface has one; they are reachable through AI tools. Building two new UIs was out of scope for a parity pass. |
| SSE on mobile | Requires a reconnect/backoff client and lifecycle handling; pull-to-refresh covers correctness today, only latency differs. |
| Voice on mobile | The web uses the browser Speech API; Android would need a separate plugin and permission flow. |
