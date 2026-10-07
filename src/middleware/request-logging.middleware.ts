import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { logger } from "../logging/logger";

declare global {
  namespace Express {
    interface Request {
      /** A random ID generated per request, carried through its log lines. */
      id: string;
      /** A child logger with `reqId` already attached. */
      log: typeof logger;
    }
  }
}

/**
 * Assigns each request a random ID and a child logger carrying it, then logs
 * one structured line per request once it finishes, with its status and
 * duration. Replaces the old plain console.log line, which ran before the
 * response and carried neither.
 */
export function requestLogging(req: Request, res: Response, next: NextFunction): void {
  req.id = crypto.randomUUID();
  req.log = logger.child({ reqId: req.id });
  res.setHeader("x-request-id", req.id);

  const startedAt = Date.now();
  res.on("finish", () => {
    req.log.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
      "request completed",
    );
  });

  next();
}
