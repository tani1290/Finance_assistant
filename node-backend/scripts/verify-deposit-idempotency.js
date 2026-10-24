#!/usr/bin/env node
/**
 * FinPro — deposit idempotency verification against a REAL database.
 *
 *   PHASE5_VERIFY_DATABASE_URL=postgresql://user@127.0.0.1:5432/finpro_p5_verify \
 *     node scripts/verify-deposit-idempotency.js
 *
 * The Jest suite proves the deposit replay rules with a mocked Prisma client.
 * This script proves them against the real engine, because the guarantee is
 * enforced by the primary key of `idempotency_records`: a mocked client cannot
 * show what a real concurrent INSERT does.
 *
 * It verifies:
 *   - a deposit with an idempotency key creates one ledger row and one credit;
 *   - the same key replayed returns the ORIGINAL transaction and does not
 *     credit the account again;
 *   - the same key with different details (amount/account/date/source/
 *     description) returns 409 and writes nothing;
 *   - five concurrent deposits with the same key produce exactly ONE credit
 *     and ONE ledger row;
 *   - five concurrent deposits with the same key but different amounts
 *     produce one winner and four 409s;
 *   - a rejected (rolled-back) request does not claim the key, so the same
 *     key can be retried;
 *   - a deposit WITHOUT a key is unchanged (every request is a new deposit);
 *   - the balance always matches the sum of the ledger.
 *
 * SAFETY
 *   - Refuses to run against anything except 127.0.0.1 / localhost.
 *   - It only writes rows for a throwaway user that it deletes afterwards.
 *   - It never prints the connection string or any secret.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function resolveDatabaseUrl() {
  const raw = process.env.PHASE5_VERIFY_DATABASE_URL || '';
  if (!raw) {
    throw new Error(
      'Set PHASE5_VERIFY_DATABASE_URL to an isolated, already-migrated test database, e.g. ' +
        'postgresql://user@127.0.0.1:5432/finpro_p5_verify'
    );
  }
  const parsed = new URL(raw);
  if (!LOCAL_HOSTS.has(String(parsed.hostname || '').toLowerCase())) {
    throw new Error(
      `Refusing to run against non-local host "${parsed.hostname}". ` +
        'This verification must only touch an isolated local test database.'
    );
  }
  return parsed.toString();
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Minimal req/res pair for the controller. */
function call(handler, { userId, body, params = {} }) {
  const req = { user: { id: userId }, body, params };
  let statusCode = 200;
  let payload;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body2) { payload = body2; return this; },
  };
  return handler(req, res, (err) => { throw err; }).then(() => ({ statusCode, payload }));
}

