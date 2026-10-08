import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

/**
 * Validates req.body against a schema before a route handler runs. On
 * success, req.body is replaced with the parsed (and any schema-transformed,
 * e.g. trimmed/uppercased) value, so the handler can trust its shape. On
 * failure, responds 400 with every field's reason, never reaching the
 * handler.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const error = result.error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; ");
      return res.status(400).json({ error });
    }
    req.body = result.data;
    next();
  };
}
