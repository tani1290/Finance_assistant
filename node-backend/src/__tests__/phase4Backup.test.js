/**
 * Phase 4 — backup and recovery hardening.
 *
 * The recovery drill (`scripts/verify-backup-restore.js`) proves the end-to-end
 * path against a real local PostgreSQL. This suite covers the guard rails that
 * must hold even when no database is available — they are the ones that decide
 * whether a restore is safe to attempt at all:
 *
 *  - a backup never overwrites an existing archive or manifest;
 *  - an archive is only restored when it still matches its manifest (size and
 *    SHA-256), so a truncated or tampered file is refused;
 *  - a manifest without a usable checksum is never trusted;
 *  - the archive name is deterministic, so the overwrite rule can be applied
 *    to a known path;
 *  - retention only ever prunes archives this tool created.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  backupFileName,
  assertNoExistingOutputs,
  assertArchiveMatchesManifest,
  selectExpiredBackups,
} = require('../../scripts/lib/dbSafety');

let workDir;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finpro-phase4-backup-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('archive naming', () => {
  test('is deterministic and marks encrypted archives', () => {
    const stamp = '2026-10-22_05-20-06-613';
    expect(backupFileName({ database: 'finance_jinay', stamp })).toBe(
      'finpro-finance_jinay-2026-10-22_05-20-06-613.dump'
    );
    expect(backupFileName({ database: 'finance_jinay', stamp, encrypted: true })).toBe(
      'finpro-finance_jinay-2026-10-22_05-20-06-613.dump.enc'
    );
  });
});

describe('overwrite refusal', () => {
  test('an existing archive is never replaced', () => {
    const filePath = path.join(workDir, 'finpro-db.dump.enc');
    fs.writeFileSync(filePath, 'existing archive');

    expect(() => assertNoExistingOutputs(filePath, `${filePath}.json`)).toThrow(
      /Refusing to overwrite an existing backup/
    );
  });

  test('an existing manifest is never replaced', () => {
    const filePath = path.join(workDir, 'finpro-db.dump.enc');
    const manifestPath = `${filePath}.json`;
    fs.writeFileSync(manifestPath, '{}');

    expect(() => assertNoExistingOutputs(filePath, manifestPath)).toThrow(
      /Refusing to overwrite an existing manifest/
    );
  });

  test('a free path is accepted', () => {
    const filePath = path.join(workDir, 'finpro-db.dump.enc');
    expect(assertNoExistingOutputs(filePath, `${filePath}.json`)).toBe(true);
  });
});

describe('manifest verification', () => {
  const writeArchive = (contents) => {
    const filePath = path.join(workDir, 'finpro-db.dump.enc');
    fs.writeFileSync(filePath, contents);
    return filePath;
  };

  test('a matching archive verifies and returns its checksum', async () => {
    const crypto = require('crypto');
    const contents = 'finpro-archive-bytes';
    const filePath = writeArchive(contents);
    const checksum = crypto.createHash('sha256').update(contents).digest('hex');

    const result = await assertArchiveMatchesManifest(
      { bytes: Buffer.byteLength(contents), checksumSha256: checksum },
      filePath
    );
    expect(result).toBe(checksum);
  });

  test('a tampered archive is refused', async () => {
    const crypto = require('crypto');
    const original = 'finpro-archive-bytes';
    const filePath = writeArchive('finpro-archive-byteS');
    const checksum = crypto.createHash('sha256').update(original).digest('hex');

    await expect(
      assertArchiveMatchesManifest({ bytes: Buffer.byteLength(original), checksumSha256: checksum }, filePath)
    ).rejects.toThrow(/does not match its manifest/);
  });

  test('a truncated archive is refused on size before the checksum is read', async () => {
    const filePath = writeArchive('short');
    await expect(
      assertArchiveMatchesManifest({ bytes: 9999, checksumSha256: 'a'.repeat(64) }, filePath)
    ).rejects.toThrow(/size mismatch/i);
  });

  test('a manifest without a usable checksum is never trusted', async () => {
    const filePath = writeArchive('bytes');
    await expect(
      assertArchiveMatchesManifest({ bytes: 5, checksumSha256: 'not-a-checksum' }, filePath)
    ).rejects.toThrow(/missing a valid SHA-256/);
    await expect(
      assertArchiveMatchesManifest({ checksumSha256: 'a'.repeat(64) }, filePath)
    ).rejects.toThrow(/missing the byte count/);
    await expect(assertArchiveMatchesManifest(null, filePath)).rejects.toThrow(/missing/);
  });
});

describe('retention', () => {
  test('only archives this tool created are eligible for pruning', () => {
    const now = Date.now();
    const old = now - 30 * 24 * 60 * 60 * 1000;
    const files = [
      { name: 'finpro-db-1.dump', mtimeMs: old },
      { name: 'finpro-db-2.dump.enc', mtimeMs: old },
      { name: 'notes.txt', mtimeMs: old },
      { name: 'other-tool.dump', mtimeMs: old },
      { name: 'finpro-db-3.dump', mtimeMs: now },
    ];

    const expired = selectExpiredBackups(files, 14, now);
    expect(expired.sort()).toEqual(['finpro-db-1.dump', 'finpro-db-2.dump.enc']);
  });

  test('retention 0 keeps everything', () => {
    const now = Date.now();
    const files = [{ name: 'finpro-db-1.dump', mtimeMs: 0 }];
    expect(selectExpiredBackups(files, 0, now)).toEqual([]);
  });
});
