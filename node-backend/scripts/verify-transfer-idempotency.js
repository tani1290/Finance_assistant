#!/usr/bin/env node
/**
 * FinPro — transfer idempotency and ledger integrity against a REAL database.
 *
 *   FINPRO_TRANSFER_VERIFY=1 \
 *   FINPRO_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/finpro_p6_transfer_verify \
 *     node scripts/verify-transfer-idempotency.js
 *
 * The Jest suite proves the transfer contract with a mocked Prisma client.
 * This script proves the parts only a real PostgreSQL engine can prove:
 * atomic two-leg writes, rollback on a mid-transaction failure, concurrent
 * retries converging on one row, and key claims surviving a committed transfer
 * but never leaking across users.
 *
 * SAFETY
 *   - Requires the explicit opt-in marker FINPRO_TRANSFER_VERIFY=1.
 *   - Requires a local host (127.0.0.1 / localhost / ::1).
 *   - Requires a database name ending in _test or _verify.
 *   - Rechecks the connected database with `current_database()`.
 *   - Refuses `finance_jinay` and any non-local target outright.
 *   - Writes only throwaway users/accounts and deletes them afterwards.
 *   - Never prints the connection string.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ALLOWED_DB_RE = /^finpro_[a-z0-9_]+(?:_test|_verify)$/i;

function fatal(message) {
  throw new Error(`[TRANSFER-VERIFY] ${message}`);
}

function resolveDatabaseUrl() {
  if (process.env.FINPRO_TRANSFER_VERIFY !== '1') {
    fatal('Refusing to run without FINPRO_TRANSFER_VERIFY=1 as an explicit test-target marker.');
  }

  const raw = process.env.FINPRO_TEST_DATABASE_URL || '';
  if (!raw) {
    fatal(
      'Set FINPRO_TEST_DATABASE_URL to a disposable, already-migrated test database, e.g. ' +
        'postgresql://postgres@127.0.0.1:5432/finpro_p6_transfer_verify'
    );
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fatal('FINPRO_TEST_DATABASE_URL is not a valid URL.');
  }

  if (!/^postgres(ql)?:$/i.test(parsed.protocol)) {
    fatal(`Refusing non-PostgreSQL protocol "${parsed.protocol}".`);
  }
  if (!LOCAL_HOSTS.has(String(parsed.hostname || '').toLowerCase())) {
    fatal(`Refusing to run against non-local host "${parsed.hostname}".`);
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!databaseName) fatal('The test database URL must include a database name.');
  if (databaseName.toLowerCase() === 'finance_jinay') {
    fatal('Refusing to touch finance_jinay. Use a disposable test database.');
  }
  if (!ALLOWED_DB_RE.test(databaseName)) {
    fatal(
      `Refusing database "${databaseName}". The name must be an explicit disposable target ` +
        'like finpro_p6_transfer_verify or finpro_transfer_test.'
    );
  }

  return { url: parsed.toString(), databaseName };
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Minimal req/res pair. Errors are captured instead of thrown so a test can assert them. */
async function call(handler, { userId, body, params = {}, query = {} }) {
  const req = {
    user: { id: userId },
    body,
    params,
    query,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'finpro-transfer-verify' },
  };

  let statusCode = 200;
  let payload;
  let nextError = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body2) {
      payload = body2;
      return this;
    },
  };

  try {
    await handler(req, res, (error) => {
      nextError = error;
    });
  } catch (error) {
    nextError = error;
  }

  return { statusCode, payload, nextError };
}

const number = (value) => Number(value);
const balanceOf = async (prisma, accountId) =>
  number((await prisma.financialAccount.findUnique({ where: { id: accountId } })).balance);
const rowsOf = (prisma, userId) => prisma.transaction.count({ where: { userId } });
const claimsOf = (prisma, userId, key) =>
  prisma.idempotencyRecord.count({ where: { userId, scope: 'account_transfer', key } });

/**
 * Run a controller call with a real transaction whose second balance write
 * throws. The first debit has already been sent to PostgreSQL when the credit
 * fails, so this catches a missing atomic boundary instead of a validation
 * error that never wrote anything.
 */
