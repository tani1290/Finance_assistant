# FinPro — Backup & Disaster Recovery

**Status:** Backup, encryption, off-host publishing and isolated restore tooling are
implemented. The local recovery drill passes for plaintext and encrypted archives,
including refusal to restore over a non-empty database and rejection of a wrong
encryption key. **A verified, encrypted backup of the production database was taken
on 2026-10-26 and restored successfully into an isolated PostgreSQL 18 container
(§13).** No off-host copy and no scheduled job exist yet, so the backup currently
lives only on the operator host. The Render free-tier web service has an ephemeral
filesystem, so a dump written inside the container is not a backup.

The Render PostgreSQL instance is on the **free plan and expires 2026-11-11**. It is
deleted, with all data, 14 days after expiry. The only extension path is a paid plan
change; see the runbook in §13.2.

**Owner:** Jinay Golecha (`jinay_golecha`)

---

## 1. What is protected

| Data | Backed up by this tool? | Notes |
|---|---|---|
| PostgreSQL schema and rows | **Yes** | Logical backup with `pg_dump --format=custom --compress=9`. `pg_dump` takes a consistent snapshot; the live data directory is never copied. |
| Uploaded receipts/documents | **No** | Object storage must use the provider's own versioning/lifecycle backup. Local-disk uploads are ephemeral and are not recoverable after a redeploy. |
| Firebase/FCM state | **No** | Managed by Firebase. |
| Environment variables / secrets | **No** | Held in the hosting provider's secret store. Back them up separately in a password manager; never inside the database dump. |
| Redis cache | **No** | Rebuildable. It must never contain the only copy of financial data. |

The dump contains financial records and user data. It is encrypted at rest with
AES-256-GCM before it leaves the staging directory.

---

## 2. Recovery objectives

These are **proposed targets, not measured guarantees**:

| Objective | Target | Current status |
|---|---|---|
| RPO (maximum data loss) | 24 hours | Proposed. Depends on the off-host schedule actually running; unmeasured. |
| RTO (time to restore) | 4 hours | Proposed. Depends on database size, network and operator access; unmeasured. |

A daily backup means up to 24 hours of transactions can be lost. If that is not
acceptable, increase the frequency. Retain enough history to recover from an
accidental deletion noticed days later, not only from infrastructure failure.

---

## 3. Safety model

- **Backups are local-only by default.** A non-local database host is refused unless
  **both** `--allow-non-local` and `BACKUP_ALLOW_NON_LOCAL=true` are supplied.
- **Restores are local-only, always.** There is no override. `assertRestoreTarget`
  rejects any host that is not `localhost`, `127.0.0.1` or `::1`, and rejects the
  reserved databases `postgres`, `template0` and `template1`.
- **A restore never overwrites a non-empty database.** Any user table causes a refusal.
- **`--confirm <dbname>` must equal the target database name exactly.**
- **The archive is verified before restore.** Manifest byte count and SHA-256 must
  match. Encrypted archives additionally require the manifest and a valid 32-byte key;
  the plaintext checksum is verified after decryption.
- **Restore is transactional.** `pg_restore --single-transaction --exit-on-error`
  leaves an empty target empty on failure rather than half-populated.
- **Temporary plaintext is short-lived.** An encrypted restore decrypts into a `0700`
  temp directory with a `0600` file and removes it on exit, failure or signal.
- **Credentials never appear in argv or logs.** They are passed as
  `PGHOST`/`PGUSER`/`PGPASSWORD`/... environment variables, and output is redacted.
  `DATABASE_URL` and `DIRECT_URL` are removed from the child environment.
- **Encryption keys are never written to the manifest or logs.** The manifest records
  only the algorithm, format version and cipher metadata.
- **Publishing never overwrites an existing object** and deletes objects it uploaded
  if a later verification step fails.
- **Nothing in this toolchain can promote a restore into production.** That remains a
  separate, authorised operator procedure.
- **Pruning is narrow.** Only `finpro-*.dump` and `finpro-*.dump.enc` files older than
  the retention window are removed, and only after a successful, verified backup.

---

## 4. Prerequisites

On the machine that runs the backup (a trusted host, CI runner or operator laptop —
**not** assumed to be the Render web container):

- PostgreSQL client tools matching or newer than the server: `pg_dump`, `pg_restore`,
  `psql`, plus `createdb`/`dropdb` for the drill.
