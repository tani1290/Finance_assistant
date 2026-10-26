# FinPro — Evaluation Demo Runbook

**Event:** academic evaluation, on or before **2026-11-05**
**Duration target:** 12–15 minutes live, plus Q&A
**Primary surface:** web (`https://fin-pro-wheat.vercel.app`)
**Backup surface:** Android APK (static/emulator only — no physical device)
**Backend:** `https://finpro-finance-ai.onrender.com`

---

## 1. The one rule

> **Warm the backend before you present, and never demo a cold free-tier
> instance for the first time in front of the examiner.**

The Render free instance sleeps after inactivity and can take tens of seconds to
resume. A cold start looks identical to an outage. Warm it, verify it, then
start talking.

---

## 2. Pre-demo checklist

### T-24 hours

- [ ] Confirm the backend is live at `f6cdf9f` or newer:
      `render deploys list srv-db5sb1vavr4c739td7d0 -o text`
- [ ] Confirm `/api/v1/health` returns `status:"healthy"`,
      `database:"connected"`.
- [ ] Confirm the database has not expired (deadline **2026-11-11**).
- [ ] Confirm the frontend loads: `/`, `/privacy.html`, `/terms.html`,
      `/delete-account.html`, `/simulator.html`.
- [ ] Re-read the two "do not claim" lists in
      [`FINPRO_EVALUATION_TEST_MATRIX.md`](FINPRO_EVALUATION_TEST_MATRIX.md) §18
      and [`PHASE9_FINAL_REPORT.md`](PHASE9_FINAL_REPORT.md) §8.
- [ ] Decide whether the demo will use the **web app only** (recommended) or
      also show the Android APK statically.

### T-1 hour

- [ ] Warm the backend:

```bash
HOST=https://finpro-finance-ai.onrender.com
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code} " "$HOST/api/v1/health"
  sleep 2
done
echo
```

Expected: twenty `200`s. If you see `502` or `429`, stop and investigate before
the demo. Do not "try again later" in front of the examiner.

- [ ] Create a **fresh demo account** through the UI. Do not use a personal
      account, and do not reuse an account from a previous run.
- [ ] Seed it with a small, readable dataset (see §3).
- [ ] Open the app in a normal browser window, zoom 100%, notifications off.
- [ ] Close any tab that shows a token, a database URL, or a terminal with
      secrets.

### T-10 minutes

- [ ] Reload the app once. Confirm login still works.
- [ ] Run one throwaway AI prompt (see §5) to confirm the provider is not
      rate-limited.
- [ ] Run one throwaway market quote to confirm the upstream is alive.
- [ ] Have the fallback screenshots ready (§7) in a local folder.
- [ ] Silence the phone. If using a hotspot, confirm it is connected.

---

## 3. Demo dataset

Create this **through the UI**, not SQL. It takes about three minutes and makes
the dashboard look real without exposing anyone's finances.

| Item | Value |
|---|---|
| Account 1 | `HDFC Savings`, opening balance `₹50,000` |
| Account 2 | `Cash Wallet`, opening balance `₹2,000` |
| Income | `Salary — October`, `₹45,000`, category `Salary` |
| Expense | `Groceries — BigBasket`, `₹3,200`, category `Food` |
| Expense | `Electricity bill`, `₹1,450`, category `Utilities` |
| Transfer | `₹5,000` from HDFC Savings to Cash Wallet |
| Budget | `Food`, monthly limit `₹8,000` |
| Budget | `Utilities`, monthly limit `₹3,000` |

Why this dataset:

- It produces a non-zero dashboard without clutter.
- The transfer proves the two-leg ledger and the transfer-exclusion rule.
- The Food budget is under 50%, so the UI does not look alarming.
- The Utilities budget is near its limit, which gives you something to explain.

Do **not** seed a fake "salary" of ₹10,00,000. It looks staged and makes the
charts unreadable.

---

## 4. Demo script (12–15 minutes)

### 0:00–1:00 — Frame the problem (no clicking)

Say:

> "FinPro is a personal finance and investment decision-support platform. The
> problem is not that people lack data — it is that transactions, budgets,
> receipts, market prices and advice live in different places. FinPro puts them
> in one ledger, with an AI assistant that can propose an action but cannot
> apply it without an explicit confirmation."

Then show the landing page and the five top-level surfaces: dashboard,
transactions, budgets, AI assistant, market.

### 1:00–3:00 — Register / login and isolation

1. Log in with the fresh demo account.
2. Open **Dashboard**. Point at the balance, income, expense and budget cards.
3. Say: "Every query is scoped by `userId` at the controller and enforced again
   by the database. A second user reading this account id gets `404`, not `403`,
   so the API does not confirm that the id exists."

