# FinPro Phase 9 — Evaluation-Readiness Audit

**Date:** 2026-10-26
**Branch:** `finpro/pre-deployment-checkpoint`
**Audit baseline:** `f6cdf9f4c3e2eb65c1012eb9c7e883d9fa686ebc`
**Target event:** academic evaluation on or before **2026-11-05**
**Mode:** read-only audit first; remediation only after the baseline was recorded

---

## 1. Why this document exists

Phase 8 finished the deployment and produced live evidence. Phase 9 is not a
feature phase. Its only job is to answer one question honestly:

> Can this system be demonstrated and defended on **2026-11-05** without
> discovering a new blocker during the demo?

That means separating four things that are easy to blur together:

1. **Verified** — observed directly, with a command or a live response.
2. **Implemented but unverified** — code exists and passes local tests, but no
   environment proves the deployed behaviour.
3. **Blocked** — cannot be completed from this machine without an owner decision,
   billing change, credential, or external console.
4. **Not tested** — no evidence at all, usually because the hardware or
   environment is absent.

This audit deliberately does **not** claim security certification, independent
penetration testing, production capacity, or physical-device validation.

---

## 2. Method

### 2.1 Read-only inventory

The following were inspected before any file was changed:

| Area | What was inspected |
|---|---|
| Git | branch, HEAD, tracked modifications, untracked files, remotes |
| Deployment | Render service, deploy history, live commit, health payload, logs |
| Database | migration table, table count, foreign keys, cascade rules, row counts |
| Backend | route table, middleware order, auth, rate limiting, storage, OCR, simulator, AI, market, FCM, deletion |
| Frontend | Vercel production deployment, rewrite proxy, legal pages, static assets |
| Mobile | Flutter analysis/tests, signed APK/AAB, merged manifest, package/version |
| Tests | Jest, four custom suites, three real-database verifiers, simulator harness |
| Supply chain | `npm audit --omit=dev`, lockfile drift, tracked-secret scan, syntax lint |
| Operations | health semantics, backup drill, database expiry, storage durability |

### 2.2 Evidence rules

- A route existing is **not** proof that it works.
- A passing mocked test is **not** proof of a real database constraint.
- A local harness is **not** proof of production.
- A production smoke test with a synthetic account is **not** a load test.
- Anything not executed is written as **NOT TESTED**, not inferred as passing.

### 2.3 Safety constraints observed

- No force-push, history rewrite, branch deletion, reset, clean, or stash.
- No production data deletion. Synthetic production accounts were removed only
  through the account-deletion API.
- No Render plan change, billing change, storage migration, or Play submission.
- No destructive test against production. Destructive verifiers ran only against
  the isolated local database `finpro_phase9_verify`.
- No credential, token, encryption key, or private financial record is printed
  in this document.

---

## 3. Baseline state

### 3.1 Git

| Item | Value |
|---|---|
| Repository root | `/Volumes/Projects/Minor/FINpro/tanishq version` |
| Branch | `finpro/pre-deployment-checkpoint` |
| HEAD at audit start | `f6cdf9f4c3e2eb65c1012eb9c7e883d9fa686ebc` |
| `origin` HEAD | `f6cdf9f4c3e2eb65c1012eb9c7e883d9fa686ebc` |
| Working tree | one modification: `node-backend/package-lock.json` |
| Phase 9 docs at audit start | none |

Recent history:

```text
f6cdf9f fix(api): exempt health probes from general rate limiter
4e9b6d3 docs(release): record deployed SHA 020a49d and live 404-passthrough probe
020a49d docs(release): record Phase 8 production evidence, backup drill and expiry risk
574337d fix(storage): pass provider 404 through instead of masking as outage
```

### 3.2 Production topology

| Component | Observed value |
|---|---|
| Backend | `https://finpro-finance-ai.onrender.com` |
| Render service | `srv-db5sb1vavr4c739td7d0` |
| Runtime | Docker, free plan, Oregon, 1 instance |
| Live deploy | `dep-dbfl1oq9lscs73ahr2hg` at `f6cdf9f` |
| Health check path | `/api/v1/health` |
| Database | `finpro-db` (`dpg-db6c6kad0e5s73a6lbf0-a`), PostgreSQL 18.6, free plan |
| Database expiry | **2026-11-11T11:24:01Z**; deletion after grace on **2026-11-25T11:24:01Z** |
| Frontend | `https://fin-pro-wheat.vercel.app` (project `fin-pro`) |
| Frontend deploy | `dpl_Ea5wGLndgRM1ffJabZs1ieoD9oQP` |
| API path | relative `/api/v1`, proxied by `vercel.json` to Render |
| Object storage | local disk, `durable:false`, `ephemeral:true` |
| Redis | not provisioned |
| Metrics | `/metrics` → 404 (no `METRICS_TOKEN`) |