- Network access to the database.
- Enough disk for the dump, its encrypted copy and manifest.
- For off-host publishing: the AWS CLI v2 and credentials limited to
  `s3:PutObject`, `s3:GetObject`, `s3:HeadObject` and `s3:DeleteObject` on the backup
  prefix.

```bash
pg_dump --version
pg_restore --version
psql --version
aws --version   # only needed for publishing
```

If the PostgreSQL tools are not on `PATH`, set `PG_DUMP_BIN`, `PG_RESTORE_BIN` and
`PSQL_BIN`.

---

## 5. Running a backup

From `node-backend/`:

```bash
# 1. Preview the target and destination without dumping.
npm run backup:db -- --dry-run

# 2. Local backup into ./backups. Encrypts automatically when the key is set.
BACKUP_ENCRYPTION_KEY=... npm run backup:db

# 3. Explicit destination and retention.
npm run backup:db -- --out-dir /secure/finpro-backups --retention-days 14
```

Encryption flags:

- `--encrypt` requires `BACKUP_ENCRYPTION_KEY` and fails if it is missing.
- With a key present, encryption is the default; `--no-encrypt` opts out explicitly.
- `--encrypt` and `--no-encrypt` together are rejected.
- Keys must be exactly 32 bytes, supplied as base64 (optional `base64:` prefix),
  64 hex characters, or `hex:` + 64 hex characters. Passphrases are rejected.
- Generate a key once on the backup host and store it in the secret manager:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

A deliberate remote backup requires both opt-ins:

```bash
export BACKUP_ALLOW_NON_LOCAL=true
npm run backup:db -- --allow-non-local
```

The script reads the source URL from, in order: `--url`, `BACKUP_DATABASE_URL`, then
`DATABASE_URL`. Prefer `BACKUP_DATABASE_URL` on an operator host.

Artifacts:

- `finpro-<database>-<timestamp>.dump[.enc]` — custom-format archive, encrypted with
  AES-256-GCM when enabled.
- `finpro-<database>-<timestamp>.dump[.enc].json` — byte count, SHA-256, table count,
  creation time, source host/database, and encryption metadata (format `FPE1`,
  algorithm, IV/tag sizes, plaintext size and plaintext SHA-256).

The archive is `0600`; the containing directory is private (`0700`). During encryption
the plaintext exists only in a private staging file, which is unlinked after the
encrypted file is verified. The script runs `pg_restore --list` and counts
`TABLE DATA` entries before reporting success. If verification fails, the archive is
deleted so a corrupt file is not mistaken for a valid backup.

Exit codes: `0` success, `2` unsafe/invalid target or arguments, `3` missing client
tooling or integrity failure, `1` any other failure. **Alert on any non-zero exit.**

### Encryption format

`FPE1` is a small, explicit container: 4-byte magic (`FPE1`), 1-byte version, 12-byte
IV, ciphertext, then a 16-byte GCM authentication tag. The header bytes are
authenticated as AAD, so a modified version or IV fails authentication. Wrong keys and
tampered payloads fail closed; the restore script never falls back to partial data.

---

## 6. Off-host publishing

`scripts/publish-backup.js` uploads one encrypted archive and its manifest, then
downloads both again and verifies them. It defaults to a **dry run**:

```bash
cd node-backend
npm run backup:publish -- --file /secure/finpro-backups/finpro-....dump.enc
# Re-run with --execute to make network calls.
npm run backup:publish -- --file /secure/finpro-backups/finpro-....dump.enc --execute
```

Required configuration: `BACKUP_S3_BUCKET`, optional `BACKUP_S3_PREFIX`
(default `finpro/postgres`), `BACKUP_S3_ENDPOINT` for S3-compatible providers,
`BACKUP_AWS_REGION`, `BACKUP_S3_SSE` (default `AES256`; `none` only when the provider
cannot do SSE, since client-side encryption still applies) and optional
`BACKUP_S3_STORAGE_CLASS`.

Guarantees:

- Only `finpro-*.dump.enc` with a valid manifest is accepted. Plaintext dumps are
  refused.
- The local archive size and SHA-256 must match the manifest before any upload.
- An existing remote key is never overwritten; the script aborts instead.
- The archive is uploaded with SSE, downloaded back to a private temp directory, and
  its SHA-256 compared. The manifest is uploaded, downloaded and compared byte for
  byte. Success is reported only after both checks pass.
