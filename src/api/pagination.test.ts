import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate } from "./pagination";

const items = [0, 1, 2, 3, 4];

test("with neither param, the full list comes back unchanged", () => {
  assert.deepEqual(paginate(items, {}), items);
});

test("limit alone caps the list from the start", () => {
  assert.deepEqual(paginate(items, { limit: "2" }), [0, 1]);
});

test("offset alone skips from the start, to the end", () => {
  assert.deepEqual(paginate(items, { offset: "3" }), [3, 4]);
});

test("limit and offset together page through the list", () => {
  assert.deepEqual(paginate(items, { limit: "2", offset: "2" }), [2, 3]);
});

test("an offset past the end returns an empty list, not an error", () => {
  assert.deepEqual(paginate(items, { offset: "100" }), []);
});

test("a negative or non-numeric offset is treated as zero", () => {
  assert.deepEqual(paginate(items, { offset: "-5" }), items);
  assert.deepEqual(paginate(items, { offset: "not-a-number" }), items);
});

test("a negative or non-numeric limit is ignored, returning everything from the offset", () => {
  assert.deepEqual(paginate(items, { limit: "-1", offset: "1" }), [1, 2, 3, 4]);
  assert.deepEqual(paginate(items, { limit: "not-a-number", offset: "1" }), [1, 2, 3, 4]);
});