async function withInjectedSecondBalanceFailure(prisma, run) {
  const original = prisma.$transaction;
  let injected = false;

  prisma.$transaction = function patchedTransaction(callback, options) {
    return original.call(
      prisma,
      async (tx) => {
        let balanceUpdates = 0;
        const transactional = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === 'financialAccount') {
              return new Proxy(target.financialAccount, {
                get(accountClient, accountProperty) {
                  const value = Reflect.get(accountClient, accountProperty);
                  if (accountProperty === 'update' && typeof value === 'function') {
                    return async (...args) => {
                      balanceUpdates += 1;
                      if (balanceUpdates === 2) {
                        injected = true;
                        throw new Error('INJECTED_MID_TRANSACTION_FAILURE');
                      }
                      return value.apply(accountClient, args);
                    };
                  }
                  return typeof value === 'function' ? value.bind(accountClient) : value;
                },
              });
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return callback(transactional);
      },
      options
    );
  };

  try {
    return await run();
  } finally {
    prisma.$transaction = original;
    if (!injected) {
      console.warn('[TRANSFER-VERIFY] Warning: the injected failure did not fire.');
    }
  }
}

async function main() {
  const target = resolveDatabaseUrl();
  process.env.DATABASE_URL = target.url;

  const prisma = require(path.join(__dirname, '..', 'src', 'config', 'database'));
  const {
    createTransaction,
    deleteTransaction,
  } = require(path.join(__dirname, '..', 'src', 'controllers', 'transactionController'));
  const { transactionEffects } = require(path.join(__dirname, '..', 'src', 'services', 'transactionBalance'));

  await prisma.$connect();
  const connected = await prisma.$queryRawUnsafe('SELECT current_database() AS database');
  const connectedName = connected?.[0]?.database;
  if (connectedName !== target.databaseName) {
    fatal(
      `Connected database "${connectedName}" does not match the requested target ` +
        `"${target.databaseName}". Refusing to write anything.`
    );
  }
  console.log(`[TRANSFER-VERIFY] Target database: ${connectedName} (local, disposable)\n`);

  const stamp = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const createdUsers = [];

  const createUser = async (suffix) => {
    const user = await prisma.user.create({
      data: {
        email: `phase6_transfer_${suffix}_${stamp}@example.invalid`,
        username: `phase6_trf_${suffix}_${stamp}`,
        firstName: 'Phase6',
        lastName: 'Transfer',
      },
    });
    createdUsers.push(user.id);
    return user;
  };

  try {
    const user = await createUser('a');
    const other = await createUser('b');

    const source = await prisma.financialAccount.create({
      data: { userId: user.id, name: 'Source Savings', accountType: 'BANK', balance: 1000, currency: 'INR' },
    });
    const destination = await prisma.financialAccount.create({
      data: { userId: user.id, name: 'Destination Wallet', accountType: 'WALLET', balance: 250, currency: 'INR' },
    });
    const spareDestination = await prisma.financialAccount.create({
      data: { userId: user.id, name: 'Spare Wallet', accountType: 'WALLET', balance: 0, currency: 'INR' },
    });
    const otherSource = await prisma.financialAccount.create({
      data: { userId: other.id, name: 'Other Source', accountType: 'BANK', balance: 100, currency: 'INR' },
    });
    const otherDestination = await prisma.financialAccount.create({
      data: { userId: other.id, name: 'Other Destination', accountType: 'WALLET', balance: 0, currency: 'INR' },
    });

    const balances = async () => ({
      source: await balanceOf(prisma, source.id),
      destination: await balanceOf(prisma, destination.id),
      spare: await balanceOf(prisma, spareDestination.id),
    });
    const assertBalances = async (label, expected) => {
      const actual = await balances();
      check(
        label,
        actual.source === expected.source &&
          actual.destination === expected.destination &&
          actual.spare === expected.spare,
        JSON.stringify(actual)
      );
    };

    const baseBody = {
      amount: 300,
      type: 'TRANSFER',
      accountId: source.id,
      toAccountId: destination.id,
      description: 'Move to wallet',
      date: '2026-10-24',
    };
    const key = `trf-${stamp}-primary`;

    // 1. A keyed transfer creates the row, both legs and the key claim.
    const first = await call(createTransaction, {
      userId: user.id,
      body: { ...baseBody, idempotencyKey: key },
    });
    check(
      'the first keyed transfer is created with 201',
      first.statusCode === 201 && first.payload?.success === true && first.nextError === null,
      `${first.statusCode} ${first.nextError?.message || ''}`
    );
    check('a new keyed transfer is not marked replayed', first.payload?.data?.replayed === false);
    check('the response reports the destination', first.payload?.data?.toAccount === destination.name);
    await assertBalances('the source is debited and the destination credited exactly once', {
      source: 700,
      destination: 550,
      spare: 0,
    });
    check('one transfer row is written', (await rowsOf(prisma, user.id)) === 1);
    check(
      'one idempotency claim is written for the key',
      (await claimsOf(prisma, user.id, key)) === 1
    );

    const firstRow = await prisma.transaction.findFirst({ where: { userId: user.id, id: first.payload.data.id } });
    check('the stored row carries the key and destination', Boolean(
      firstRow && firstRow.idempotencyKey === key && firstRow.toAccountId === destination.id
    ));
    const firstClaim = await prisma.idempotencyRecord.findUnique({
      where: { userId_scope_key: { userId: user.id, scope: 'account_transfer', key } },
    });
    check(
      'the claim points at the transfer and stores a SHA-256 fingerprint',
      Boolean(
        firstClaim &&
          firstClaim.transactionId === firstRow.id &&
          /^[a-f0-9]{64}$/.test(firstClaim.requestFingerprint || '')
      )
    );

    // 2. Replaying the identical request returns the original transfer.
    const replay = await call(createTransaction, {
      userId: user.id,
      body: {
        ...baseBody,
        description: '  Move to wallet  ',
        idempotencyKey: key,
      },
    });
    check(
      'an identical retry returns 200 and the original transfer',
      replay.statusCode === 200 &&
        replay.payload?.success === true &&
        replay.payload?.data?.id === first.payload.data.id,
      `${replay.statusCode} ${replay.payload?.data?.id || ''}`
    );
    check('an identical retry is flagged replayed', replay.payload?.data?.replayed === true);
    check(
      'an identical retry does not claim the key twice',
      (await claimsOf(prisma, user.id, key)) === 1
    );
    await assertBalances('an identical retry does not move money again', {
      source: 700,
      destination: 550,
      spare: 0,
    });
    check('an identical retry does not write a second row', (await rowsOf(prisma, user.id)) === 1);

    // 3. Reusing the key with different details is a conflict.
    const beforeConflictRows = await rowsOf(prisma, user.id);
    const amountConflict = await call(createTransaction, {
      userId: user.id,
      body: { ...baseBody, amount: 301, idempotencyKey: key },
    });
    check(
      'the same key with a different amount is rejected with 409',
      amountConflict.statusCode === 409 &&
        amountConflict.payload?.error?.code === 'IDEMPOTENCY_CONFLICT',
      `${amountConflict.statusCode} ${amountConflict.payload?.error?.code || ''}`
    );
    await assertBalances('a conflicting amount moves no money', {
      source: 700,
      destination: 550,
      spare: 0,
    });
    check('a conflicting amount writes no row', (await rowsOf(prisma, user.id)) === beforeConflictRows);
    check(
      'a conflicting amount does not replace the key claim',
      (await claimsOf(prisma, user.id, key)) === 1
    );

    const destinationConflict = await call(createTransaction, {
      userId: user.id,
      body: { ...baseBody, toAccountId: spareDestination.id, idempotencyKey: key },
    });
    check(
      'the same key with a different destination is rejected with 409',
      destinationConflict.statusCode === 409 &&
        destinationConflict.payload?.error?.code === 'IDEMPOTENCY_CONFLICT',
      String(destinationConflict.statusCode)
    );
    await assertBalances('a conflicting destination moves no money', {
      source: 700,
      destination: 550,
      spare: 0,
    });
    check('a conflicting destination writes no row', (await rowsOf(prisma, user.id)) === beforeConflictRows);

    // 4. Concurrent identical retries converge on one transfer.
    const raceKey = `trf-${stamp}-race`;
    const beforeRaceRows = await rowsOf(prisma, user.id);
    const raceResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(createTransaction, {
          userId: user.id,
          body: { ...baseBody, amount: 50, description: 'race', idempotencyKey: raceKey },
        })
      )
    );
    check(
      'all five concurrent identical retries succeed and agree on one id',
      raceResults.every((result) => result.payload?.success === true) &&
        new Set(raceResults.map((result) => result.payload?.data?.id)).size === 1,
      `codes=${raceResults.map((result) => result.statusCode).join(',')}`
    );
    check(
      'one concurrent retry creates and the others replay',
      raceResults.filter((result) => result.payload?.data?.replayed === false).length === 1 &&
        raceResults.filter((result) => result.payload?.data?.replayed === true).length === 4
    );
    await assertBalances('concurrent identical retries move money exactly once', {
      source: 650,
      destination: 600,
      spare: 0,
    });
    check('concurrent identical retries write one row', (await rowsOf(prisma, user.id)) === beforeRaceRows + 1);
    check('concurrent identical retries write one claim', (await claimsOf(prisma, user.id, raceKey)) === 1);

    // 5. Concurrent conflicting payloads: one winner, the rest 409.
    const conflictRaceKey = `trf-${stamp}-conflict`;
    const beforeConflictRaceRows = await rowsOf(prisma, user.id);
    const beforeConflictRaceBalances = await balances();
    const conflictingAmounts = [11, 22, 33, 44, 55];
    const conflictResults = await Promise.all(
      conflictingAmounts.map((amount) =>
        call(createTransaction, {
          userId: user.id,
          body: { ...baseBody, amount, description: 'conflict-race', idempotencyKey: conflictRaceKey },
        })
      )
    );
    const winners = conflictResults.filter(
      (result) => result.statusCode === 201 && result.payload?.success === true
    );
    const losers = conflictResults.filter(
      (result) =>
        result.statusCode === 409 && result.payload?.error?.code === 'IDEMPOTENCY_CONFLICT'
    );
    check('exactly one conflicting concurrent payload wins', winners.length === 1, `wins=${winners.length}`);
    check('the other conflicting concurrent payloads get 409', losers.length === 4, `conflicts=${losers.length}`);
    const winnerRow = await prisma.transaction.findFirst({
      where: { userId: user.id, idempotencyKey: conflictRaceKey },
    });
    check(
      'a conflicting key produces exactly one row and one claim',
      Boolean(winnerRow) &&
        (await rowsOf(prisma, user.id)) === beforeConflictRaceRows + 1 &&
        (await claimsOf(prisma, user.id, conflictRaceKey)) === 1
    );
    const winnerAmount = winnerRow ? number(winnerRow.amount) : 0;
    await assertBalances('only the winning conflicting amount is applied', {
      source: beforeConflictRaceBalances.source - winnerAmount,
      destination: beforeConflictRaceBalances.destination + winnerAmount,
      spare: 0,
    });

    // 6. Keyless transfers keep the legacy contract: every request is new.
    const beforeKeylessRows = await rowsOf(prisma, user.id);
    const beforeKeylessBalances = await balances();
    await call(createTransaction, {
      userId: user.id,
      body: { ...baseBody, amount: 10, description: 'keyless-1' },
    });
    await call(createTransaction, {
      userId: user.id,
      body: { ...baseBody, amount: 10, description: 'keyless-2' },
    });
    check(
      'two keyless transfers write two rows',
      (await rowsOf(prisma, user.id)) === beforeKeylessRows + 2
    );
    await assertBalances('two keyless transfers move money twice', {
      source: beforeKeylessBalances.source - 20,
      destination: beforeKeylessBalances.destination + 20,
      spare: 0,
    });

    // 7. A mid-transaction failure rolls back both legs and the key claim.
    const rollbackKey = `trf-${stamp}-rollback`;
    const beforeRollbackRows = await rowsOf(prisma, user.id);
    const beforeRollbackBalances = await balances();
    const injected = await withInjectedSecondBalanceFailure(prisma, async () =>
      call(createTransaction, {
        userId: user.id,
        body: { ...baseBody, amount: 77, description: 'rollback', idempotencyKey: rollbackKey },
      })
    );
    check(
      'a mid-transaction failure is surfaced to the error handler',
      Boolean(injected.nextError) && injected.payload === undefined,
      injected.nextError?.message || ''
    );
    await assertBalances('a mid-transaction failure leaves both balances untouched', beforeRollbackBalances);
    check(
      'a mid-transaction failure writes no row and no claim',
      (await rowsOf(prisma, user.id)) === beforeRollbackRows &&
        (await claimsOf(prisma, user.id, rollbackKey)) === 0
    );
    const rollbackRetry = await call(createTransaction, {
      userId: user.id,
      body: { ...baseBody, amount: 77, description: 'rollback', idempotencyKey: rollbackKey },
    });
    check(
      'the same key can be retried after the rollback and creates the transfer',
      rollbackRetry.statusCode === 201 && rollbackRetry.payload?.data?.replayed === false,
      String(rollbackRetry.statusCode)
    );
    await assertBalances('the rolled-back retry moves money exactly once', {
      source: beforeRollbackBalances.source - 77,
      destination: beforeRollbackBalances.destination + 77,
      spare: 0,
    });

    // 8. Validation failures never write or claim.
    const invalidCases = [
      {
        name: 'same source and destination is rejected',
        body: { ...baseBody, toAccountId: source.id },
        status: 400,
      },
      {
        name: 'a missing destination is rejected',
        body: { ...baseBody, toAccountId: undefined },
        status: 400,
      },
      {
        name: 'a malformed key is rejected',
        body: { ...baseBody, idempotencyKey: 'short' },
        status: 400,
      },
      {
        name: 'a key on a non-transfer is rejected',
        body: { amount: 50, type: 'INCOME', accountId: source.id, idempotencyKey: `inc-${stamp}-key` },
        status: 400,
      },
      {
        name: 'an invalid date is rejected',
        body: { ...baseBody, date: '2026-02-31', idempotencyKey: `trf-${stamp}-baddate` },
        status: 400,
      },
    ];
    const beforeValidationRows = await rowsOf(prisma, user.id);
    const beforeValidationBalances = await balances();
    for (const testCase of invalidCases) {
      const result = await call(createTransaction, { userId: user.id, body: testCase.body });
      check(
        testCase.name,
        result.statusCode === testCase.status && result.payload?.success === false,
        String(result.statusCode)
      );
    }
    await assertBalances('validation failures move no money', beforeValidationBalances);
    check('validation failures write no rows', (await rowsOf(prisma, user.id)) === beforeValidationRows);
    check(
      'a rejected date does not claim its key',
      (await claimsOf(prisma, user.id, `trf-${stamp}-baddate`)) === 0
    );
    check(
      'a rejected non-transfer does not claim its key',
      (await claimsOf(prisma, user.id, `inc-${stamp}-key`)) === 0
    );

    // 9. A destination owned by someone else is not found.
    const foreign = await call(createTransaction, {
      userId: user.id,
      body: { ...baseBody, toAccountId: otherDestination.id, idempotencyKey: `trf-${stamp}-foreign` },
    });
    check(
      'a foreign destination is rejected with 404 and moves nothing',
      foreign.statusCode === 404 &&
        foreign.payload?.error?.code === 'NOT_FOUND' &&
        (await claimsOf(prisma, user.id, `trf-${stamp}-foreign`)) === 0,
      String(foreign.statusCode)
    );

    // 10. Income/expense stay one-sided and transfers never masquerade as them.
    const income = await call(createTransaction, {
      userId: user.id,
      body: { amount: 100, type: 'INCOME', accountId: source.id, description: 'income' },
    });
    const expense = await call(createTransaction, {
      userId: user.id,
      body: { amount: 20, type: 'EXPENSE', accountId: source.id, description: 'expense' },
    });
    check(
      'income and expense still create rows',
      income.statusCode === 201 && expense.statusCode === 201,
      `${income.statusCode}/${expense.statusCode}`
    );
    const totals = await prisma.transaction.groupBy({
      by: ['transactionType'],
      where: { userId: user.id, transactionType: { in: ['INCOME', 'EXPENSE'] } },
      _sum: { amount: true },
    });
    const totalFor = (type) => number(totals.find((row) => row.transactionType === type)?._sum.amount || 0);
    check(
      'income and expense totals contain no transfer amount',
      totalFor('INCOME') === 100 && totalFor('EXPENSE') === 20,
      `income=${totalFor('INCOME')} expense=${totalFor('EXPENSE')}`
    );

    // 11. Every account balance equals its opening balance plus every ledger
    // effect ever recorded for it.
    const openingBalances = new Map([
      [source.id, 1000],
      [destination.id, 250],
      [spareDestination.id, 0],
    ]);
    const reconcile = async (label) => {
      const rows = await prisma.transaction.findMany({ where: { userId: user.id } });
      const ledger = new Map();
      for (const row of rows) {
        for (const effect of transactionEffects(row)) {
          ledger.set(effect.accountId, (ledger.get(effect.accountId) || 0) + effect.delta);
        }
      }
      const actual = await balances();
      const expected = (accountId) =>
        (openingBalances.get(accountId) || 0) + (ledger.get(accountId) || 0);
      const expectedSource = expected(source.id);
      const expectedDestination = expected(destination.id);
      const expectedSpare = expected(spareDestination.id);
      check(
        label,
        actual.source === expectedSource &&
          actual.destination === expectedDestination &&
          actual.spare === expectedSpare,
        `actual=${JSON.stringify(actual)} expected=${JSON.stringify({
          source: expectedSource,
          destination: expectedDestination,
          spare: expectedSpare,
        })}`
      );
    };
    await reconcile('every account balance reconciles to its ledger effects');

    // 12. Another user may reuse the same key without touching this user.
    const beforeOtherRows = await rowsOf(prisma, user.id);
    const beforeOtherBalances = await balances();
    const otherTransfer = await call(createTransaction, {
      userId: other.id,
      body: {
        ...baseBody,
        amount: 40,
        accountId: otherSource.id,
        toAccountId: otherDestination.id,
        description: 'other user',
        idempotencyKey: key,
      },
    });
    check(
      'another user can reuse the same key value',
      otherTransfer.statusCode === 201 && otherTransfer.payload?.data?.replayed === false,
      String(otherTransfer.statusCode)
    );
    check(
      'the other user gets a different transfer id',
      otherTransfer.payload?.data?.id !== first.payload.data.id
    );
    check(
      'the other user move does not touch the first user',
      (await rowsOf(prisma, user.id)) === beforeOtherRows
    );
    await assertBalances('the other user move leaves this user balances unchanged', beforeOtherBalances);
    check(
      'both users keep their own claim for the same key',
      (await claimsOf(prisma, user.id, key)) === 1 &&
        (await claimsOf(prisma, other.id, key)) === 1
    );
    check(
      'the other user balances are correct',
      (await balanceOf(prisma, otherSource.id)) === 60 &&
        (await balanceOf(prisma, otherDestination.id)) === 40
    );

    // 13. Deleting a transfer reverses both legs, and an old key never revives it.
    const beforeDeleteBalances = await balances();
    const deleted = await call(deleteTransaction, {
      userId: user.id,
      params: { id: first.payload.data.id },
      body: {},
    });
    check('the keyed transfer can be deleted', deleted.statusCode === 200 && deleted.payload?.success === true);
    await assertBalances('deleting a transfer reverses both legs', {
      source: beforeDeleteBalances.source + 300,
      destination: beforeDeleteBalances.destination - 300,
      spare: beforeDeleteBalances.spare,
    });
    check(
      'the deleted transfer row is gone but its key claim remains',
      (await prisma.transaction.findUnique({ where: { id: first.payload.data.id } })) === null &&
        (await claimsOf(prisma, user.id, key)) === 1
    );
    const afterDeleteRows = await rowsOf(prisma, user.id);
    const afterDeleteBalances = await balances();
    const resurrect = await call(createTransaction, {
      userId: user.id,
      body: { ...baseBody, idempotencyKey: key },
    });
    check(
      'retrying a deleted transfer key is a conflict, not a resurrection',
      resurrect.statusCode === 409 &&
        resurrect.payload?.error?.code === 'IDEMPOTENCY_CONFLICT',
      String(resurrect.statusCode)
    );
    await assertBalances('a deleted-transfer retry moves no money', afterDeleteBalances);
    check('a deleted-transfer retry writes no row', (await rowsOf(prisma, user.id)) === afterDeleteRows);
    await reconcile('balances still reconcile after the deletion');
  } finally {
    for (const userId of createdUsers) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    await prisma.$disconnect().catch(() => {});
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.error('\nFailed checks:');
    for (const failure of failed) {
      console.error(` - ${failure.name}${failure.detail ? ` (${failure.detail})` : ''}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[TRANSFER-VERIFY] failed:', error.message);
  process.exit(1);
});
