import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Request, Response } from "express";
import { validateBody } from "./validate";

function fakeRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = (code: number) => { res.statusCode = code; return res as Response; };
  res.json = (body: unknown) => { res.body = body; return res as Response; };
  return res as Response & { statusCode?: number; body?: unknown };
}

const schema = z.object({ amount_usd: z.number().finite().positive() });

test("valid bodies pass through, with req.body replaced by the parsed value", () => {
  const req = { body: { amount_usd: 10 } } as Request;
  const res = fakeRes();
  let nextCalled = false;
  validateBody(schema)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.body, { amount_usd: 10 });
});

test("an invalid body is rejected with 400 and never reaches next()", () => {
  const req = { body: { amount_usd: "ten" } } as Request;
  const res = fakeRes();
  let nextCalled = false;
  validateBody(schema)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.match((res.body as { error: string }).error, /amount_usd/);
});

test("a type-coercing schema (trim/uppercase) applies its transform before the handler sees it", () => {
  const currencySchema = z.object({
    local_currency: z.string().trim().transform((v) => v.toUpperCase()),
  });
  const req = { body: { local_currency: " ngn " } } as Request;
  const res = fakeRes();
  validateBody(currencySchema)(req, res, () => {});

  assert.deepEqual(req.body, { local_currency: "NGN" });
});
