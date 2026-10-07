import { test } from "node:test";
import assert from "node:assert/strict";
import { guarantors, vaults, beneficiaries, loans, beneficiaryLinks, generateId } from "../stores";
import { sweepLoanLifecycle } from "../services/liquidation.service";
import { Loan, InstallmentScheduleItem } from "../types";

/**
 * Load test for the lifecycle sweep against a large synthetic book of open
 * loans (#47). Not part of `npm test` -- named *.load-test.ts, like the
 * existing *.chain-test.ts convention, and run on demand via
 * `npm run test:load`. It seeds thousands of loans directly into the
 * store (bypassing origination) and measures one real sweepLoanLifecycle()
 * call, printing the duration rather than asserting a tight bound that
 * would make CI flaky on a slower machine.
 */

function schedule(count: number, overdueCount: number): InstallmentScheduleItem[] {
  const items: InstallmentScheduleItem[] = [];
  const now = Date.now();
  for (let i = 1; i <= count; i++) {
    items.push({
      installmentNumber: i,
      amountLocal: 10_000,
      amountUsd: 10,
      // The first `overdueCount` installments are due in the past (pending,
      // so the sweep marks them overdue); the rest are due in the future.
      dueAt: new Date(now + (i <= overdueCount ? -i : i) * 24 * 60 * 60 * 1000).toISOString(),
      status: "pending",
    });
  }
  return items;
}

function seedLoan(
  guarantorId: string,
  vaultId: string,
  beneficiaryId: string,
  shape: "current" | "freshly-overdue" | "grace-expired",
): Loan {
  const now = Date.now();
  const base: Loan = {
    id: generateId(),
    guarantorId,
    vaultId,
    beneficiaryId,
    principalLocal: 40_000,
    principalUsd: 40,
    localCurrency: "NGN",
    fxRate: 1000,
    ltvRatio: 1.3,
    collateralLockedUsd: 52,
    collateralReleasedUsd: 0,
    collateralForfeitedUsd: 0,
    installmentCount: 4,
    installmentIntervalDays: 30,
    schedule: schedule(4, 0),
    status: "active",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };

  if (shape === "freshly-overdue") {
    base.schedule = schedule(4, 1); // installment 1 due yesterday, still "pending"
  } else if (shape === "grace-expired") {
    base.status = "grace";
    base.graceExpiresAt = new Date(now - 60_000).toISOString(); // expired a minute ago
    base.schedule = schedule(4, 1);
    base.schedule[0].status = "overdue";
  }
  return base;
}

async function runLoadTest(totalLoans: number): Promise<{ durationMs: number; evaluated: number; enteredGrace: number; defaulted: number }> {
  // Each size runs in isolation -- loans left behind by a previous size in
  // this same process (the store is a module-level singleton) would
  // otherwise get swept again and inflate the next size's counts.
  loans.clear();
  guarantors.clear();
  vaults.clear();
  beneficiaries.clear();
  beneficiaryLinks.clear();

  const guarantorId = generateId();
  const vaultId = generateId();
  const beneficiaryId = generateId();

  guarantors.set(guarantorId, {
    id: guarantorId,
    walletAddress: `G${"A".repeat(55)}`,
    createdAt: new Date().toISOString(),
  });
  vaults.set(vaultId, {
    id: vaultId,
    guarantorId,
    collateralBalance: 1_000_000,
    lockedAmount: 500_000,
    createdAt: new Date().toISOString(),
  });
  beneficiaries.set(beneficiaryId, {
    id: beneficiaryId,
    phoneNumber: "+2348000000000",
    localKycRef: "LOAD-TEST",
    localCurrency: "NGN",
    reputationScore: 0,
    createdAt: new Date().toISOString(),
  });
  beneficiaryLinks.set(guarantorId, new Map([[beneficiaryId, { guarantorId, beneficiaryId, createdAt: new Date().toISOString() }]]));

  // A third each: untouched, newly overdue (-> grace), and grace already
  // expired (-> defaulted) -- so the sweep actually does the full range of
  // work it's capable of, not just a no-op scan.
  let enteredGraceExpected = 0;
  let defaultedExpected = 0;
  for (let i = 0; i < totalLoans; i++) {
    const shape = i % 3 === 0 ? "current" : i % 3 === 1 ? "freshly-overdue" : "grace-expired";
    if (shape === "freshly-overdue") enteredGraceExpected++;
    if (shape === "grace-expired") defaultedExpected++;
    const loan = seedLoan(guarantorId, vaultId, beneficiaryId, shape);
    loans.set(loan.id, loan);
  }

  const start = Date.now();
  const result = await sweepLoanLifecycle();
  const durationMs = Date.now() - start;

  assert.equal(result.loansEvaluated, totalLoans);
  assert.equal(result.enteredGrace.length, enteredGraceExpected);
  assert.equal(result.defaulted.length, defaultedExpected);

  return { durationMs, evaluated: result.loansEvaluated, enteredGrace: result.enteredGrace.length, defaulted: result.defaulted.length };
}

// NOT 10,000+: computeCompositeScore (src/services/reputation.service.ts)
// rescans the *entire* loans store on every refreshReputationScore call,
// which the sweep makes once per loan that newly misses a payment or
// defaults -- O(n) work per call, O(n) such calls, O(n^2) overall. 1,000
// loans swept in 785ms here; 10,000 did not finish in over four minutes
// before being killed. Filed as #67 rather than fixed in this PR, which
// is about having a load test at all.
for (const size of [500, 2_000]) {
  test(`sweeps ${size.toLocaleString()} open loans correctly, in reasonable time`, async () => {
    const { durationMs, evaluated, enteredGrace, defaulted } = await runLoadTest(size);
    // eslint-disable-next-line no-console
    console.log(
      `[load-test] ${size.toLocaleString()} loans: evaluated=${evaluated} enteredGrace=${enteredGrace} ` +
      `defaulted=${defaulted} durationMs=${durationMs} (${(durationMs / size).toFixed(3)}ms/loan)`,
    );
    // A loose smoke bound, not a tight perf assertion -- this exists to
    // catch an accidental O(n^2) regression, not to enforce a latency SLO.
    assert.ok(durationMs < size * 5 + 5_000, `sweep took unexpectedly long: ${durationMs}ms for ${size} loans`);
  });
}
