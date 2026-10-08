import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../testing/server";
import { signIn } from "../testing/auth";
import { config } from "../config";
import * as loanService from "../services/loan.service";
import { queryAuditEvents } from "../services/audit.service";
import { OffRampAdapter } from "../adapters/offramp.interface";
import { ExchangeRate } from "../types";

let base = "";
let close: () => Promise<void>;
let token = "";
const savedTimeout = config.disbursementTimeoutMs;
const savedAdminWallet = config.adminWalletAddress;

before(async () => {
  ({ base, close } = await startTestServer());
  const signed = await signIn(base);
  token = signed.token;
  config.disbursementTimeoutMs = 50; // fast, deterministic test
  config.adminWalletAddress = signed.key.publicKey();
});
after(async () => {
  config.disbursementTimeoutMs = savedTimeout;
  config.adminWalletAddress = savedAdminWallet;
  await close();
});

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function fakeAdapter(
  disburse: OffRampAdapter["disburse"],
  getDisbursementStatus?: OffRampAdapter["getDisbursementStatus"],
): OffRampAdapter {
  return {
    disburse,
    verifyAttestation: async () => true,
    getDisbursementStatus: getDisbursementStatus ?? (async () => ({ success: true, partner_reference: "r", disbursed_at: new Date().toISOString() })),
    getExchangeRate: async (local_currency: string): Promise<ExchangeRate> => ({
      local_currency,
      local_per_usd: 1000,
      quoted_at: new Date().toISOString(),
    }),
    fetchRemittanceHistory: async () => [],
  };
}

async function setUpLoan(suffix: string) {
  await call("POST", "/vaults/deposit", { amount_usd: 5000, tx_hash: `seed-${suffix}` });
  const beneficiary = await (await call("POST", "/beneficiaries", {
    phone_number: `+234801000${suffix}`,
    local_kyc_ref: `PARTNER-NG-TIMEOUT-${suffix}`,
    local_currency: "NGN",
  })).json();
  return beneficiary;
}

