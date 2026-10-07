/**
 * Slices a list for `limit`/`offset` query params, matching the pattern
 * already used by GET /audit. Unlike /audit, these callers' response body
 * is a plain array per the frontend's declared shape (lib/types.ts), not an
 * envelope — so when neither param is given, the full list comes back
 * exactly as before. Pagination is opt-in, never a default that could
 * silently truncate what an existing caller expects to see.
 */
export function paginate<T>(items: T[], query: { limit?: unknown; offset?: unknown }): T[] {
  if (query.limit === undefined && query.offset === undefined) {
    return items;
  }

  const offset = Math.max(0, parseInt(String(query.offset ?? "0"), 10) || 0);
  const parsedLimit = parseInt(String(query.limit ?? ""), 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : items.length;

  return items.slice(offset, offset + limit);
}
