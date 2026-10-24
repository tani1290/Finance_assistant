# FinPro — Backup & Disaster Recovery

**Status:** Backup, encryption, off-host publishing and isolated restore tooling are
implemented. The local recovery drill passes for plaintext and encrypted archives,
including refusal to restore over a non-empty database and rejection of a wrong
encryption key. **No production backup has been scheduled or uploaded yet, and no
live object-storage round trip has been executed.** The Render free-tier web service
has an ephemeral filesystem, so a dump written inside the container is not a backup.

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

**Unverified:** no live S3-compatible upload/download has been executed from this
repository. Only local validation and dry-run behaviour are proven. Run one manual
`--execute` against a scratch bucket before relying on it.

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

**What it does not prove:** that production data is backed up, that the off-host copy
exists, that an S3 upload is readable, or that either RPO/RTO target is met.

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
- **Render PostgreSQL free plan:** do not assume automated backups or point-in-time
  recovery. Confirm the current plan's behaviour in the Render dashboard. If it is not
  included, the off-host job is the only backup.
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
