import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as loanService from "./loan.service";
import { queryAuditEvents } from "./audit.service";
import { beneficiaries, generateId } from "../stores";
import { config } from "../config";
import { OffRampAdapter } from "../adapters/offramp.interface";
import { ChainLoanDraft } from "../types";
import type { ChainLoan } from "../chain/soroban";

const savedTimeout = config.disbursementTimeoutMs;
before(() => { config.disbursementTimeoutMs = 50; });
after(() => { config.disbursementTimeoutMs = savedTimeout; });

function fakeAdapter(disburse: OffRampAdapter["disburse"]): OffRampAdapter {
  return {
    disburse,
    verifyAttestation: async () => true,
    getDisbursementStatus: async () => ({ success: true, partner_reference: "r", disbursed_at: new Date().toISOString() }),
    getExchangeRate: async (local_currency: string) => ({ local_currency, local_per_usd: 1000, quoted_at: new Date().toISOString() }),
    fetchRemittanceHistory: async () => [],
  };
}

function seedBeneficiary(): string {
  const id = generateId();
  beneficiaries.set(id, {
    id,
    phoneNumber: "+2348012340000",
    localKycRef: "CHAIN-DISBURSEMENT-TEST",
    localCurrency: "NGN",
    reputationScore: 0,
    createdAt: new Date().toISOString(),
  });
  return id;
}

function draftFor(beneficiaryId: string): ChainLoanDraft {
  return {
    beneficiaryId,
    principalLocal: 100_000,
    localCurrency: "NGN",
    installmentCount: 4,
    intervalDays: 30,
    fxRate: 1000,
    principalUsd: 100,
    ltvRatio: 1.5,
  };
}

function onChainFor(id: bigint): ChainLoan {
  const now = new Date();
  return {
    id,
    guarantor: "GTEST",
    beneficiaryHandle: "handle",
    partner: "GPARTNER",
    principalUsd: 100,
    ltvBps: 15_000,
    collateralLockedUsd: 150,
    collateralReleasedUsd: 0,
    installmentCount: 4,
    intervalSecs: 30 * 24 * 60 * 60,
    originatedAt: now,
    installmentsPaid: 0,
    totalRepaidUsd: 0,
    nextDue: now,
    graceExpiresAt: null,
    status: "active",
  };
}

test("a chain-path disbursement that never responds is audited as unknown, not failed", async () => {
  loanService.setOffRampAdapter(fakeAdapter(() => new Promise(() => {})));
  const guarantorId = generateId();
  const beneficiaryId = seedBeneficiary();

  await loanService.recordChainLoan(guarantorId, draftFor(beneficiaryId), onChainFor(1001n));

  const { events } = queryAuditEvents({ eventType: "LOAN" });
  const forThisGuarantor = events.filter((e) => e.actor === guarantorId);
  assert.equal(forThisGuarantor.length, 2, "LOAN_ORIGINATED, then the disbursement outcome");
  assert.equal(forThisGuarantor[0].action, "LOAN_DISBURSEMENT_UNKNOWN");
});

test("a chain-path disbursement that fails cleanly is audited as failed, not unknown", async () => {
  loanService.setOffRampAdapter(fakeAdapter(async () => { throw new Error("partner rejected"); }));
  const guarantorId = generateId();
  const beneficiaryId = seedBeneficiary();

  await loanService.recordChainLoan(guarantorId, draftFor(beneficiaryId), onChainFor(1002n));

  const { events } = queryAuditEvents({ eventType: "LOAN" });
  const forThisGuarantor = events.filter((e) => e.actor === guarantorId);
  assert.equal(forThisGuarantor[0].action, "LOAN_DISBURSEMENT_FAILED");
});
