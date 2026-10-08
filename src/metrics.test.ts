import { test } from "node:test";
import assert from "node:assert/strict";
import { registry } from "./metrics";
import { loans } from "./stores";
import type { Loan } from "./types";

function fakeLoan(id: string, status: Loan["status"]): Loan {
  return {
    id,
    guarantorId: "g",
    vaultId: "v",
    beneficiaryId: "b",
    principalLocal: 1,
    principalUsd: 1,
    localCurrency: "NGN",
    fxRate: 1,
    ltvRatio: 1.5,
    collateralLockedUsd: 1,
    collateralReleasedUsd: 0,
    collateralForfeitedUsd: 0,
    installmentCount: 1,
    installmentIntervalDays: 30,
    schedule: [],
    status,
    createdAt: "",
    updatedAt: "",
  };
}

test("GET /metrics exposes the custom counters and a per-status loan gauge", async () => {
  loans.set("m1", fakeLoan("m1", "active"));
  loans.set("m2", fakeLoan("m2", "active"));
  loans.set("m3", fakeLoan("m3", "defaulted"));

  const text = await registry.metrics();

  assert.match(text, /remitcollateral_sweep_runs_total/);
  assert.match(text, /remitcollateral_contract_gateway_errors_total/);
  assert.match(text, /remitcollateral_loans_by_status\{status="active"\} 2/);
  assert.match(text, /remitcollateral_loans_by_status\{status="defaulted"\} 1/);
  assert.match(text, /remitcollateral_loans_by_status\{status="grace"\} 0/);

  loans.delete("m1");
  loans.delete("m2");
  loans.delete("m3");
});
