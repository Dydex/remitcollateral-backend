import { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "../config";

/**
 * GET /auth/challenge is unauthenticated by design — anyone can ask for a
 * challenge for any wallet address. Rate limited by IP so one source can't
 * hammer it to exhaust the challenge store or just generate load.
 */
export const authChallengeRateLimit = rateLimit({
  windowMs: config.rateLimits.authChallengeWindowMinutes * 60 * 1000,
  limit: config.rateLimits.authChallengeMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again shortly." },
});

/**
 * POST /repayments/attest is partner-keyed. Rate limited by the presented
 * `x-api-key` (so one partner's volume doesn't throttle another sharing the
 * same egress IP), falling back to IP for requests with no key at all.
 */
export const repaymentAttestRateLimit = rateLimit({
  windowMs: config.rateLimits.repaymentAttestWindowMinutes * 60 * 1000,
  limit: config.rateLimits.repaymentAttestMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const apiKey = req.headers["x-api-key"];
    // An IPv6 fallback key must go through ipKeyGenerator, which normalizes
    // to a /64 subnet -- otherwise a client can bypass the limit just by
    // varying the trailing bits of its address.
    return typeof apiKey === "string" && apiKey ? apiKey : ipKeyGenerator(req.ip || "unknown");
  },
  message: { error: "Too many attestation attempts. Try again shortly." },
});