- If a later step fails, objects uploaded by this invocation are deleted.
- Credentials and connection strings are never printed.

**Unverified:** no live S3-compatible upload/download has been executed **for backup
publishing**. Only local validation and dry-run behaviour are proven. Run one manual
`--execute` against a scratch bucket before relying on it. (The application's own
object-storage path is a different code path; it was proven against a local MinIO
server in Phase 8 — see §13.3 — but it is not configured in production.)

### Schedule

`.github/workflows/backup.yml` runs a daily encrypted backup and publish:

- `workflow_dispatch` is always available for a manual run.
- The `17 2 * * *` UTC schedule only runs when repository variable
  `BACKUP_ENABLED=true`. Scheduled workflows can be delayed, and GitHub only runs
  schedules from the default branch.
- Required secrets: `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- Required variables: `BACKUP_S3_BUCKET`; optional `BACKUP_S3_PREFIX`,
  `BACKUP_S3_ENDPOINT`, `BACKUP_S3_SSE`, `BACKUP_AWS_REGION`.
- The job fails early with a clear message when configuration is missing, and uploads
  a non-secret failure summary artifact (run URL, trigger, time) on failure. It never
  prints credentials or rows.

Retention in the workflow is `0` (no local pruning); prune off-host with the bucket's
lifecycle rule. Do not run backups from the Render web process or a container-local
cron that has no durable destination.

---

## 7. Retention

`BACKUP_RETENTION_DAYS` (default `14`) or `--retention-days` controls local pruning.
Pruning happens only after a successful, verified backup, and only for
`finpro-*.dump` / `finpro-*.dump.enc` files. Manifests are removed with their archive.
Nothing else in the directory is touched.

Off-host retention is controlled by the object-storage lifecycle policy. Keep at least
enough history to recover from a bad import or deletion noticed days later, and keep
versioning enabled so an overwrite or delete is reversible.

---

## 8. Restore drill (required after changes)

The drill creates throwaway local databases, seeds the source, runs the real backup
and restore scripts, and asserts that:

1. a plaintext backup restores and the seeded row survives;
2. a restore over a non-empty database is refused;
3. an encrypted backup restores with the correct key;
4. a wrong key is rejected without writing to the target.

```bash
cd node-backend
npm run backup:verify
```

The run ends with `Recovery drill PASSED.` It refuses to run against anything except
`127.0.0.1`, only creates/drops databases named `finpro_bk_verify_*`, deletes
`DATABASE_URL`/`DIRECT_URL` from the child environment, and builds its own local
connection strings. Confirm cleanup:

```bash
psql -h 127.0.0.1 -d postgres -tAc \
  "SELECT datname FROM pg_database WHERE datname LIKE 'finpro_bk_verify_%';"
```

The query must return no rows.

The same drill runs in CI as the `backup-recovery-drill` job, against a PostgreSQL 17
service container.

**What the drill proves:** dump/restore compatibility with this schema, manifest and
checksum verification, encryption/decryption, wrong-key rejection, the empty-target
guard, and row survival.

**What it does not prove:** that the off-host copy exists, that an S3 upload of a
backup is readable, or that either RPO/RTO target is met. A production dump and
isolated restore were executed once on 2026-10-26 (§13); that is a point-in-time
proof, not a schedule, and the archive is still on one host.

---

## 9. Restoring into an isolated database

Never restore directly over production. Recover into a new, empty local database,
verify it, and only then decide how to promote data through an approved, auditable
procedure.

```bash
# 1. Create an empty local target.
createdb -h 127.0.0.1 finpro_restore_check

# 2. Preview (works for .dump and .dump.enc).
npm run restore:db -- \
  --file /secure/finpro-backups/finpro-finance_jinay-20261021T101500Z.dump.enc \
  --confirm finpro_restore_check \
  --dry-run

# 3. Restore. The key must match the one used for the backup.
RESTORE_DATABASE_URL="postgresql://$USER@127.0.0.1:5432/finpro_restore_check" \
BACKUP_ENCRYPTION_KEY=... \
npm run restore:db -- \
  --file /secure/finpro-backups/finpro-finance_jinay-20261021T101500Z.dump.enc \
  --confirm finpro_restore_check

# 4. Verify.
psql -h 127.0.0.1 -d finpro_restore_check -c 'SELECT COUNT(*) FROM "User";'
psql -h 127.0.0.1 -d finpro_restore_check -c 'SELECT COUNT(*) FROM "Transaction";'

