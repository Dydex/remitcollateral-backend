import { Router, Request, Response } from "express";
import { adminAuth } from "../middleware/auth.middleware";
import { sweepLoanLifecycle } from "../services/liquidation.service";
import { logAuditEvent } from "../services/audit.service";
import * as loanService from "../services/loan.service";

export const adminRouter = Router();

/**
 * POST /admin/liquidation/review
 *
 * Runs the §7.3 lifecycle sweep on demand. §2 lists "triggers liquidation
 * reviews" as an admin capability: the scheduled job in src/jobs runs the
 * same sweep on an interval, and this lets an operator run it immediately
 * rather than waiting for the next tick.
 *
 * The sweep is idempotent with respect to loans that need no action, so
 * running a review out of band is safe.
 */
adminRouter.post("/liquidation/review", adminAuth, async (req: Request, res: Response) => {
  const actor = (req as any).walletAddress as string;

  try {
    const result = await sweepLoanLifecycle();

    logAuditEvent({
      eventType: "SYSTEM",
      action: "LIQUIDATION_REVIEW_TRIGGERED",
      actor,
      details: result,
    });

    return res.json({
      message: "Liquidation review completed",
      ...result,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /admin/loans/unknown-disbursements
 *
 * Lists loans whose disbursement outcome is currently unknown.
 */
adminRouter.get("/loans/unknown-disbursements", adminAuth, (_req: Request, res: Response) => {
  return res.json(loanService.loansWithUnknownDisbursement());
});

/**
 * POST /admin/loans/:id/reconcile
 *
 * Reconciles a loan stuck in an unknown disbursement outcome:
 * either by polling the partner adapter for status, or by applying
 * an operator's manual resolution.
 */
adminRouter.post("/loans/:id/reconcile", adminAuth, async (req: Request, res: Response) => {
  const actor = (req as any).walletAddress as string;
  const { success, partner_reference, failure_reason } = req.body ?? {};

  const resolution = typeof success === "boolean"
    ? { success, partnerReference: partner_reference, failureReason: failure_reason }
    : undefined;

  try {
    const result = await loanService.reconcileDisbursement(req.params.id, resolution, actor);
    return res.json(result);
  } catch (err) {
    const message = (err as Error).message;
    const status = message.includes("not found") ? 404 : 400;
    return res.status(status).json({ error: message });
  }
});

