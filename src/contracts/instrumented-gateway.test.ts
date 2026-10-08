import { test } from "node:test";
import assert from "node:assert/strict";
import { instrumented } from "./instrumented-gateway";
import { gatewayErrorsTotal, registry } from "../metrics";
import { ContractGateway } from "./gateway.interface";

async function countFor(method: string): Promise<number> {
  const metric = await gatewayErrorsTotal.get();
  return metric.values.find((v) => v.labels.method === method)?.value ?? 0;
}

function fakeGateway(overrides: Partial<ContractGateway>): ContractGateway {
  const stub = async () => ({
    success: true,
    txHash: "t",
    contract: "GuarantorVault" as const,
    method: "x",
    ledgerAt: "",
  });
  return {
    depositCollateral: stub,
    withdrawCollateral: stub,
    lockCollateral: stub,
    releaseCollateral: stub,
    getCollateralPosition: async () => ({
      vaultId: "v",
      collateralBalance: 0,
      lockedAmount: 0,
      availableAmount: 0,
      perLoanLocked: {},
    }),
    recordLoan: stub,
    recordRepayment: stub,
    closeLoan: stub,
    liquidateCollateral: stub,
    ...overrides,
  };
}

test("a successful call passes its result through untouched, no error counted", async () => {
  registry.resetMetrics();
  const gateway = instrumented(fakeGateway({}));
  const result = await gateway.lockCollateral("v", "l", 10);
  assert.equal(result.success, true);
  assert.equal(await countFor("lockCollateral"), 0);
});

test("a result with success: false increments the error counter but does not throw", async () => {
  registry.resetMetrics();
  const gateway = instrumented(
    fakeGateway({
      lockCollateral: async () => ({
        success: false,
        txHash: "",
        contract: "GuarantorVault",
        method: "lock_collateral",
        ledgerAt: "",
        failureReason: "insufficient available collateral",
      }),
    }),
  );
  const result = await gateway.lockCollateral("v", "l", 10);
  assert.equal(result.success, false);
  assert.equal(await countFor("lockCollateral"), 1);
});

test("a call that throws increments the error counter and rethrows", async () => {
  registry.resetMetrics();
  const gateway = instrumented(
    fakeGateway({
      releaseCollateral: async () => { throw new Error("network error"); },
    }),
  );
  await assert.rejects(() => gateway.releaseCollateral("v", "l", 10), /network error/);
  assert.equal(await countFor("releaseCollateral"), 1);
});
