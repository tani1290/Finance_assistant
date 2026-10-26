# FinPro — Cloud Architecture & Defense

**Purpose:** the single document to read before defending the system. It explains
what runs where, why, what happens when a dependency fails, and which claims are
supported by evidence.

**Verified against:** backend `b9c054c` (live `dep-dbflt99srm7s73ff9bp0`),
frontend `https://fin-pro-wheat.vercel.app`, database `finpro-db`
(PostgreSQL 18.6), 2026-10-26.

---

## 1. What the system is

FinPro is a multi-tenant personal finance and investment decision-support
platform for the Indian market (INR, `Asia/Kolkata`, NSE/BSE, MCX/COMEX). It has
three surfaces:

| Surface | Technology | Role |
|---|---|---|
| Web | Static HTML + vanilla JS + CSS + ECharts, served by Vercel | Primary demo surface |
| Android | Flutter 3.38 / Dart 3.10, Riverpod, native SMS channel | Mobile client |
| API | Node.js + Express 4 + Prisma 5.22 | Single source of financial truth |

The AI assistant is a **feature of the API**, not a separate service. It uses
Google Gemini with tool calling, a deterministic fallback, and RAG over the
user's own data.

---

## 2. Deployment topology

```text
                         ┌──────────────────────────────┐
                         │        Evaluator / User      │
                         │  Browser        Android app  │
                         └───────┬──────────────┬───────┘
                                 │ HTTPS        │ HTTPS
                                 ▼              │
                 ┌───────────────────────────┐  │
                 │  Vercel (static + CDN)    │  │
                 │  fin-pro-wheat.vercel.app │  │
                 │                           │  │
                 │  /            -> index    │  │
                 │  /privacy.html            │  │
                 │  /terms.html              │  │
                 │  /delete-account.html     │  │
                 │  /simulator.html          │  │
                 │  /api/(.*) -> Render      │  │
                 └─────────────┬─────────────┘  │
                               │ rewrite        │
                               ▼                ▼
                 ┌─────────────────────────────────────────┐
                 │  Render web service (Docker, 1 instance)│
                 │  finpro-finance-ai.onrender.com         │
                 │                                         │
                 │  Express 4.22                           │
                 │   ├─ helmet / CORS allowlist / limits   │
                 │   ├─ JWT auth + refresh rotation        │
                 │   ├─ REST controllers                   │
                 │   ├─ AI orchestration + tool registry   │
                 │   ├─ OCR (tesseract.js / pdf-parse)     │
                 │   ├─ market aggregation + cache         │
                 │   └─ health / metrics / static fallback │
                 └───────┬───────────────┬─────────────────┘
                         │ Prisma        │ HTTPS
                         ▼               ▼
        ┌────────────────────────┐   ┌──────────────────────────────┐
        │ Render PostgreSQL 18.6 │   │ External providers           │
        │ finpro-db (free)       │   │  Gemini (AI)                 │
        │ 44 tables, 50 FKs      │   │  Market data APIs            │
        │ 11 migrations          │   │  Firebase Admin (FCM)        │
        │ expires 2026-11-11     │   │  Local disk (uploads)        │
        └────────────────────────┘   └──────────────────────────────┘
```

### 2.1 Why this shape

- **One API, two clients.** The web and Android clients share the same REST
  contract, so a financial invariant is enforced once.
- **Vercel for static delivery.** The web client has no build step; Vercel gives
  CDN caching, TLS and a same-origin `/api` rewrite. The rewrite avoids
  browser CORS for the primary demo surface.
- **Render for the API.** A Docker service gives a reproducible runtime and a
  free public HTTPS endpoint. The trade-off is a single instance, cold starts,
  and ephemeral disk.
- **Managed PostgreSQL.** ACID transactions, foreign keys and unique constraints
  are load-bearing for the ledger and idempotency guarantees. A document store
  would make the two-leg transfer and key-claim invariants harder to prove.

---

## 3. Component responsibilities

