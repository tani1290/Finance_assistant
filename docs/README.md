# FinPro Documentation

One canonical set, one question per document. Start here.

| Document | Answers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | What the system is made of, the tech stack, the directory layout, and how the two clients relate to the API. |
| [API.md](API.md) | Every REST endpoint, plus the **financial data contract** (money, percentages, date-only fields, errors, pagination, idempotency). |
| [DATABASE.md](DATABASE.md) | Prisma schema, relations, constraints and indexing notes. |
| [AI.md](AI.md) | How the assistant pipeline works, the tool registry, context/retrieval bounds, failure handling, security posture, and what is **not** solved. |
| [PARITY.md](PARITY.md) | Web ⇄ mobile capability matrix, conflicts fixed, known defects, deferred work, and the verification record. |
| [TESTING.md](TESTING.md) | How to run every suite, what each covers, the AI stubbing strategy, and the known verification gaps. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment runbook and the pre-deploy gate. |
| [OPERATIONS.md](OPERATIONS.md) | Health/readiness semantics, optional Redis cache, upstream resilience, the non-durable push queue, metrics, and scaling rules. |
| [BACKUP_DR.md](BACKUP_DR.md) | PostgreSQL backup/restore safety model, AES-256-GCM encryption, off-host publishing, scheduling, retention, recovery drill, and the production recovery checklist. |
| [CLOUD_AUDIT.md](CLOUD_AUDIT.md) | Evidence-based cloud capability audit: initial state and post-implementation status. |
| [PHASE3_RELEASE_READINESS.md](PHASE3_RELEASE_READINESS.md) | Phase 3 defects, fixes, test evidence, compatibility, residual risks and the deployment gate. |
| [PHASE4_RELEASE_READINESS.md](PHASE4_RELEASE_READINESS.md) | Phase 4: migration validation in an isolated database, the AI confirmation state machine, web/mobile verification, financial & date regressions, backup readiness, tests executed, blockers and the deployment assessment. |
| [PHASE4_RELEASE_CHECKLIST.md](PHASE4_RELEASE_CHECKLIST.md) | The operator checklist for one staging release: code review, migration, backup, deploy, AI smoke tests, financial/date checks, monitoring and rollback. |
| [PHASE5_STAGING_READINESS.md](PHASE5_STAGING_READINESS.md) | Phase 5: the release-artifact inventory (HEAD does **not** contain the release), the reproduced validation run, the AI action-status probe, deposit idempotency, staging prerequisites, the off-site-recovery and live-provider runbook, Flutter CI and the Render runtime limits. |
| [PHASE5_STAGING_CHECKLIST.md](PHASE5_STAGING_CHECKLIST.md) | The Phase 5 staging operator checklist: pre-flight, variables, backup-then-migrate, deploy, AI/deposit/financial smoke tests, off-site recovery and rollback. |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Design tokens, typography, spacing and component rules for the web UI. |
| [MOBILE.md](MOBILE.md) | Flutter architecture, navigation and the Android SMS engine. |
| [GOOGLE_PLAY_COMPLIANCE.md](GOOGLE_PLAY_COMPLIANCE.md) | Phase 7 Google Play code-level compliance: privacy policy, account deletion, SMS disclosure/consent, Data Safety inputs, artifact evidence, and the manual actions that remain. |

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