Live health payload at audit time:

```json
{
  "success": true,
  "status": "healthy",
  "environment": "production",
  "database": "connected",
  "databaseLatencyMs": 2,
  "databaseTier": "cloud",
  "storage": "available",
  "storageProvider": "local",
  "storageDurable": false,
  "version": "1.1.0"
}
```

### 3.3 Production data baseline

Read-only counts used to detect test residue:

| Table | Count |
|---|---|
| `users` | 9 |
| `transactions` | 30 |
| `financial_accounts` | 11 |
| `budgets` | 5 |
| `idempotency_records` | 0 |
| `refresh_tokens` | 19 |
| `audit_logs` | 29 |
| `receipt_scans` | 0 |
| `fcm_tokens` | 2 |
| `chat_messages` | 22 |

These counts were restored after every synthetic production test.

### 3.4 Database structure

- 11/11 migrations applied in `_prisma_migrations`.
- 44 public tables.
- 50 foreign keys.
- 38 foreign keys referencing `users`, all `ON DELETE CASCADE`.
- Required unique indexes present (email, username, per-user idempotency keys,
  transfer legs, refresh-token hashes, and related constraints).

### 3.5 Android artifacts

| Item | Value |
|---|---|
| Package | `com.finpro.app.finpro_mobile` |
| Version | `1.0.0` (versionCode 1) |
| SDK | minSdk 24, targetSdk 36, compileSdk 36 |
| APK SHA-256 | `16b5516a0d225f506141bf5eac67e83ccc854448e9448b3c32c50e8282352187` |
| AAB SHA-256 | `7b796a91ef0cadd73658be8957e4a97af9d05bf621fb7402dab4478108260753` |
| Signer | `CN=FinPro`, cert SHA-256 `5302c89b5c214d169d2affa1650103039f3d7ec1e5bc0aceb50b2f092c4e3d7a` |
| Certificate expiry | 2054-03-03 |
| Backup | `allowBackup=false` |
| Cleartext | no opt-in |
| Debuggable | no |
| AAB signature | verified |

Artifacts are source-equivalent to HEAD at build time.

---

## 4. Findings

Severity is assigned by **evaluation impact**, not by theoretical elegance.

- **P0** — the system can fail during the demo or is actively unstable.
- **P1** — a known defect that an examiner could reasonably hit, or a security
  issue with a practical exploit path.
- **P2** — real but non-blocking; document and defer.
- **P3** — cosmetic or future work.

### 4.1 P0 — confirmed and fixed

#### P0-1: Health probes consumed the general API rate limit, causing a restart loop

**Evidence**

- `app.js` applied a single `1000`-per-15-minute limiter to all `/api/` traffic.
  At audit time the limit was `200` and health was not exempt.
- Render probes `/api/v1/health` roughly every 5 seconds, i.e. ~180 probes per
  15-minute window. That alone consumed almost the entire budget.
- Local reproduction: 210 sequential probes produced 199 × `200`, then 11 ×
  `429`.
- Production logs showed `[REQ-WARN] GET /v1/health 429` every 5 seconds,
  followed by Render marking the instance unhealthy and restarting it. The user
  observed a `502` loop.
- The loop was self-reinforcing: a restart triggers a cold start, the first
  probes fail, and the new instance immediately burns the same budget.

**Why it is P0**

The public API could become unavailable without any user traffic. On demo day
this presents as "the backend is down" with no obvious cause.

**Fix**

- Exempt `/api/v1/health*` and `/api/v1/realtime*` from the general limiter.
- Raise the general interactive limit from `200` to `1000` per 15 minutes.
- Keep the auth limiter at `100` per 15 minutes with its own namespace.
- Keep the account-deletion limiter at `5` per hour.

**Verification**

