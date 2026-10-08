import { test } from "node:test";
import assert from "node:assert/strict";
import { withDisbursementTimeout, DisbursementTimeoutError } from "./with-timeout";

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

test("resolves with the underlying value when it settles before the timeout", async () => {
  const result = await withDisbursementTimeout(delay(10, "ok"), 1000);
  assert.equal(result, "ok");
});

test("a promise that never settles times out as DisbursementTimeoutError", async () => {
  const neverResolves = new Promise<void>(() => {});
  await assert.rejects(
    () => withDisbursementTimeout(neverResolves, 30),
    (err: unknown) => err instanceof DisbursementTimeoutError,
  );
});

test("a promise that rejects on its own, before the timeout, rejects with its own error", async () => {
  const rejectsFast = Promise.reject(new Error("partner said no"));
  await assert.rejects(
    () => withDisbursementTimeout(rejectsFast, 1000),
    (err: unknown) => err instanceof Error && err.message === "partner said no" && !(err instanceof DisbursementTimeoutError),
  );
});
