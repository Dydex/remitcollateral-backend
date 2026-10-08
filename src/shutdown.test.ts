import { test } from "node:test";
import assert from "node:assert/strict";
import { gracefulShutdown } from "./shutdown";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("resolves without timing out once every target finishes", async () => {
  let finished = false;
  const { timedOut } = await gracefulShutdown(
    [() => delay(20).then(() => { finished = true; })],
    1000,
  );
  assert.equal(timedOut, false);
  assert.equal(finished, true, "it actually waited for the target, not just raced past it");
});

test("waits for every target, not just the first to settle", async () => {
  const order: string[] = [];
  const { timedOut } = await gracefulShutdown(
    [
      () => delay(10).then(() => { order.push("fast"); }),
      () => delay(40).then(() => { order.push("slow"); }),
    ],
    1000,
  );
  assert.equal(timedOut, false);
  assert.deepEqual(order, ["fast", "slow"]);
});

test("times out rather than hanging forever on a target that never resolves", async () => {
  const neverResolves = () => new Promise<void>(() => {});
  const { timedOut } = await gracefulShutdown([neverResolves], 30);
  assert.equal(timedOut, true);
});
