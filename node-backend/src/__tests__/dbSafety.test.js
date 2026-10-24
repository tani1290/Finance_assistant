/**
 * Backup/restore safety guards. These are the checks that keep a recovery
 * command from touching a shared or production database.
 */

const {
  parseDatabaseUrl,
  assertBackupTarget,
  assertRestoreTarget,
  connectionEnv,
  sanitizeOutput,
  selectExpiredBackups,
  parseArgs,
  isLocalHost,
} = require('../../scripts/lib/dbSafety');

describe('database URL parsing', () => {
  test('accepts postgres and postgresql URLs', () => {
    expect(parseDatabaseUrl('postgresql://u:p@127.0.0.1:5432/finpro').database).toBe('finpro');
    expect(parseDatabaseUrl('postgres://u@localhost/finpro').host).toBe('localhost');
  });

  test('rejects missing, malformed and non-postgres URLs', () => {
    expect(() => parseDatabaseUrl('')).toThrow(/No database URL/);
    expect(() => parseDatabaseUrl('not a url')).toThrow(/not a valid URL/);
    expect(() => parseDatabaseUrl('mysql://localhost/finpro')).toThrow(/Only postgres/);
    expect(() => parseDatabaseUrl('postgresql://localhost/')).toThrow(/does not name a database/);
  });

  test('knows loopback hosts only', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('::1')).toBe(true);
    expect(isLocalHost('db.render.com')).toBe(false);
    expect(isLocalHost('10.0.0.5')).toBe(false);
  });
});

describe('backup target guard', () => {
  test('allows a local database by default', () => {
    const target = assertBackupTarget('postgresql://u:p@127.0.0.1:5432/finpro');
    expect(target.database).toBe('finpro');
  });

  test('refuses a remote database by default', () => {
    expect(() => assertBackupTarget('postgresql://u:p@db.render.com/finpro')).toThrow(
      /Refusing to back up non-local host/
    );
  });

  test('remote backup needs both the flag and the environment opt-in', () => {
    expect(() =>
      assertBackupTarget('postgresql://u:p@db.render.com/finpro', {
        allowNonLocal: true,
        env: {},
      })
    ).toThrow(/BACKUP_ALLOW_NON_LOCAL/);

    expect(() =>
      assertBackupTarget('postgresql://u:p@db.render.com/finpro', {
        allowNonLocal: false,
        env: { BACKUP_ALLOW_NON_LOCAL: 'true' },
      })
    ).toThrow(/Refusing to back up/);

    const target = assertBackupTarget('postgresql://u:p@db.render.com/finpro', {
      allowNonLocal: true,
      env: { BACKUP_ALLOW_NON_LOCAL: 'true' },
    });
    expect(target.host).toBe('db.render.com');
  });
});

describe('restore target guard', () => {
  test('allows an ordinary local database', () => {
    const target = assertRestoreTarget('postgresql://u@localhost/finpro_restore_1');
    expect(target.database).toBe('finpro_restore_1');
  });

  test('always refuses remote restores, even with environment opt-ins', () => {
    const original = process.env.BACKUP_ALLOW_NON_LOCAL;
    process.env.BACKUP_ALLOW_NON_LOCAL = 'true';
    try {
      expect(() => assertRestoreTarget('postgresql://u:p@db.render.com/finpro')).toThrow(
        /Refusing to restore into non-local host/
      );
    } finally {
      if (original === undefined) delete process.env.BACKUP_ALLOW_NON_LOCAL;
      else process.env.BACKUP_ALLOW_NON_LOCAL = original;
    }
  });

  test('refuses reserved maintenance databases', () => {
    expect(() => assertRestoreTarget('postgresql://localhost/postgres')).toThrow(/reserved database/);
    expect(() => assertRestoreTarget('postgresql://localhost/template1')).toThrow(/reserved database/);
  });
});

describe('child process environment', () => {
  test('uses discrete PG* variables and removes URL variables', () => {
    const target = parseDatabaseUrl('postgresql://alice:s3cret@localhost:5433/finpro?sslmode=require');
    const env = connectionEnv(target, { PATH: '/bin', DATABASE_URL: 'postgres://leak', DIRECT_URL: 'x' });
    expect(env.PGHOST).toBe('localhost');
    expect(env.PGPORT).toBe('5433');
    expect(env.PGUSER).toBe('alice');
    expect(env.PGPASSWORD).toBe('s3cret');
    expect(env.PGDATABASE).toBe('finpro');
    expect(env.PGSSLMODE).toBe('require');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.DIRECT_URL).toBeUndefined();
  });

  test('does not leave a stale password when the URL has none', () => {
    const target = parseDatabaseUrl('postgresql://alice@localhost/finpro');
    const env = connectionEnv(target, { PGPASSWORD: 'stale' });
    expect(env.PGPASSWORD).toBeUndefined();
  });
});

describe('log sanitisation', () => {
  test('masks URLs with credentials and password= values', () => {
    const out = sanitizeOutput(
      'failed postgresql://alice:s3cret@db.example.com/finpro password=hunter2'
    );
    expect(out).not.toContain('s3cret');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('postgresql://[redacted]@');
  });
});

describe('retention', () => {
  const now = Date.UTC(2026, 0, 31);

  test('selects only old finpro archives, including encrypted ones', () => {
    const day = 24 * 60 * 60 * 1000;
    const files = [
      { name: 'finpro-old.dump', mtimeMs: now - 40 * day },
      { name: 'finpro-old-encrypted.dump.enc', mtimeMs: now - 41 * day },
      { name: 'finpro-new.dump', mtimeMs: now - 2 * day },
      { name: 'other.dump', mtimeMs: now - 40 * day },
      { name: 'finpro-old.dump.json', mtimeMs: now - 40 * day },
      { name: 'finpro-old.dump.enc.json', mtimeMs: now - 41 * day },
    ];
    expect(selectExpiredBackups(files, 14, now)).toEqual([
      'finpro-old.dump',
      'finpro-old-encrypted.dump.enc',
    ]);
  });

  test('retention 0 disables pruning', () => {
    expect(selectExpiredBackups([{ name: 'finpro-a.dump', mtimeMs: 0 }], 0, Date.now())).toEqual([]);
  });
});

describe('argument parsing', () => {
  test('supports flags, values and inline values', () => {
    const args = parseArgs([
      '--file',
      'a.dump',
      '--confirm=db',
      '--dry-run',
      '--retention-days',
      '30',
      'positional',
    ]);
    expect(args.file).toBe('a.dump');
    expect(args.confirm).toBe('db');
    expect(args['dry-run']).toBe(true);
    expect(args['retention-days']).toBe('30');
    expect(args._).toEqual(['positional']);
  });
});