# 5. Remove the isolated database deliberately.
dropdb -h 127.0.0.1 finpro_restore_check
```

Encrypted archives require their `.json` manifest. The script verifies the encrypted
size and SHA-256, decrypts to a private temporary file, verifies the plaintext size
and SHA-256, then runs a single-transaction restore and asserts that the `User` table
exists afterwards. A failed restore leaves the target empty.

If the manifest is missing, a plaintext archive can proceed only with
`--allow-unverified` (deliberate forensics, not routine recovery). Encrypted archives
cannot bypass the manifest.

Exit codes: `2` invalid request/target, `3` missing manifest, checksum, key or
decryption failure, `4` non-empty target, `5` `pg_restore` failure, `6` post-restore
verification failure.

### Production recovery (high level)

Restoring production is a separate, authorised operation and is **not** automated:

1. Declare an incident and stop writes to the affected database.
2. Identify the most recent backup that is verified and predates the damage.
3. Provision a new database (or a Render restore, if the plan provides one).
4. Restore into the new database using provider tooling, never into one serving traffic.
5. Verify row counts, critical tables, login and a read-only financial calculation
   before switching the application URL.
6. Keep the old database intact until the new one is accepted.
7. Record the backup timestamp, archive checksum and verification results.

Do not run a down-migration to "undo" damage; schema changes here are additive. Do not
restore over production to "save time".

### Object-storage recovery (uploads)

Database backups do **not** contain uploaded receipts or documents. Recovery depends
on the storage provider:

- Enable bucket versioning and a lifecycle rule that retains deleted objects.
- Test restoring a sample object from a previous version into a scratch prefix.
- If uploads are stored on the Render container filesystem, they are not recoverable
  after a redeploy. Move them to object storage before relying on them.

---

## 10. Current hosting constraints

- **Render free web service:** filesystem is ephemeral. A dump written there is lost on
  the next deploy or restart.
- **Render PostgreSQL free plan — confirmed policy (2026-10-26):**
  - Created **2026-10-12T11:24:01Z**, expires **2026-11-11T11:24:01Z** (30 days).
  - After expiry the database is inaccessible. A **14-day grace period** follows, then
    Render **deletes the database and all of its data**. There is no recovery.
  - Free Postgres has **no automated backups and no point-in-time recovery**.
  - The free plan cannot be extended. The only path is a paid compute-plan change
    (`render pg update finpro-db --plan …`), which requires owner billing
    authorisation and causes a few minutes of database unavailability.
  - Cheapest paid plan: `0.1c-256mb` at **$6/month** (256 MB RAM, 100 connections,
    1 GB SSD). Next: `0.5c-1g` at $19/month. Storage expansion is $0.30/GB.
  - See §13.2 for the exact cutover runbook and rollback.
- **One web instance:** a backup triggered from the app would run on every instance if
  scaled. Keep backups in an external scheduler or dedicated job.
- **No persistent disk is configured in `render.yaml`.** Adding one changes the
  deployment topology and cost; it is not part of this change.

---

## 11. Manual setup checklist

- [ ] Run `npm run backup:verify` on a host with PostgreSQL client tools.
- [ ] Generate `BACKUP_ENCRYPTION_KEY` and store it in a secret manager separate from
      the backups. Losing it makes encrypted archives unrecoverable.
- [ ] Choose an off-host bucket with encryption at rest, versioning and a lifecycle
      rule.
- [ ] Create a dedicated backup database role with read access sufficient for
      `pg_dump` (do not reuse the application superuser).
- [ ] Create a limited object-storage credential for the backup prefix.
- [ ] Add the GitHub secrets/variables and set `BACKUP_ENABLED=true` only when ready.
- [ ] Run the workflow manually once and confirm the download-back verification passed.
- [ ] Run a restore drill from the **off-host** copy, not only from a local file.
- [ ] Record the last successful backup time and last drill date somewhere visible.
- [ ] Review object-storage versioning/lifecycle for uploads separately.

---

## 12. Failure reporting

| Failure | Detection | Action |
|---|---|---|
| `pg_dump` missing or wrong version | Exit `3`, clear message | Install matching client tools on the backup host. |
| Unsafe/remote target | Exit `2` | Use an approved host and the two explicit opt-ins. |
| Missing/invalid encryption key | Exit `2`, no archive written | Supply a 32-byte key; never use a passphrase. |
| Dump verification failed | Non-zero exit; archive deleted | Investigate disk, permissions, server version and connection stability; rerun. |
| Publish precondition failed | Exit `2`/`3`, nothing uploaded | Use an encrypted archive with its manifest; re-create the backup if it is corrupt. |
| Remote object already exists | Non-zero exit, no overwrite | Choose a new timestamp; never overwrite a good backup. |
| Upload/download verification failed | Non-zero exit; uploaded objects removed | Check credentials, endpoint, SSE support and bucket policy; rerun. |
| Restore checksum mismatch | Exit `3` | Do not restore. Retrieve a fresh copy and verify the manifest. |
| Wrong encryption key | Exit `3`, target unchanged | Locate the correct key; do not attempt to bypass authentication. |
| Restore target not empty | Exit `4` | Create a new empty database. |
| Restore SQL error | Exit `5`; transaction rolled back | Inspect sanitised `pg_restore` output; check archive/server version compatibility. |
| Post-restore verification failed | Exit `6` | Treat the restore as failed; investigate before use. |
| Backup job silent for a day | No success record | Treat as a failure even if no alert fired; check the scheduler and host. |

GitHub Actions reports a failed scheduled workflow to the repository's notification
settings and uploads a non-secret failure artifact. There is no built-in paging
integration; connect workflow failure notifications to the same channel used for API
incidents, and add a "last successful backup" age check.

---

## 13. Phase 8 production backup, restore proof and expiry runbook

### 13.1 Production backup and isolated restore — PASS (2026-10-26)

Executed against the live Render PostgreSQL instance `finpro-db`
(`dpg-db6c6kad0e5s73a6lbf0-a`, PostgreSQL 18.6, `final_year_project_nwmc`). Connection
details were read from the Render CLI into a private file and never printed.

Procedure and evidence:

1. **Dump.** `pg_dump --format=custom --compress=9 --no-owner --no-privileges` run in
   `docker run --rm postgres:18` (local 14.x clients refuse a PostgreSQL 18 server).
   Plaintext SHA-256 `7f03aa1d7063da7f2e0fb24541eef12e80c6e1019f0e19da01faeb15623f4ae9`.
   `pg_restore --list` reported **44 `TABLE DATA` entries / 271 total entries**.
2. **Encrypt.** The repo's `scripts/lib/backupCrypto.js` produced
   `finpro-prod-20261026T113351Z.dump.enc` (`FPE1`, AES-256-GCM), SHA-256
   `7acbe802718af2bead640c824ae00aaa0551dd68f2f7ae24916909d0687db975`. The 32-byte key
   was stored separately with `0600` permissions; the plaintext dump was deleted.
3. **Decrypt round trip.** Recovered plaintext SHA-256 matched the original exactly.
4. **Isolated restore.** Restored into a throwaway `postgres:18` container with
   `--network none`, using a disposable database. Result: **44 tables, 11 applied
   migrations, 0 unfinished migrations** — identical to production.
5. **Content verification.** Row counts matched for all baseline tables
   (9 users, 30 transactions, 11 financial_accounts, 5 budgets, 19 refresh_tokens,
   29 audit_logs; zero rows in receipt_scans, export_jobs, simulated_payments,
   pending_sms_transactions, idempotency_records). MD5 content hashes matched for
   users, transactions, budgets, financial_accounts, refresh_tokens, audit_logs,
   categories and goals. **115 indexes and 50 foreign keys** matched.
6. **Invariant checks on both sides.** Orphan transactions (user/account), null or zero
   amounts, duplicate idempotency keys, orphan accounts/budgets (user), and orphan
   budgets (category) were all **0**.
7. **Cleanup.** The restore container and plaintext dump were removed. Only the
   encrypted archive, its key and the SHA-256 manifests remain.

Artifact location (operator host, **outside the repository**):

```
/Volumes/Projects/Minor/FINpro/phase8-backups/
  finpro-prod-20261026T113351Z.dump.enc
  finpro-prod-20261026T113351Z.dump.enc.json
  backup-key.txt          # 0600 — store in a secret manager, never in git
  pg.env                  # 0600 — contains production credentials
  restore-list.txt