| Component | Responsibility | Key files |
|---|---|---|
| `app.js` | Middleware order, CORS, rate limits, route mounting, health | `node-backend/src/app.js` |
| Auth | Register, login, refresh rotation, logout, deletion | `src/services/authService.js`, `src/controllers/authController.js` |
| Accounts | CRUD, opening balance, tenant scoping | `src/controllers/accountController.js` |
| Transactions | Income/expense/transfer, ledger effects, pagination | `src/controllers/transactionController.js` |
| Idempotency | Per-user key claim, replay, conflict | `src/services/idempotencyService.js`, `idempotency_records` |
| Budgets | CRUD, usage aggregation | `src/controllers/budgetController.js` |
| Dashboard / analytics | Period + basis aggregation, category totals | `src/controllers/analyticsController.js` |
| AI | Gemini tool calling, deterministic fallback, RAG, confirmation gate | `src/services/aiService.js`, `src/services/aiConfirmationService.js` |
| Market | Quote/news/metals aggregation, cache, circuit breaker | `src/services/marketService.js` |
| Simulator | Synthetic payment state machine, two-key gating | `src/controllers/simulatorController.js` |
| Receipts | Text + image OCR, confirm into ledger | `src/controllers/ocrImportController.js` |
| Storage | Upload validation, tenant isolation, download hardening | `src/controllers/storageController.js`, `src/services/storageService.js` |
| Notifications | FCM registration, bounded push queue | `src/services/pushService.js` |
| Health | Liveness, dependency gate, readiness, per-dependency probes | `src/app.js`, `src/services/healthService.js` |
| Cache | L1 memory + optional Redis L2, singleflight, circuit breaker | `src/services/cacheService.js` |

---

## 4. Request lifecycle

A typical authenticated write:

```text
Browser
  │  POST /api/v1/transactions  (Bearer access token)
  ▼
Vercel rewrite
  │  https://finpro-finance-ai.onrender.com/api/v1/transactions
  ▼
Express
  ├─ helmet            security headers
  ├─ CORS              origin allowlist
  ├─ compression       gzip (except SSE)
  ├─ json body limit   10 MB
  ├─ rate limiter      1000/15 min, health/realtime skipped
  ├─ request logger    request id, method, path, status, latency
  ├─ auth middleware   verify JWT, attach req.user
  ├─ validator         express-validator
  ├─ controller        tenant-scoped query / transaction
  ├─ service           ledger rules, idempotency claim
  ├─ Prisma            parameterised SQL
  └─ PostgreSQL        constraints, transaction, commit
  ▼
Response envelope
  { success: true, data: ... }
  or
  { success: false, error: { code, message } }
```

Three properties matter for the defense:

1. **Middleware order is intentional.** Auth runs after rate limiting but before
   validation and controllers. A request cannot reach a controller without a
   verified identity.
2. **The envelope is uniform.** Clients do not parse ad-hoc shapes.
3. **Errors do not leak internals.** The central error handler maps known errors
   to codes and hides stack traces in production.

---

## 5. Data model and tenancy

### 5.1 Core entities

```text
User
 ├─ FinancialAccount (1..n)
 │    └─ Transaction (1..n)  ── ledger effects
 ├─ Budget (1..n)
 ├─ Category (1..n)
 ├─ IdempotencyRecord (1..n)
 ├─ RefreshToken (1..n)
 ├─ AiProposal (1..n)
 ├─ ChatMessage (1..n)
 ├─ ReceiptScan (1..n)
 ├─ FcmToken (1..n)
 └─ AuditLog (1..n)
```

### 5.2 Tenancy

- Every financial query includes `{ userId: req.user.id }`.
- Cross-tenant reads return **404**, not 403, so the API does not confirm that a
  foreign id exists.
- The database adds unique constraints for per-user idempotency keys and
  foreign keys for ownership.
- 38 foreign keys reference `users` with `ON DELETE CASCADE`, so account
  deletion is complete rather than partial.

### 5.3 Financial invariants