Do **not** spend time on the login form. The interesting part is the isolation
claim, not the password field.

### 3:00–5:30 — Transactions and the ledger

1. Open **Transactions**. Show the salary, groceries and electricity rows.
2. Add one expense live: `Coffee — Third Wave`, `₹280`, category `Food`.
3. Show the account balance drop by exactly `₹280`.
4. Open **Accounts**. Show `HDFC Savings` and `Cash Wallet`.
5. Show the `₹5,000` transfer and explain:

> "A transfer is two ledger legs in one database transaction. It is excluded
> from income and expense totals, because moving money between your own accounts
> is not earning or spending. The invariant is that every account balance equals
> its opening balance plus its ledger deltas."

6. If asked about retries: "Deposits and transfers accept an optional
   idempotency key. The same key replays the same transaction; a different
   payload with the same key is a `409`."

### 5:30–7:00 — Budgets and dashboard agreement

1. Open **Budgets**. Show Food at `₹3,480 / ₹8,000` after the coffee.
2. Say: "The budget card and the dashboard use the same aggregation path, so
   they cannot disagree. This was a real bug class we tested for — the dashboard
   and the AI used to compute periods differently."

### 7:00–9:30 — AI assistant (the confirmation gate)

1. Open **AI Assistant**.
2. Ask a read-only question first:

   > "How much did I spend on food this month?"

   Expected: a summary that matches the budget card. This proves the assistant
   reads the same ledger.

3. Ask for a mutation:

   > "Add an expense of 500 rupees for a textbook."

   Expected: the assistant proposes the action and asks for confirmation. It
   does **not** write the row yet.

4. Point at the confirmation control. Say:

> "The model can propose, but it cannot commit. The proposal carries a hashed
> token with an expiry. Confirming claims it exactly once — five concurrent
> confirms produce one winner and four conflicts. Replaying a completed action
> is terminal, so a double-click cannot double-post."

5. Confirm it. Show the new transaction and the balance change.
6. Optional: cancel a second proposal to show the other branch.

If the AI provider is slow or quota-limited, skip step 2 and use the fallback in
§7. Do not debug a provider in front of the examiner.

### 9:30–11:00 — Market data and receipts

Pick **one**, not both, depending on time.

**Market:** open the market surface, search `RELIANCE`, show the live quote and
the "last updated" timestamp. Say: "Public market data is cached and bounded;
provider failure degrades to a safe error, not a 500."

**Receipt:** upload a small receipt image. Show the extracted merchant, amount
and confidence, then confirm it into an expense. Say: "OCR is a convenience, not
a source of truth — the user confirms the parsed amount before it becomes a
ledger row."

Do **not** upload a real receipt with a card number or UPI id. Use the synthetic
receipt in the repo or a freshly generated one.

### 11:00–12:30 — Privacy and deletion

1. Open `/privacy.html` and `/delete-account.html` in a new tab.
2. Say: "Deletion is available in-app and on the web. It requires the password
   and the literal confirmation `DELETE`. It purges stored files first, then
   deletes the user row; 38 foreign keys cascade. The old token is invalid
   immediately."

Do **not** delete the demo account during the demo unless you have a second
account ready. Deleting it ends the demo.

### 12:30–14:00 — Architecture in one slide

Show the diagram in
[`FINPRO_CLOUD_ARCHITECTURE_DEFENSE.md`](FINPRO_CLOUD_ARCHITECTURE_DEFENSE.md) §2
and say:

> "Browser and mobile talk to one Express API. The web client is static on
> Vercel and proxies `/api/*` to Render, so there is one origin and no CORS
> surprise for the browser. The API uses Prisma against PostgreSQL. Auth is JWT
> access plus rotating refresh tokens. Every financial write is tenant-scoped
> and, for deposits and transfers, idempotent. The platform runs one Docker
> instance on Render's free tier, which is enough for a demo and honest about
> its limits: no Redis, no durable object storage, and a database that expires
> on 2026-11-11."

### 14:00–15:00 — Close with the honest gap list

Say:

> "What is verified: the web app, the API, the database invariants, the AI
> confirmation gate, storage isolation and deletion. What is not: a physical
> Android device, production load, off-host backup restore, and AI answer
> quality. Those are environmental gaps, not hidden ones."

Then stop. Do not fill silence with new claims.

---

## 5. Safe AI prompts

Use prompts with a deterministic, checkable answer:

| Prompt | Expected |
|---|---|
| "How much did I spend on food this month?" | A number matching the Food budget card |
| "What is my current HDFC Savings balance?" | The balance shown on the Accounts page |
| "Add an expense of 500 rupees for a textbook." | A proposal + confirmation request, no write |
| "Show my last three transactions." | The three most recent rows, newest first |
| "Create a budget of 2,000 for Transport." | A proposal, then confirmation |

