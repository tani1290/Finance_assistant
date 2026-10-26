# FinPro Documentation

One canonical set, one question per document. Start here.

| Document | Answers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | What the system is made of, the tech stack, the directory layout, and how the two clients relate to the API. |
| [API.md](API.md) | Every REST endpoint, plus the **financial data contract** (money, percentages, date-only fields, errors, pagination, idempotency). |
| [DATABASE.md](DATABASE.md) | Prisma schema, relations, constraints and indexing notes. |
| [AI.md](AI.md) | How the assistant pipeline works, the tool registry, context/retrieval bounds, failure handling, security posture, and what is **not** solved. |
| [PARITY.md](PARITY.md) | Web ⇄ mobile capability matrix, conflicts fixed, known defects, deferred work, and the verification record. |
| [TESTING.md](TESTING.md) | How to run every suite, what each covers, the AI stubbing strategy, Phase 8/9 production evidence, and the known verification gaps. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment runbook, current production state, live probes and the pre-deploy gate. |
| [OPERATIONS.md](OPERATIONS.md) | Health/readiness semantics, rate-limit policy, optional Redis cache, upstream resilience, storage durability, the Render database expiry, metrics, and scaling rules. |
| [BACKUP_DR.md](BACKUP_DR.md) | PostgreSQL backup/restore safety model, AES-256-GCM encryption, off-host publishing, scheduling, retention, the verified production restore, the database-expiry runbook, and the recovery checklist. |
| [CLOUD_AUDIT.md](CLOUD_AUDIT.md) | Evidence-based cloud capability audit: initial state and post-implementation status. |
| [PHASE3_RELEASE_READINESS.md](PHASE3_RELEASE_READINESS.md) | Phase 3 defects, fixes, test evidence, compatibility, residual risks and the deployment gate. |
| [PHASE4_RELEASE_READINESS.md](PHASE4_RELEASE_READINESS.md) | Phase 4: migration validation in an isolated database, the AI confirmation state machine, web/mobile verification, financial & date regressions, backup readiness, tests executed, blockers and the deployment assessment. |
| [PHASE4_RELEASE_CHECKLIST.md](PHASE4_RELEASE_CHECKLIST.md) | The operator checklist for one staging release: code review, migration, backup, deploy, AI smoke tests, financial/date checks, monitoring and rollback. |
| [PHASE5_STAGING_READINESS.md](PHASE5_STAGING_READINESS.md) | Phase 5: the release-artifact inventory (HEAD does **not** contain the release), the reproduced validation run, the AI action-status probe, deposit idempotency, staging prerequisites, the off-site-recovery and live-provider runbook, Flutter CI and the Render runtime limits. |
| [PHASE5_STAGING_CHECKLIST.md](PHASE5_STAGING_CHECKLIST.md) | The Phase 5 staging operator checklist: pre-flight, variables, backup-then-migrate, deploy, AI/deposit/financial smoke tests, off-site recovery and rollback. |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Design tokens, typography, spacing and component rules for the web UI. |
| [MOBILE.md](MOBILE.md) | Flutter architecture, navigation and the Android SMS engine. |
| [GOOGLE_PLAY_COMPLIANCE.md](GOOGLE_PLAY_COMPLIANCE.md) | Phase 8 Google Play code-level compliance: privacy policy, account deletion, SMS disclosure/consent, Data Safety inputs, live production evidence, remaining blockers, and the manual actions that remain. |
| [PHASE9_INITIAL_AUDIT.md](PHASE9_INITIAL_AUDIT.md) | Phase 9 evaluation-readiness audit: baseline state, the P0 health-probe defect, the P1 dependency advisory, severity and deferral decisions. |
| [FINPRO_EVALUATION_TEST_MATRIX.md](FINPRO_EVALUATION_TEST_MATRIX.md) | **Requirement-by-requirement evidence for the evaluation**, with the L1–L6 test levels and an explicit PASS / PARTIAL / BLOCKED / NOT TESTED status for each item. |
| [FINPRO_EVALUATION_DEMO.md](FINPRO_EVALUATION_DEMO.md) | The 15-minute demo runbook: warm-up, dataset, script, simulator caveat, fallbacks and Q&A answers. |
| [FINPRO_CLOUD_ARCHITECTURE_DEFENSE.md](FINPRO_CLOUD_ARCHITECTURE_DEFENSE.md) | The architecture narrative for the defense: topology, components, tenancy, security, reliability, trade-offs, STRIDE and examiner questions. |
| [PHASE9_FINAL_REPORT.md](PHASE9_FINAL_REPORT.md) | **The Phase 9 roll-up**: verified, implemented-but-unverified, failed, blocked, owner-action and not-tested items, plus the go/no-go decision. |

## For the evaluation

Read these four, in this order:

1. [`PHASE9_FINAL_REPORT.md`](PHASE9_FINAL_REPORT.md) — what is true right now.
2. [`FINPRO_EVALUATION_TEST_MATRIX.md`](FINPRO_EVALUATION_TEST_MATRIX.md) — the evidence behind each claim.
3. [`FINPRO_EVALUATION_DEMO.md`](FINPRO_EVALUATION_DEMO.md) — what to do on the day.
4. [`FINPRO_CLOUD_ARCHITECTURE_DEFENSE.md`](FINPRO_CLOUD_ARCHITECTURE_DEFENSE.md) — what to say when questioned.

## Reading order for a new contributor

1. `ARCHITECTURE.md` — the map.
2. `API.md` §1 and §10 — the two things most likely to break: the envelope and the money/date contract.
3. `PARITY.md` — what exists on which surface, and which defects are known.
4. `TESTING.md` §1–2 — how to prove a change works before shipping.
5. `OPERATIONS.md` + `BACKUP_DR.md` before changing health checks, caching, queues or persistence.
6. The doc for the area you are touching (`AI.md`, `DATABASE.md`, `MOBILE.md`, `DESIGN_SYSTEM.md`).

## Ground rules used by this documentation

- A capability is only marked as working on a surface when the **contract** is verified, not when a screen exists.
- Known defects are written down with an impact statement and a suggested fix, rather than quietly patched in a way that changes user-visible numbers.
- Nothing in these docs contains credentials or connection strings. Secrets live in `.env` (see `DEPLOYMENT.md`).