- Local: 1100/1100 health probes returned `200`; `/api/v1/accounts` still capped
  at 1000 and then returned `429`.
- Production: 24/24 probes over 4+ minutes returned `200`, with no `429` and no
  `REQ-ERROR` in the logs.
- Deployed as `dep-dbfl1oq9lscs73ahr2hg` at `f6cdf9f`.

**Status: PASS (fixed, deployed, verified).**

### 4.2 P1 — confirmed and fixed

#### P1-1: Critical IP-spoofing advisory in `proxy-addr`

**Evidence**

`npm audit --omit=dev` reported `proxy-addr` 2.0.7 as **critical**
(GHSA-jqcg-44mw-7w3h: IP spoofing via IPv4-mapped IPv6 trust subnet), plus
additional production advisories in `qs`, `morgan`, `js-yaml`, and
`follow-redirects`.

**Impact**

`proxy-addr` is how Express resolves `req.ip` behind a proxy. The application
uses `req.ip` for rate limiting and audit logging. A spoofed client IP can
weaken per-IP limits and pollute audit records.

**Fix**

`npm audit fix` (non-force) updated only `node-backend/package-lock.json` within
existing semver ranges. `package.json` was not changed. The update resolved the
critical advisory and eight other production advisories.

**Residual**

Three production advisories remain, all requiring a **major** upgrade:

| Package | Severity | Path | Why deferred |
|---|---|---|---|
| `node-cron` → `uuid` | moderate | direct → transitive | Fix requires `node-cron@4`, a breaking major |
| `zod` | high | direct | Fix requires `zod@4`, a breaking major; schema/API changes |

Deferring is deliberate: a major-version migration days before evaluation adds
more risk than the remaining advisories remove. Both are documented as owner
actions after the evaluation.

**Verification after the lockfile update**

- Jest: 35/35 suites, 572/572 tests.
- Custom suites: 166 + 41 + 29 + 17 assertions, all passing.
- Real-DB verifiers: transfer 62/62, deposit 32/32, AI 31/31.
- `npm run build`: passed.
- `npm audit --omit=dev`: 3 vulnerabilities (2 moderate, 1 high), 0 critical.

**Status: PASS for the critical advisory; PARTIAL for the remaining majors.**

### 4.3 P1 — confirmed, blocked by external dependency

#### P1-2: Production object storage is ephemeral

**Evidence**

- `/api/v1/health` reports `storageProvider:"local"`, `storageDurable:false`.
- Uploaded files live on the container filesystem and are lost on redeploy or
  restart.
- The S3 code path is implemented and passed a 22-check harness against a local
  MinIO server, including restart persistence, cross-tenant denial, and
  fail-closed behaviour when production credentials are wrong.
- No production bucket or credentials exist in this environment.

**Impact**

Receipts and uploaded documents are not durable in production. For a demo this
is acceptable **only** if the demo uploads a file and retrieves it in the same
instance lifetime. It must not be presented as durable storage.

**Status: BLOCKED.** Requires an owner-authorised bucket and credentials.

#### P1-3: Render PostgreSQL free plan expires before/around review

**Evidence**

- Plan: free.
- Expiry: **2026-11-11T11:24:01Z**.
- Render deletes the database and all data after a 14-day grace period
  (**2026-11-25T11:24:01Z**).
- Free Postgres has no managed backups.
- A verified encrypted backup and isolated restore exist (`BACKUP_DR.md` §13.1).

**Impact**

The evaluation is on or before 2026-11-05, so the database is expected to be
alive during the demo. But the expiry is six days later, and the free plan
cannot be extended. Any post-evaluation review, moderation, or re-run risks a
dead database.

**Status: BLOCKED.** Requires owner authorisation for a paid plan
(`0.1c-256mb`, ~$6/month) or a migration.

#### P1-4: No physical Android device or emulator

**Evidence**

- `adb devices` → empty.
- `flutter emulators` → none.
- No AVD/system image on the build host.
- Flutter widget tests pass (239), but they do not exercise runtime permissions,
  the SMS `MethodChannel`, external-link handoff, or real layout.

**Impact**

The Android app can be demonstrated only by static evidence (signed APK/AAB,
manifest inspection, widget tests) or by installing on a borrowed device. It
cannot be claimed as device-tested.

**Status: BLOCKED.** Hardware absent.

### 4.4 P2 — documented, not fixed