| Invariant | Enforcement |
|---|---|
| Account balance = opening balance + sum of ledger deltas | Single write path; reconciliation verified by `verify-transfer-idempotency.js` |
| A transfer has exactly one debit and one credit | One Prisma transaction; rollback on either leg failing |
| Transfers are excluded from income/expense | Aggregation filters `type != TRANSFER` |
| A deposit with a key credits once | Unique `(userId, key)` claim inside the transaction |
| Same key + different payload = conflict | Payload hash comparison → `409 IDEMPOTENCY_CONFLICT` |
| AI cannot mutate without confirmation | Hashed expiring token; conditional claim; terminal states |
| Deletion removes all user-owned rows | 38 cascading FKs + storage purge before row delete |

### 5.4 Money and dates

- Money is stored as a decimal/integer-safe representation, never floating point
  for ledger arithmetic.
- Date-only fields (`YYYY-MM-DD`) are not converted through UTC midnight, which
  avoids the classic "expense moves to the previous day" bug.
- Period aggregation resolves the user's timezone (`Asia/Kolkata`) before
  computing month boundaries.

---

## 6. Security architecture

Defense in depth, from the edge inward:

| Layer | Control | Evidence |
|---|---|---|
| Transport | HTTPS everywhere; no cleartext opt-in in Android | Live TLS; manifest inspection |
| Edge | Vercel security headers (`nosniff`, `DENY`, XSS) | `vercel.json`; live headers |
| App headers | Helmet CSP/HSTS/frame rules | Code + live response |
| CORS | Explicit origin allowlist, credentials enabled | `OPTIONS` from both deployed origins → 204 |
| Body size | 10 MB JSON limit | Oversized upload → 413 |
| Rate limits | General 1000/15 min; auth 100/15 min; deletion 5/hour; health exempt | Local probe + production 24/24 |
| Identity | JWT access + rotating refresh; refresh stored hashed | Auth tests; schema |
| Passwords | bcrypt | Auth service |
| Authorization | `userId` scoping on every query; 404 on foreign ids | Production cross-tenant probes |
| Upload | MIME sniffing, extension allowlist, size limit, tenant prefix | 23-check storage smoke |
| Download | `nosniff`, sandbox CSP, no inline rendering | Production headers |
| Secrets | `.env` untracked; tracked-secret scan | 367 files, 0 secrets |
| Dependencies | `npm audit --omit=dev`; critical advisory fixed and deployed in `b9c054c` | 0 critical, 3 remaining majors |
| Deletion | Password + literal `DELETE`; token invalidated | Production lifecycle smoke |

### 6.1 What is **not** claimed

- No independent penetration test.
- No WAF or DDoS protection beyond the platform.
- No secret manager; environment variables are the current store.
- No field-level encryption at rest beyond the platform's disk encryption.
- No formal threat-model certification.

---

## 7. Reliability and failure behaviour

| Dependency | Failure mode | Behaviour | Verified |
|---|---|---|---|
| PostgreSQL | Down / slow | Health dependency probe → 503; requests fail with a safe error | Jest + live probe |
| Redis | Absent / down | Falls back to in-process memory; circuit opens; no 500 | Jest; production has no Redis |
| Object storage | Missing object | 404 passthrough, not 503 | Jest + live probe |
| Object storage | Production misconfigured | Fail closed in production; explicit/dev fallback only | Jest |
| Gemini | Timeout / error | Deterministic fallback; bounded retry; no 500 | `run-all-tests.js` |
| Market provider | Timeout / 429 / 404 | Bounded retry, circuit breaker, safe error; 404 is valid | Jest |
| FCM | No token | `404 NO_TOKENS`; queue bounded | Production smoke + Jest |
| Health probe | Rate limited | **Fixed:** health is exempt from the general limiter | Local 1100/1100; production 24/24 |
| Cold start | Free instance asleep | 30–60 s resume; mitigated by warming | Observed; not measured |
| Redeploy | Local disk lost | Uploads disappear; documented | `durable:false` |

### 7.1 The incident that mattered

The health probe shared the general API rate limiter. Render probes every ~5 s,
which exhausted the budget, produced `429`, marked the instance unhealthy, and
restarted it — a self-reinforcing `502` loop. The fix exempts `/api/v1/health*`
and raises the interactive budget to 1000/15 min. This is the clearest example
of why "it works locally" is not an operations claim.

