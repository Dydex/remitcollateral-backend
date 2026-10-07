import pino from "pino";

/**
 * LOG_LEVEL overrides this. Defaults to silent during tests, so `npm test`
 * output stays readable, and to info otherwise. This replaces the old
 * approach of hand-checking `NODE_ENV === "test"` at each call site.
 */
const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info");

export const logger = pino({ level });