| ID | Finding | Impact | Decision |
|---|---|---|---|
| P2-1 | `sendTestPush` has no production guard despite a "dev/debug only" comment | An authenticated user can trigger a test push to their own registered tokens | Not a cross-tenant issue; document and defer |
| P2-2 | `render.yaml` says `runtime: node` + `/api/v1/health/live`; live service is Docker + `/api/v1/health` | Re-applying the blueprint could reconfigure the service | Documented; do not re-apply before evaluation |
| P2-3 | Generic income/expense creation and loan payments have no idempotency key | A network retry can double-post | Deposits and transfers are idempotent; document as known limitation |
| P2-4 | No Redis in production | Rate limits and cache are per-instance; one instance today, so no practical difference | Documented; not required for demo |
| P2-5 | `/metrics` returns 404 without `METRICS_TOKEN` | No Prometheus scraping | Not needed for evaluation |
| P2-6 | Backups are not scheduled or off-host | RPO/RTO unproven; a single encrypted archive exists | Documented in `BACKUP_DR.md` |
| P2-7 | Insufficient-funds is not enforced on the general tracker | An expense larger than the balance is accepted (verified: 999,999,999 on a 5,000 balance → 201) | Product behaviour, not a crash; the **simulator** does enforce `INSUFFICIENT_FUNDS` |
| P2-8 | Free-tier cold start can take tens of seconds | Demo risk | Mitigated by warming the backend before the demo |
| P2-9 | AI quality is not evaluated; only plumbing is | An examiner may see a weak answer | Demo uses scripted, high-confidence prompts |

### 4.5 P3 — cosmetic / future

- `eng.traineddata` must stay out of commits (OCR downloads it at runtime).
- `docs/` has several phase documents that overlap; Phase 9 adds a canonical
  evaluation set rather than rewriting history.
- The Render blueprint drift should be reconciled after evaluation, not before.

---

## 5. What was changed after the audit

| Change | Files | Risk | Verification |
|---|---|---|---|
| Health probes exempt from the general limiter; limit 200 → 1000 | `node-backend/src/app.js` | Low; health and realtime are infrastructure traffic | Local 1100/1100; production 24/24 |
| Non-breaking dependency remediation | `node-backend/package-lock.json` | Low; semver-only, no `package.json` change | Full test matrix + build |
| Phase 9 documentation | `docs/*.md` | None | Reviewed diff |

No other production code was changed. No database migration was added. No
environment variable was changed. No dependency was major-upgraded.

---

## 6. What was deliberately not done

| Item | Why |
|---|---|
| Render plan upgrade | Billing decision; owner authorisation required |
| Durable storage migration | No credentials; requires a migration plan for existing files |
| Play Console submission | Out of scope; no Console access |
| `node-cron` / `zod` major upgrades | Breaking changes too close to evaluation |
| Redis provisioning | Not needed for one instance; adds a failure mode |
| Rewriting the AI pipeline | Works; quality evaluation is out of scope |
| Load testing production | Explicitly prohibited; local bounded run exists |
| Deleting production data | Prohibited; synthetic accounts removed via API only |
| Re-applying `render.yaml` | Would risk reconfiguring the live service |

---

## 7. Audit conclusion

At baseline, the system had **one genuine P0** (health-probe rate-limit restart
loop) and **one practical P1 security issue** (critical `proxy-addr` advisory).
Both were fixed and verified. The remaining P1s are external-dependency blockers,
not code defects: durable storage, database expiry, and physical-device testing.

The system is **demo-ready on the web and API surfaces**, **defensible on
architecture and security**, and **honest about its gaps**. It is **not**
production-certified, not independently penetration-tested, and not
device-validated.

The detailed requirement-by-requirement evidence is in
[`FINPRO_EVALUATION_TEST_MATRIX.md`](FINPRO_EVALUATION_TEST_MATRIX.md). The demo
procedure is in [`FINPRO_EVALUATION_DEMO.md`](FINPRO_EVALUATION_DEMO.md). The
architecture narrative is in
[`FINPRO_CLOUD_ARCHITECTURE_DEFENSE.md`](FINPRO_CLOUD_ARCHITECTURE_DEFENSE.md).
The final status roll-up is in [`PHASE9_FINAL_REPORT.md`](PHASE9_FINAL_REPORT.md).