---

## 8. Deployment and change management

```text
local change
  → lint + secret scan
  → Jest + custom suites + real-DB verifiers
  → build verification
  → commit on finpro/pre-deployment-checkpoint
  → push origin
  → explicit Render deploy for the exact SHA
  → live health + smoke
```

- **No auto-deploy assumption.** Render's `autoDeploy` did not reliably fire on
  push, so deploys are explicit: `render deploys create ... --commit <sha>`.
- **No force-push or history rewrite.**
- **No migration added in Phase 9.** The 11 existing migrations are applied.
- **Blueprint drift is documented, not "fixed".** `render.yaml` says `runtime:
  node` and `/api/v1/health/live`; the live service is Docker with
  `/api/v1/health`. Re-applying the blueprint could recreate the service, so it
  is deferred until after evaluation.
- **Frontend is manually deployed** with `vercel --prod`; a push does not publish
  it.

---

## 9. Observability

| Signal | Where | Current state |
|---|---|---|
| Health | `/api/v1/health*` | Live, stable |
| Request logs | Render logs | Method, path, status, latency, request id |
| Metrics | `/metrics` | 404 without `METRICS_TOKEN` |
| Audit log | `audit_logs` table | 29 rows at baseline |
| Push queue | In-process counters | Bounded, tested |
| Cache | `/health/dependencies` | Reports configured/available |

There is **no** external APM, no distributed tracing, and no alerting. The
evaluation demo relies on health probes and logs. This is honest: the system is
observable enough to operate a demo, not enough to run a production SLO.

---

## 10. Cost model

| Item | Plan | Cost | Constraint |
|---|---|---|---|
| Render web service | Free | $0 | Sleeps, 512 MB, 1 instance |
| Render PostgreSQL | Free | $0 | **Expires 2026-11-11** |
| Vercel | Hobby | $0 | Static + rewrite |
| Gemini | Free tier | $0 | Quota-limited |
| Market APIs | Free tier | $0 | Rate-limited |
| Firebase | Spark | $0 | FCM |
| Object storage | None | $0 | Ephemeral local disk |

The cheapest credible upgrade is the Render Postgres `0.1c-256mb` plan at about
**$6/month**, which removes the expiry. Durable object storage would add a
second small monthly cost. Nothing else needs to change to survive the
evaluation window.

---

## 11. Trade-offs (say these before you are asked)

| Decision | Benefit | Cost | Why acceptable now |
|---|---|---|---|
| One Express API, not microservices | One place to enforce ledger invariants; simple deploy | Single blast radius; no independent scaling | Team size and demo scale |
| PostgreSQL + Prisma | ACID, constraints, typed queries | Migration discipline; ORM overhead | Financial correctness dominates |
| Static web, no framework | No build step, fast CDN delivery, trivial deploy | Manual DOM code; no component model | Surface is small; verified manually |
| Local disk storage | Zero setup | Files lost on redeploy | Demo uploads are short-lived; S3 path exists |
| No Redis | Fewer moving parts | Per-instance limits/cache | One instance today |
| AI proposal gate | Prevents autonomous mutation | Extra click; more state | Safety is the point |
| Simulator disabled in production | Cannot move synthetic money publicly | Cannot demo payments live | Local evidence is strong |
| Manual deploy | Exact SHA control | Human step; can forget | Auto-deploy was unreliable |
| Free tier | $0 | Cold start, expiry, 512 MB | Evaluation is a short window |

---

## 12. Threat model (STRIDE, abbreviated)

| Threat | Example | Control | Residual |
|---|---|---|---|
| **S**poofing | Stolen access token | Short-lived JWT, rotating refresh, hashed refresh storage | Token theft until expiry; no device binding |
| **T**ampering | Modify another user's transaction | `userId` scoping, 404, FK ownership | None known in tested paths |
| **R**epudiation | Deny creating a transaction | `audit_logs`, request ids | No cryptographic non-repudiation |
| **I**nformation disclosure | Read another user's receipt | Tenant prefix + 403/404; `nosniff` | Local disk is not encrypted per-object |
| **D**enial of service | Flood the API | Rate limits, body limit, bounded queues | Free instance can still be overwhelmed; no WAF |
| **E**levation of privilege | Call an admin path | No admin surface in the public API; auth middleware | Not independently tested |
| Prompt injection | Ask the AI to exfiltrate data | Tool registry + tenant scoping + confirmation gate | Answer quality/injection not formally evaluated |
| Supply chain | Malicious dependency | Lockfile, audit, no critical advisories | 3 majors remain; no SBOM/signing |

