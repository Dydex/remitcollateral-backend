import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../testing/server";
import { signIn } from "../testing/auth";
import { config } from "../config";

let base = "";
let close: () => Promise<void>;
let token = "";
let loanId = "";
const savedPartnerKey = config.partnerApiKey;

before(async () => {
  ({ base, close } = await startTestServer());
  ({ token } = await signIn(base));
  config.partnerApiKey = "idempotency-test-partner-key";

  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${base}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  await call("POST", "/vaults/deposit", { amount_usd: 5000, tx_hash: "seed" });
  const beneficiary = await (await call("POST", "/beneficiaries", {
    phone_number: "+2348011110000",
    local_kyc_ref: "PARTNER-NG-IDEMPOTENCY",
    local_currency: "NGN",
  })).json();
  const loan = await (await call("POST", "/loans", {
    beneficiary_id: beneficiary.id,
    principal_local: 400000,
    local_currency: "NGN",
    installment_count: 4,
    installment_interval_days: 30,
  })).json();
  loanId = loan.id;
});
after(async () => {
  config.partnerApiKey = savedPartnerKey;
  await close();
});

const attest = (installmentNumber: number, amountLocal: number, amountUsd: number) =>
  fetch(`${base}/api/v1/repayments/attest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.partnerApiKey },
    body: JSON.stringify({
      loanId,
      installmentNumber,
      amountLocal,
      amountUsd,
      partnerSignature: "partner-signature",
    }),
  });

const get = (path: string) =>
  fetch(`${base}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());

test("attesting the same installment twice has the same effect as once", async () => {
  const first = await attest(1, 100_000, 63.29);
  assert.equal(first.status, 200, await first.clone().text());
  const firstBody = await first.json();

  const afterFirst = await get(`/loans/${loanId}`);
  const releasedAfterFirst = afterFirst.collateral_released_usd;

  // A retry of the exact same attestation -- e.g. the partner never saw our
  // 200 and resent it.
  const second = await attest(1, 100_000, 63.29);
  assert.equal(second.status, 200, await second.clone().text());
  const secondBody = await second.json();

  assert.equal(secondBody.collateralReleased, 0, "nothing new is released on a replay");
  assert.equal(firstBody.loan.id, secondBody.loan.id);

  const afterSecond = await get(`/loans/${loanId}`);
  assert.equal(afterSecond.collateral_released_usd, releasedAfterFirst, "no additional collateral released");

  const repayments = await get(`/loans/${loanId}/repayments`);
  assert.equal(repayments.length, 1, "the duplicate did not create a second attestation record");
});

test("a different installment on the same loan still processes normally", async () => {
  const res = await attest(2, 100_000, 63.29);
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.ok(body.collateralReleased > 0, "a genuinely new installment still releases collateral");

  const repayments = await get(`/loans/${loanId}/repayments`);
  assert.equal(repayments.length, 2, "installments 1 and 2, no duplicates");
});
