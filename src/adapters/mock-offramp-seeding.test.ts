import { test } from "node:test";
import assert from "node:assert/strict";
import { MockOffRampAdapter } from "./mock-offramp.adapter";
import { config } from "../config";

const adapter = new MockOffRampAdapter();
const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

test("by default the mock partner reports no remittance history at all", async () => {
  const saved = config.mockPartnerSeedHistory;
  try {
    config.mockPartnerSeedHistory = false;
    const history = await adapter.fetchRemittanceHistory("GWALLET", "+2348000000000", since);
    assert.deepEqual(history, [], "fabricated history lowers the collateral the protocol demands");
  } finally {
    config.mockPartnerSeedHistory = saved;
  }
});

test("seed data is available, but only when explicitly turned on", async () => {
  const saved = config.mockPartnerSeedHistory;
  try {
    config.mockPartnerSeedHistory = true;
    const history = await adapter.fetchRemittanceHistory("GWALLET", "+2348000000000", since);
    assert.ok(history.length > 0, "the demo seed path still works when asked for");
    for (const record of history) {
      assert.ok(record.amount_usd > 0);
      assert.ok(record.local_currency.length === 3);
      assert.ok(new Date(record.sent_at).getTime() <= Date.now(), "seeded history is never future-dated");
    }
  } finally {
    config.mockPartnerSeedHistory = saved;
  }
});