---

## 13. Likely examiner questions

**"Why not microservices?"**
> "The hard part is financial correctness, not independent scaling. A transfer
> touches two ledger legs and an idempotency claim; keeping that in one process
> and one database transaction is simpler to prove. I would split out OCR or
> market ingestion first, because they are CPU/network-bound and stateless."

**"How do you guarantee a transfer cannot half-apply?"**
> "Both legs and the key claim are inside one Prisma transaction. A mid-flight
> failure rolls back the row, both balance writes and the claim. The verifier
> injects a failure into the second leg and checks the balances reconcile."

**"What happens if two identical deposits arrive at once?"**
> "The unique key claim lets one transaction win; the others either replay the
> same row or get a conflict. Thirty-two checks against a real PostgreSQL prove
> it, including five concurrent conflicting payloads."

**"Why is the AI allowed to touch money at all?"**
> "It is not. It proposes. A hashed, expiring token must be confirmed, the claim
> is a single conditional update, and completed/failed/cancelled are terminal."

**"How do you isolate tenants?"**
> "Every query is scoped by the authenticated user id, and foreign keys enforce
> ownership. Cross-tenant reads return 404 so the API does not leak existence.
> Production probes covered accounts, transactions, storage and receipts."

**"What is your availability story?"**
> "One free instance, health-checked every few seconds, with a dependency-aware
> health endpoint. It is not highly available. The health-probe rate-limit bug
> was a real availability defect and is fixed. Scaling out would need Redis for
> shared limits and durable storage for uploads."

**"What would you fix first with a budget?"**
> "Pay for the database plan so it stops expiring, then durable object storage,
> then a physical Android test device. Those are the three blockers that are
> environmental rather than architectural."

**"What is the weakest part of the system?"**
> "Operational maturity: no scheduled off-host backup, no APM/alerting, no
> independent security test, and a free database that expires. The application
> logic is in better shape than the operations around it."

**"Why does the dashboard agree with the AI?"**
> "They share the aggregation path and the timezone/period resolution. Earlier
> they did not, which is why there is a regression suite for period, basis and
> transfer exclusion."

**"What is not tested?"**
> "Physical Android, production load, off-host restore, AI answer quality, and
> independent penetration testing. I will not claim those."

---

## 14. If there were another month

Ordered by risk reduction per unit of effort:

1. **Pay for the Render Postgres plan** (or migrate) — removes a hard deadline.
2. **Durable object storage** — uploads survive redeploy; S3 path already exists.
3. **Scheduled encrypted backup + off-host copy + restore drill** — closes the
   largest disaster-recovery gap.
4. **Physical Android test pass** — permissions, SMS, links, push, TalkBack.
5. **Redis** — shared rate limits and cache before any horizontal scaling.
6. **APM + alerting** — health is not monitoring.
7. **Major dependency upgrades** (`zod`, `node-cron`) with a full regression run.
8. **Independent security review** — the current evidence is self-assessment.

---

## 15. Defense checklist

- [ ] I can draw the topology from memory.
- [ ] I can explain the two-leg transfer and the idempotency claim.
- [ ] I can explain why the AI cannot mutate without confirmation.
- [ ] I can name the three environmental blockers without hedging.
- [ ] I can distinguish L1/L2/L3/L4/L5 evidence.
- [ ] I do not claim "production-ready", "secure", "pen-tested", or "device-tested".
- [ ] I know the database expiry date: **2026-11-11**.
- [ ] I know the live commit: **`b9c054c`**.
- [ ] I have the fallback screenshots ready.
- [ ] I have warmed the backend.
