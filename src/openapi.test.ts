import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "express";
import { routeMounts } from "./app";
import { openApiDocument } from "./openapi";

/** Express's own `:id` path-param syntax, in OpenAPI's `{id}` form. */
function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

/** Every method+path actually registered on a router, in Express's own syntax. */
function routesOf(router: Router): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  for (const layer of (router as any).stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        if (layer.route.methods[method]) {
          routes.push({ method: method.toUpperCase(), path: layer.route.path });
        }
      }
    }
  }
  return routes;
}

function realRoutes(): Set<string> {
  const all = new Set<string>();
  for (const { prefix, router } of routeMounts) {
    for (const { method, path } of routesOf(router)) {
      const full = (prefix + path).replace(/\/$/, "") || "/";
      all.add(`${method} ${toOpenApiPath(full)}`);
    }
  }
  return all;
}

test("every path the OpenAPI document claims actually exists as a mounted route", () => {
  const real = realRoutes();
  const missing: string[] = [];

  for (const [path, methods] of Object.entries(openApiDocument.paths)) {
    for (const method of Object.keys(methods as object)) {
      // /health is mounted with no /api/v1 prefix; the document's paths are
      // relative to the `servers` entry, which already names /api/v1.
      const full = path === "/health" ? path : `/api/v1${path}`;
      const key = `${method.toUpperCase()} ${full}`;
      if (!real.has(key)) missing.push(key);
    }
  }

  assert.deepEqual(missing, [], "the OpenAPI document documents a path/method that isn't actually mounted");
});

test("the document is structurally a plausible OpenAPI 3 document", () => {
  assert.match(openApiDocument.openapi, /^3\./);
  assert.ok(openApiDocument.info?.title);
  assert.ok(Object.keys(openApiDocument.paths).length > 10, "covers a meaningful slice of the API");
  for (const [path, methods] of Object.entries(openApiDocument.paths)) {
    assert.ok(path.startsWith("/"), `${path} should start with /`);
    assert.ok(Object.keys(methods as object).length > 0, `${path} declares no methods`);
  }
});