test("a disbursement that never responds leaves the loan and its collateral in place, flagged unknown", async () => {
  loanService.setOffRampAdapter(fakeAdapter(() => new Promise(() => {}))); // never resolves
  const beneficiary = await setUpLoan("1");

  const before_ = await (await call("GET", "/vaults/me")).json();

  const res = await call("POST", "/loans", {
    beneficiary_id: beneficiary.id,
    principal_local: 100_000,
    local_currency: "NGN",
    installment_count: 4,
    installment_interval_days: 30,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /unknown/i);

  // The loan exists -- it is not silently discarded -- but it's also not
  // reachable through the normal list (origination never returned it to
  // the caller), so look for it via the audit trail instead.
  const { events } = queryAuditEvents({ eventType: "LOAN" });
  const unknownEvents = events.filter((e) => e.action === "LOAN_DISBURSEMENT_UNKNOWN");
  assert.equal(unknownEvents.length, 1);

  // The loan is explicitly in the unknown disbursement state
  const pending = loanService.loansWithUnknownDisbursement();
  const unknownLoan = pending.find((l) => l.beneficiaryId === beneficiary.id);
  assert.ok(unknownLoan, "loan is tracked in unknown disbursement state");
  assert.equal(unknownLoan?.disbursementStatus, "unknown");

  // 100,000 NGN at 1,000/USD = 100 USD principal. Registering seeds some
  // remittance history via the mock adapter, so the qualified LTV isn't
  // necessarily the bare base rate -- read it rather than assume it.
  const reputation = await (await call("GET", `/beneficiaries/${beneficiary.id}/reputation`)).json();
  const expectedCollateral = Math.round(100 * reputation.qualified_ltv * 100) / 100;

  const after_ = await (await call("GET", "/vaults/me")).json();
  assert.equal(
    after_.locked_amount,
    before_.locked_amount + expectedCollateral,
    "collateral stays locked, not released",
  );
});

test("a disbursement that fails cleanly and quickly still rolls back as before", async () => {
  loanService.setOffRampAdapter(fakeAdapter(async () => { throw new Error("partner rejected: insufficient funds"); }));
  const beneficiary = await setUpLoan("2");

  const before_ = await (await call("GET", "/vaults/me")).json();

  const res = await call("POST", "/loans", {
    beneficiary_id: beneficiary.id,
    principal_local: 100_000,
    local_currency: "NGN",
    installment_count: 4,
    installment_interval_days: 30,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Disbursement failed/);
  assert.doesNotMatch(body.error, /unknown/i);

  const after_ = await (await call("GET", "/vaults/me")).json();
  assert.equal(after_.locked_amount, before_.locked_amount, "collateral released back, as before this change");
});

test("an unknown disbursement can be reconciled as successful via partner status check", async () => {
  loanService.setOffRampAdapter(fakeAdapter(
    () => new Promise(() => {}),
    async () => ({ success: true, partner_reference: "RECONCILED-REF-1", disbursed_at: new Date().toISOString() }),
  ));
  const beneficiary = await setUpLoan("3");

  const before_ = await (await call("GET", "/vaults/me")).json();

  const res = await call("POST", "/loans", {
    beneficiary_id: beneficiary.id,
    principal_local: 100_000,
    local_currency: "NGN",
    installment_count: 4,
    installment_interval_days: 30,
  });
  assert.equal(res.status, 400);

  const pending = loanService.loansWithUnknownDisbursement();
  const loanToReconcile = pending.find((l) => l.beneficiaryId === beneficiary.id);
  assert.ok(loanToReconcile);

  // Operator triggers reconciliation via admin endpoint
  const reconcileRes = await call("POST", `/admin/loans/${loanToReconcile.id}/reconcile`);
  assert.equal(reconcileRes.status, 200);
  const reconData = await reconcileRes.json();
  assert.equal(reconData.outcome, "disbursed");
  assert.equal(reconData.partnerReference, "RECONCILED-REF-1");

  // Collateral remains locked backing the now-disbursed loan
  const after_ = await (await call("GET", "/vaults/me")).json();
  assert.ok(after_.locked_amount > before_.locked_amount);

  // Audit trail records the reconciliation
  const { events } = queryAuditEvents({ eventType: "LOAN" });
  const reconciledEvents = events.filter((e) => e.action === "LOAN_DISBURSEMENT_RECONCILED" && e.entityId === loanToReconcile.id);
  assert.equal(reconciledEvents.length, 1);
  assert.equal((reconciledEvents[0].details as any).outcome, "disbursed");
});

test("an unknown disbursement can be reconciled as failed and unwinds collateral", async () => {
  loanService.setOffRampAdapter(fakeAdapter(
    () => new Promise(() => {}),
    async () => ({ success: false, partner_reference: "REF-FAILED", failure_reason: "partner payout rejected", disbursed_at: new Date().toISOString() }),
  ));
  const beneficiary = await setUpLoan("4");

  const before_ = await (await call("GET", "/vaults/me")).json();

  const res = await call("POST", "/loans", {
    beneficiary_id: beneficiary.id,
    principal_local: 100_000,
    local_currency: "NGN",
    installment_count: 4,
    installment_interval_days: 30,
  });
  assert.equal(res.status, 400);

  const pending = loanService.loansWithUnknownDisbursement();
  const loanToReconcile = pending.find((l) => l.beneficiaryId === beneficiary.id);
  assert.ok(loanToReconcile);

  // Operator triggers reconciliation with partner confirming failure
  const reconcileRes = await call("POST", `/admin/loans/${loanToReconcile.id}/reconcile`);
  assert.equal(reconcileRes.status, 200);
  const reconData = await reconcileRes.json();
  assert.equal(reconData.outcome, "unwound");

  // Collateral is now released back to the vault
  const after_ = await (await call("GET", "/vaults/me")).json();
  assert.equal(after_.locked_amount, before_.locked_amount, "collateral unwound back to pre-origination state");

  // Audit trail records the unwinding
  const { events } = queryAuditEvents({ eventType: "LOAN" });
  const reconciledEvents = events.filter((e) => e.action === "LOAN_DISBURSEMENT_RECONCILED" && e.entityId === loanToReconcile.id);
  assert.equal(reconciledEvents.length, 1);
  assert.equal((reconciledEvents[0].details as any).outcome, "unwound");
});

test("GET /admin/loans/unknown-disbursements lists loans awaiting reconciliation", async () => {
  const res = await call("GET", "/admin/loans/unknown-disbursements");
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.ok(Array.isArray(list));
});
