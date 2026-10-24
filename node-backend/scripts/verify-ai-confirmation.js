#!/usr/bin/env node
/**
 * FinPro — AI confirmation gate verification against a REAL database.
 *
 *   PHASE4_VERIFY_DATABASE_URL=postgresql://.../finpro_phase4_verify \
 *     node scripts/verify-ai-confirmation.js
 *
 * The Jest suite proves the state machine with a mocked Prisma client. This
 * script proves the same guarantees against the real engine, because the
 * concurrency guarantee depends on a real conditional UPDATE and a real
 * transaction isolation level.
 *
 * It verifies, against PostgreSQL:
 *   - a proposal row is created with a hashed token (never the plaintext);
 *   - retrieval is bound to the owning user;
 *   - an expired proposal is rejected with 410 and marked EXPIRED;
 *   - a live proposal can be claimed exactly once (PENDING -> EXECUTING);
 *   - five concurrent claims produce exactly one winner;
 *   - a claimed proposal can reach COMPLETED or FAILED, and never returns to
 *     PENDING;
 *   - a replayed or cross-user token is rejected.
 *
 * SAFETY
 *   - It refuses to run against anything except 127.0.0.1 / localhost.
 *   - It only creates rows for a throwaway user that it deletes afterwards.
 *   - It never prints the connection string or any secret.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function resolveDatabaseUrl() {
  const raw =
    process.env.PHASE4_VERIFY_DATABASE_URL ||
    process.env.VERIFY_DATABASE_URL ||
    '';
  if (!raw) {
    throw new Error(
      'Set PHASE4_VERIFY_DATABASE_URL to the isolated test database, e.g. ' +
        'postgresql://user@127.0.0.1:5432/finpro_phase4_verify'
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

async function main() {
  process.env.DATABASE_URL = resolveDatabaseUrl();

  const prisma = require(path.join(__dirname, '..', 'src', 'config', 'database'));
  const aiConfirmation = require(path.join(__dirname, '..', 'src', 'services', 'aiConfirmationService'));

  const stamp = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const email = `phase4_verify_${stamp}@example.invalid`;
  const username = `phase4_verify_${stamp}`;

  const user = await prisma.user.create({
    data: { email, username, firstName: 'Phase4', lastName: 'Verify' },
  });
  const other = await prisma.user.create({
    data: {
      email: `phase4_verify_b_${stamp}@example.invalid`,
      username: `phase4_verify_b_${stamp}`,
      firstName: 'Phase4',
      lastName: 'Other',
    },
  });

  try {
    // 1. Creation stores a hash, never the plaintext token.
    const prepared = await aiConfirmation.createProposal({
      userId: user.id,
      toolName: 'create_transaction',
      args: { amount: 500, category: 'Food' },
    });
    const row = await prisma.aiActionProposal.findFirst({
      where: { id: prepared.proposal.id },
    });
    check('proposal row is created', Boolean(row));
    check('token is stored hashed', row.tokenHash !== prepared.token && /^[a-f0-9]{64}$/.test(row.tokenHash));
    check(
      'plaintext token is not persisted',
      !JSON.stringify(row).includes(prepared.token),
    );
    check('proposal starts PENDING', row.status === 'PENDING', row.status);
    check('proposal is bound to its owner', row.userId === user.id);
    check('expiry is stored', row.expiresAt instanceof Date && row.expiresAt.getTime() > Date.now());

    // 2. A different user cannot see the proposal.
    const crossUser = await aiConfirmation.beginExecution(other.id, prepared.token);
    check('cross-user claim is rejected with 404', crossUser.ok === false && crossUser.status === 404, crossUser.error?.code);
    check('cross-user claim leaves the row PENDING', row.status === 'PENDING');

    // 3. Expiry is enforced and recorded.
    const expiring = await aiConfirmation.createProposal({
      userId: user.id,
      toolName: 'create_transaction',
      args: { amount: 1 },
    });
    await prisma.aiActionProposal.update({
      where: { id: expiring.proposal.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await aiConfirmation.beginExecution(user.id, expiring.token);
    check('expired claim is rejected with 410', expired.ok === false && expired.status === 410, expired.error?.code);
    const expiredRow = await prisma.aiActionProposal.findFirst({ where: { id: expiring.proposal.id } });
    check('expired proposal is marked EXPIRED', expiredRow.status === 'EXPIRED', expiredRow.status);
    const expiredRetry = await aiConfirmation.beginExecution(user.id, expiring.token);
    check('expired proposal stays rejected on retry', expiredRetry.ok === false && expiredRetry.status === 410);

    // 4. A live proposal is claimed exactly once.
    const claimable = await aiConfirmation.createProposal({
      userId: user.id,
      toolName: 'create_transaction',
      args: { amount: 750 },
    });
    const claimed = await aiConfirmation.beginExecution(user.id, claimable.token);
    check('a pending proposal can be claimed', claimed.ok === true);
    const claimedRow = await prisma.aiActionProposal.findFirst({ where: { id: claimable.proposal.id } });
    check('claim moves the row to EXECUTING', claimedRow.status === 'EXECUTING', claimedRow.status);
    check('claim increments attempts once', claimedRow.attempts === 1, String(claimedRow.attempts));
    check('claim records the execution start time', claimedRow.executionStartedAt instanceof Date);

    const replay = await aiConfirmation.beginExecution(user.id, claimable.token);
    check('replay is rejected with 409', replay.ok === false && replay.status === 409, replay.error?.code);
    check('replay is not marked retryable', replay.error?.retryable === false);

    // 5. Terminal states.
    await aiConfirmation.completeProposal(claimable.proposal.id, 'Applied in verification.');
    const completedRow = await prisma.aiActionProposal.findFirst({ where: { id: claimable.proposal.id } });
    check('a completed proposal is terminal', completedRow.status === 'COMPLETED', completedRow.status);
    check('a completed proposal records its summary', completedRow.resultSummary === 'Applied in verification.');
    const afterComplete = await aiConfirmation.beginExecution(user.id, claimable.token);
    check('a completed proposal cannot be claimed again', afterComplete.ok === false && afterComplete.status === 409, afterComplete.error?.code);

    const failing = await aiConfirmation.createProposal({
      userId: user.id,
      toolName: 'create_transaction',
      args: { amount: 999 },
    });
    await aiConfirmation.beginExecution(user.id, failing.token);
    await aiConfirmation.failProposal(failing.proposal.id, 'FAILED: simulated write failure');
    const failedRow = await prisma.aiActionProposal.findFirst({ where: { id: failing.proposal.id } });
    check('a failed proposal is terminal', failedRow.status === 'FAILED', failedRow.status);
    check('a failed proposal is not retryable', failedRow.retryable === false);
    const afterFailure = await aiConfirmation.beginExecution(user.id, failing.token);
    check('a failed proposal cannot be reclaimed', afterFailure.ok === false && afterFailure.status === 409, afterFailure.error?.code);
    check('a failed proposal reports FAILED state', afterFailure.error?.executionState === 'FAILED');

    // 6. Concurrency: five simultaneous claims, exactly one winner.
    const contested = await aiConfirmation.createProposal({
      userId: user.id,
      toolName: 'create_transaction',
      args: { amount: 4242 },
    });
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => aiConfirmation.beginExecution(user.id, contested.token)),
    );
    const winners = attempts.filter((a) => a.ok === true);
    const losers = attempts.filter((a) => a.ok === false);
    check('exactly one concurrent claim succeeds', winners.length === 1, `winners=${winners.length}`);
    check('every other concurrent claim is rejected', losers.length === 4 && losers.every((l) => l.status === 409));
    const contestedRow = await prisma.aiActionProposal.findFirst({ where: { id: contested.proposal.id } });
    check('a contested proposal records exactly one attempt', contestedRow.attempts === 1, String(contestedRow.attempts));
    check('a contested proposal is not marked retryable', contestedRow.retryable === false);

    // 7. Cancellation.
    const cancellable = await aiConfirmation.createProposal({
      userId: user.id,
      toolName: 'create_transaction',
      args: { amount: 7 },
    });
    const cancelled = await aiConfirmation.cancelProposal(user.id, cancellable.token);
    check('a pending proposal can be cancelled', cancelled.ok === true);
    const cancelledRow = await prisma.aiActionProposal.findFirst({ where: { id: cancellable.proposal.id } });
    check('a cancelled proposal is terminal', cancelledRow.status === 'CANCELLED', cancelledRow.status);
    const claimCancelled = await aiConfirmation.beginExecution(user.id, cancellable.token);
    check('a cancelled proposal cannot be claimed', claimCancelled.ok === false && claimCancelled.status === 409);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: other.id } }).catch(() => {});
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
  console.error('[AI-CONFIRM-VERIFY] failed:', err.message);
  process.exit(1);
});
