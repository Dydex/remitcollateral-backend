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

test("still times out when nothing else is keeping the event loop alive", async () => {
  // In-process, the test runner's own handles keep the loop open, which is
  // what hid an unref'd timer here: the suite passed locally and was
  // cancelled in CI ("Promise resolution is still pending but the event
  // loop has already resolved"). A child process has nothing else holding
  // the loop, so it reproduces the real condition.
  const { execFile } = await import("node:child_process");
  const script = `
    import("./src/shutdown.ts").then(async (m) => {
      const r = await m.gracefulShutdown([() => new Promise(() => {})], 50);
      console.log(JSON.stringify(r));
    });
  `;
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", "-e", script],
      { cwd: process.cwd(), timeout: 15_000 },
      (err, out) => (err ? reject(err) : resolve(out)),
    );
  });
  assert.deepEqual(JSON.parse(stdout.trim()), { timedOut: true });
});
