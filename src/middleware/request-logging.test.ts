import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../testing/server";

let base = "";
let close: () => Promise<void>;
before(async () => ({ base, close } = await startTestServer()));
after(() => close());

test("every response carries a request ID", async () => {
  const res = await fetch(`${base}/health`);
  const id = res.headers.get("x-request-id");
  assert.ok(id, "expected an x-request-id header");
  assert.match(id!, /^[0-9a-f-]{36}$/i);
});

test("each request gets its own request ID", async () => {
  const [a, b] = await Promise.all([fetch(`${base}/health`), fetch(`${base}/health`)]);
  const idA = a.headers.get("x-request-id");
  const idB = b.headers.get("x-request-id");
  assert.ok(idA && idB);
  assert.notEqual(idA, idB);
});
