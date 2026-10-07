import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// Set before anything imports ../app (and therefore ../config), so this
// test file's config reads the override rather than the permissive default.
process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";

let base = "";
let close: () => Promise<void>;

before(async () => {
  const { startTestServer } = await import("./testing/server");
  ({ base, close } = await startTestServer());
});
after(() => close());

test("an allowed origin receives a matching CORS header", async () => {
  const res = await fetch(`${base}/health`, { headers: { Origin: "https://app.example.com" } });
  assert.equal(res.headers.get("access-control-allow-origin"), "https://app.example.com");
});

test("a disallowed origin receives no CORS header", async () => {
  const res = await fetch(`${base}/health`, { headers: { Origin: "https://evil.example.com" } });
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("a request with no Origin header (server-to-server) is unaffected", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
});

test("helmet security headers are present", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
});