```

**What this proves:** a byte-verified, encrypted backup of production data exists and
restores into an empty PostgreSQL 18 database with identical schema, row counts,
content hashes, indexes and foreign keys.

**What it does not prove:** that the archive survives loss of the operator host (it is
not off-host yet), that the backup schedule runs, or that RPO/RTO targets are met.

**Required next actions (owner):**

- [ ] Copy the encrypted archive and manifest to an off-host bucket with versioning and
      a lifecycle rule; run one download-back SHA-256 check.
- [ ] Store `backup-key.txt` in a secret manager separate from the archive.
- [ ] Schedule the daily job (`.github/workflows/backup.yml`) with the required secrets
      and `BACKUP_ENABLED=true`, and confirm one successful run.
- [ ] Run one restore **from the off-host copy**, not only from the local file.

### 13.2 Render PostgreSQL expiry and cutover runbook

**Timeline (confirmed from Render's free-tier documentation):**

| Event | Date/time (UTC) |
|---|---|
| Database created | 2026-10-12T11:24:01Z |
| **Expiry — database becomes inaccessible** | **2026-11-11T11:24:01Z** |
| Grace period ends — **database and all data deleted** | 2026-11-25T11:24:01Z |

There is no extension on the free plan. Upgrading the existing database's compute plan
is the only way to keep it; Render does not provide free-plan backups, so the §13.1
archive is the recovery source if the deadline is missed.

**Option A — upgrade in place (recommended; keeps data, URL and credentials).**

1. Take a fresh verified backup immediately before the change:
   `cd node-backend && BACKUP_ENCRYPTION_KEY=... npm run backup:db` and confirm the
   manifest SHA-256. The §13.1 archive is a second copy.
2. Choose the plan. Cheapest is `0.1c-256mb` (**$6/month**). Confirm the current price
   in the Render Dashboard before accepting a charge.
3. Apply the change — Dashboard: **`finpro-db` → Settings/Plan → Compute → Edit**,
   select the plan, confirm; or CLI:
   ```bash
   render pg update finpro-db --plan 0.1c-256mb --confirm
   ```
   This is a **billing change** and requires owner authorisation. Expect **a few
   minutes of database unavailability**; there is no HA on this plan.
4. Verify: `render pg get finpro-db` shows `plan` no longer `free` and `expiresAt`
   cleared/absent; `GET /api/v1/health/database` returns 200; run a read-only query
   (`render psql finpro-db -c 'select count(*) from users;'`).
5. Confirm `expiresAt` is gone. If the plan change fails, do **not** retry blindly —
   capture the error and fall back to Option B.

**Option B — migrate to a new paid database (keeps the free instance intact).**

1. Create a new paid Postgres in the same region (`oregon`) and note its internal URL.
2. Restore the §13.1 encrypted archive into the new instance with
   `npm run restore:db` from an operator host (the script is local-only, so use a
   temporary local database and Render's import, or `pg_restore` directly against the
   new internal URL after verifying the checksum).
3. Verify schema (11 migrations), row counts and the §13.1 invariants.
4. Update `DATABASE_URL` on the Render web service, redeploy, and re-check
   `/api/v1/health/database`.
5. Keep the old database until the new one serves traffic successfully, then remove it.

**Rollback.** Option A has no code rollback: a plan change is a Render billing
operation. If it fails, the database remains on its current plan and the original
deadline applies. Option B rolls back by restoring the previous `DATABASE_URL` and
redeploying; the old database must not be deleted until the new one is accepted.

**Do not** wait until the expiry date. A failed plan change or a missed restore needs
days of margin, and deletion at 2026-11-25T11:24:01Z is irreversible.

### 13.3 Production uploads are still ephemeral

The production service reports `storageProvider: "local"`, `storageDurable: false`,
`ephemeral: true`. Uploaded receipts and exports do not survive a redeploy. The
S3-compatible code path is implemented and was proven end-to-end against a local MinIO
server (22/22 checks: upload, download, byte equality, cross-tenant denial, prefix
deletion, restart persistence, outage fail-closed, explicit fallback). Production
adoption needs only credentials and environment variables — no code change:

```
STORAGE_PROVIDER=s3
S3_ENDPOINT=…
S3_REGION=…
S3_BUCKET=…
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
S3_FORCE_PATH_STYLE=true|false
S3_PUBLIC_URL=…            # optional
S3_TIMEOUT_MS=…
STORAGE_ALLOW_EPHEMERAL_FALLBACK=false
```

Until those are set, treat all uploaded files as temporary. Database backups do not
contain them (§9, object-storage recovery).
