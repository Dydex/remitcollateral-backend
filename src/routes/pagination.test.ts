import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../testing/server";
import { signIn } from "../testing/auth";

let base = "";
let close: () => Promise<void>;
let token = "";

before(async () => {
  ({ base, close } = await startTestServer());
  ({ token } = await signIn(base));
});
after(() => close());

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("GET /beneficiaries pages opt-in, unbounded by default", async () => {
  for (let i = 0; i < 3; i++) {
    const res = await call("POST", "/beneficiaries", {
      phone_number: `+234800000000${i}`,
      local_kyc_ref: `PARTNER-NG-${i}`,
      local_currency: "NGN",
    });
    assert.equal(res.status, 201, await res.text());
  }

  const all = await call("GET", "/beneficiaries");
  assert.equal(all.headers.get("x-total-count"), "3");
  assert.equal((await all.json()).length, 3, "no params means the full, unbounded list");

  const page = await call("GET", "/beneficiaries?limit=2&offset=1");
  assert.equal(page.headers.get("x-total-count"), "3", "total count reflects the full list, not the page");
  assert.equal((await page.json()).length, 2);

  const rest = await call("GET", "/beneficiaries?offset=2");
  assert.equal((await rest.json()).length, 1);
});

test("GET /remittances pages the same way", async () => {
  const beneficiary = await (await call("POST", "/beneficiaries", {
    phone_number: "+15550000999",
    local_kyc_ref: "PARTNER-US-1",
    local_currency: "USD",
  })).json();

  // Registering a beneficiary seeds remittance history from the mock
  // off-ramp adapter, so the baseline for this one beneficiary isn't 0 --
  // read it rather than assume it, to keep this test independent of how
  // much history the mock happens to seed.
  const scoped = `/remittances?beneficiary_id=${beneficiary.id}`;
  const before = await call("GET", scoped);
  const baseline = Number(before.headers.get("x-total-count"));

  for (let i = 0; i < 4; i++) {
    const res = await call("POST", "/remittances", {
      beneficiary_id: beneficiary.id,
      amount_usd: 50,
      local_amount: 50,
      local_currency: "USD",
      sent_at: new Date(Date.now() - i * 1000).toISOString(),
    });
    assert.equal(res.status, 201, await res.text());
  }

  const all = await call("GET", scoped);
  const total = baseline + 4;
  assert.equal(all.headers.get("x-total-count"), String(total));
  assert.equal((await all.json()).length, total, "no params means the full, unbounded list");

  const page = await call("GET", `${scoped}&limit=1`);
  assert.equal(page.headers.get("x-total-count"), String(total), "total count reflects the full list, not the page");
  assert.equal((await page.json()).length, 1);
});