async function main() {
  process.env.DATABASE_URL = resolveDatabaseUrl();

  const prisma = require(path.join(__dirname, '..', 'src', 'config', 'database'));
  const { depositMoney } = require(path.join(__dirname, '..', 'src', 'controllers', 'accountController'));

  const stamp = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const user = await prisma.user.create({
    data: {
      email: `phase5_deposit_${stamp}@example.invalid`,
      username: `phase5_dep_${stamp}`,
      firstName: 'Phase5',
      lastName: 'Deposit',
    },
  });

  try {
    const account = await prisma.financialAccount.create({
      data: { userId: user.id, name: 'Verification Account', accountType: 'BANK', balance: 0, currency: 'INR' },
    });

    const balanceOf = async () => Number((await prisma.financialAccount.findUnique({
      where: { id: account.id },
    })).balance);

    const rowsOf = async () => prisma.transaction.count({ where: { userId: user.id } });

    // 1. A deposit with a key.
    const key = `dep-${stamp}-a`;
    const first = await call(depositMoney, {
      userId: user.id,
      params: { accountId: account.id },
      body: { amount: 750, description: 'first', idempotencyKey: key },
    });
    check('the first deposit succeeds', first.statusCode === 200 && first.payload.success === true);
    check('the account is credited once', (await balanceOf()) === 750, String(await balanceOf()));
    check('one ledger row is written', (await rowsOf()) === 1);
    check('the key is stored on the row', Boolean(
      await prisma.transaction.findFirst({ where: { userId: user.id, idempotencyKey: key } })
    ));

    // 2. The same key replayed.
    const replay = await call(depositMoney, {
      userId: user.id,
      params: { accountId: account.id },
      body: { amount: 750, description: 'first', idempotencyKey: key },
    });
    check('a replay still returns 200', replay.statusCode === 200 && replay.payload.success === true);
    check('a replay is flagged as replayed', replay.payload.data.replayed === true);
    check(
      'a replay returns the original transaction id',
      replay.payload.data.transactionId === first.payload.data.transactionId,
      `${replay.payload.data.transactionId} vs ${first.payload.data.transactionId}`
    );
    check('a replay does not credit the account again', (await balanceOf()) === 750, String(await balanceOf()));
    check('a replay does not write a second row', (await rowsOf()) === 1);
    check(
      'a replay message does not claim new funds were added',
      /already applied/i.test(replay.payload.data.message) &&
        !/Successfully added/.test(replay.payload.data.message),
      replay.payload.data.message
    );
    check(
      'a replay reports the original amount, not a retried amount',
      replay.payload.data.originalAmount === 750,
      String(replay.payload.data.originalAmount)
    );

    // 2b. The same key with different deposit details must be rejected.
    const beforeConflict = await balanceOf();
    const rowsBeforeConflict = await rowsOf();
    const conflict = await call(depositMoney, {
      userId: user.id,
      params: { accountId: account.id },
      body: { amount: 9999, description: 'first', idempotencyKey: key },
    });
    check(
      'a conflicting replay is rejected with 409',
      conflict.statusCode === 409 && conflict.payload?.error?.code === 'IDEMPOTENCY_CONFLICT',
      `${conflict.statusCode} ${conflict.payload?.error?.code || ''}`
    );
    check(
      'a conflicting replay does not credit the account',
      (await balanceOf()) === beforeConflict,
      String(await balanceOf())
    );
    check('a conflicting replay does not write a ledger row', (await rowsOf()) === rowsBeforeConflict);
    check(
      'a conflicting replay does not replace the key claim',
      (await prisma.idempotencyRecord.count({ where: { userId: user.id, key } })) === 1
    );

    // 3. Concurrent deposits with the same key.
    const raceKey = `dep-${stamp}-b`;
    const before = await balanceOf();
    const results5 = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(depositMoney, {
          userId: user.id,
          params: { accountId: account.id },
          body: { amount: 100, description: 'race', idempotencyKey: raceKey },
        })
      )
    );
    const okCount = results5.filter((r) => r.statusCode === 200 && r.payload?.success).length;
    check('every concurrent request is answered 200', okCount === 5, `ok=${okCount}`);
    const ids = new Set(results5.map((r) => r.payload?.data?.transactionId).filter(Boolean));
    check('all concurrent requests resolve to one transaction', ids.size === 1, `ids=${ids.size}`);
    check('the account is credited exactly once', (await balanceOf()) === before + 100, String(await balanceOf()));
    check('exactly one extra ledger row exists', (await rowsOf()) === 2, String(await rowsOf()));

    // 3b. Concurrent requests with the same key but conflicting amounts.
    const conflictRaceKey = `dep-${stamp}-c`;
    const beforeConflictRace = await balanceOf();
    const conflictAmounts = [11, 22, 33, 44, 55];
    const conflictResults = await Promise.all(
      conflictAmounts.map((amount) =>
        call(depositMoney, {
          userId: user.id,
          params: { accountId: account.id },
          body: { amount, description: 'race-conflict', idempotencyKey: conflictRaceKey },
        })
      )
    );
    const conflictWins = conflictResults.filter((r) => r.statusCode === 200 && r.payload?.success);
    const conflictLosses = conflictResults.filter(
      (r) => r.statusCode === 409 && r.payload?.error?.code === 'IDEMPOTENCY_CONFLICT'
    );
    check('exactly one concurrent conflicting payload wins', conflictWins.length === 1, `wins=${conflictWins.length}`);
    check('the other conflicting payloads get 409', conflictLosses.length === 4, `conflicts=${conflictLosses.length}`);
    const conflictRow = await prisma.transaction.findFirst({
      where: { userId: user.id, idempotencyKey: conflictRaceKey },
    });
    check(
      'a conflicting key produces exactly one ledger row',
      Boolean(conflictRow) && (await rowsOf()) === 3,
      String(await rowsOf())
    );
    check(
      'only the winning amount is credited',
      Boolean(conflictRow) && (await balanceOf()) === beforeConflictRace + Number(conflictRow.amount),
      conflictRow ? String(conflictRow.amount) : 'no row'
    );

    // 4. A deposit without a key is unchanged: every request is a new deposit.
    const beforeKeyless = await balanceOf();
    await call(depositMoney, {
      userId: user.id,
      params: { accountId: account.id },
      body: { amount: 50, description: 'keyless-1' },
    });
    await call(depositMoney, {
      userId: user.id,
      params: { accountId: account.id },
      body: { amount: 50, description: 'keyless-2' },
    });
    check('two keyless deposits credit twice', (await balanceOf()) === beforeKeyless + 100, String(await balanceOf()));
    check('two keyless deposits write two rows', (await rowsOf()) === 5, String(await rowsOf()));

    // 4b. A rolled-back request leaves no key claim, so the retry succeeds.
    const rollbackKey = `dep-${stamp}-d`;
    const beforeRollback = await balanceOf();
    const rowsBeforeRollback = await rowsOf();
    const invalid = await call(depositMoney, {
      userId: user.id,
      params: { accountId: account.id },
      body: { amount: 60, date: '2026-02-31', idempotencyKey: rollbackKey },
    });
    check('an invalid date is rejected with 400', invalid.statusCode === 400, String(invalid.statusCode));
    check(
      'a rejected deposit writes no ledger row and changes no balance',
      (await rowsOf()) === rowsBeforeRollback && (await balanceOf()) === beforeRollback
    );
    check(
      'a rejected deposit does not claim the key',
      (await prisma.idempotencyRecord.count({ where: { userId: user.id, key: rollbackKey } })) === 0
    );
    const retried = await call(depositMoney, {
      userId: user.id,
      params: { accountId: account.id },
      body: { amount: 60, date: '2026-02-28', idempotencyKey: rollbackKey },
    });
    check(
      'the same key can be retried after the rollback',
      retried.statusCode === 200 && retried.payload?.data?.replayed === false,
      String(retried.statusCode)
    );
    check(
      'the retry credits exactly once',
      (await balanceOf()) === beforeRollback + 60 && (await rowsOf()) === rowsBeforeRollback + 1,
      `${await balanceOf()} / ${await rowsOf()}`
    );

    // 5. The balance always matches the ledger.
    const sum = await prisma.transaction.aggregate({
      where: { userId: user.id },
      _sum: { amount: true },
    });
    check(
      'the balance equals the sum of the ledger',
      Number(sum._sum.amount) === (await balanceOf()),
      `ledger=${sum._sum.amount} balance=${await balanceOf()}`
    );

    // 6. The key is scoped to the user.
    const other = await prisma.user.create({
      data: {
        email: `phase5_deposit_b_${stamp}@example.invalid`,
        username: `phase5_dep_b_${stamp}`,
        firstName: 'Phase5',
        lastName: 'Other',
      },
    });
    const otherAccount = await prisma.financialAccount.create({
      data: { userId: other.id, name: 'Other Account', accountType: 'BANK', balance: 0, currency: 'INR' },
    });
    const otherDeposit = await call(depositMoney, {
      userId: other.id,
      params: { accountId: otherAccount.id },
      body: { amount: 25, description: 'other user', idempotencyKey: key },
    });
    check('another user may reuse the same key value', otherDeposit.statusCode === 200 && otherDeposit.payload.data.replayed === false);
    await prisma.user.delete({ where: { id: other.id } }).catch(() => {});
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.error('\nFailed checks:');
    failed.forEach((f) => console.error(` - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[DEPOSIT-VERIFY] failed:', err.message);
  process.exit(1);
});