Avoid open-ended prompts ("What should I invest in?", "Am I doing well
financially?") during a timed demo. They are legitimate product questions, but
the answer quality is not evaluated and the latency is variable.

---

## 6. The simulator: what to say

The synthetic payment simulator is **disabled in production** by design. Do not
try to seed it live and do not claim that payments work in production.

Say:

> "The payment simulator is a two-key feature: it must be enabled explicitly and
> it refuses to run in production. That is deliberate — it moves synthetic money
> and must never be reachable on the public deployment. Its full state machine
> was verified locally: success, pending, failure, refund, reversal,
> insufficient funds, idempotent replay and reset. In production you can read its
> status, but every mutation returns `403 SIMULATOR_DISABLED`."

If the examiner wants to see it, show the local evidence in
[`FINPRO_EVALUATION_TEST_MATRIX.md`](FINPRO_EVALUATION_TEST_MATRIX.md) §9, not a
production workaround.

---

## 7. Fallback plan

| Failure | Immediate action | What to say |
|---|---|---|
| Backend cold start / `502` | Keep the tab open; run the warm-up loop; wait up to 60 s | "The free tier is waking up. This is a platform limit, not an application error." |
| Backend still down | Switch to the recorded screenshots / local stack | "The deployed instance is unavailable; here is the same flow from the verified run." |
| AI provider slow / quota | Skip the live AI answer; show the confirmation-gate screenshots and the verifier output | "The provider is rate-limited; the gate itself is verified against a real database." |
| Market provider down | Skip market; do receipts instead | "The upstream is unavailable; the app degrades to a safe error." |
| Upload fails | Skip storage; show the 23-check storage evidence | "Production storage is local and ephemeral; durability is a known blocker." |
| Database expired | Stop. Do not improvise. | "The free database has expired; this is the known 2026-11-11 risk." |

**Fallback assets to keep locally:**

- Dashboard screenshot with the demo dataset.
- AI proposal + confirmation screenshot.
- Receipt OCR result screenshot.
- `verify-transfer-idempotency.js` final output.
- `verify-ai-confirmation.js` final output.
- The architecture diagram from the defense document.

Screenshots are evidence of a prior run, not a live demo. Label them as such.

---

## 8. Q&A quick answers

| Question | Answer |
|---|---|
| "Is this production-ready?" | "The web and API are live and verified. Durable storage, database expiry, device testing and off-host backup are open. I would not call it production-certified." |
| "How do you stop double-spending?" | "Deposits and transfers use per-user idempotency keys enforced by a unique constraint. Concurrent identical requests converge on one row; conflicting payloads get `409`. Generic income/expense creation is not idempotent — that is a documented gap." |
| "Can the AI move money on its own?" | "No. It can propose. A hashed, expiring token must be confirmed, and the claim is a single conditional update. Completed, failed and cancelled proposals are terminal." |
| "How is tenant isolation enforced?" | "Every query is scoped by the authenticated `userId`; cross-tenant reads return `404`. The database adds unique and foreign-key constraints, and 38 user-owned FKs cascade on deletion." |
| "Why one instance?" | "Free tier. The app is stateless apart from local uploads, so it can scale horizontally, but rate limits and cache would become per-instance without Redis." |
| "What happens if Redis is down?" | "There is no Redis in production. If one is configured, the app falls back to in-process memory after a circuit breaker opens; Redis is never required for a core path." |
| "What is the biggest risk?" | "The Render database expires on 2026-11-11. A verified encrypted backup exists, but the plan needs an owner decision." |
| "Did you pen-test it?" | "No. I ran the repository's security suites, a tracked-secret scan, a dependency audit and cross-tenant probes. That is not an independent penetration test." |
| "Does it work on Android?" | "The APK and AAB are signed and statically validated, and 239 widget tests pass. There is no physical device or emulator here, so I cannot claim a device run." |

---

## 9. Post-demo cleanup

- [ ] Delete the demo account through the UI (password + `DELETE`).
- [ ] Confirm the old token is rejected.
- [ ] If you uploaded a file, confirm it is gone.
- [ ] Confirm production row counts returned to baseline (optional, read-only).
- [ ] Do not leave the demo account or its data in production.

---

## 10. Timing card (print this)

```text
0:00  Problem + surfaces
1:00  Login + dashboard + isolation
3:00  Transactions + live expense + transfer
5:30  Budgets agree with dashboard
7:00  AI read-only answer
7:45  AI proposal -> confirm
9:30  Market OR receipt (pick one)
11:00 Privacy + deletion
12:30 Architecture
14:00 Honest gaps
15:00 Stop
```

If you are running late, cut the market/receipt section and the optional cancel
branch. Never cut the AI confirmation gate or the honest gaps.
