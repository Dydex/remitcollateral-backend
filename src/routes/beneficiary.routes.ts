import { Router, Request, Response } from "express";
import { z } from "zod";
import { walletAuth } from "../middleware/auth.middleware";
import { beneficiaries } from "../stores";
import { logAuditEvent } from "../services/audit.service";
import { getReputationBreakdown } from "../services/reputation.service";
import { seedRemittanceHistory } from "../services/remittance.service";
import {
  BeneficiaryConflict,
  addBeneficiary,
  beneficiariesOf,
  linkOf,
} from "../services/beneficiary.service";
import { serializeBeneficiary, serializeReputation } from "../api/serializers";
import { paginate } from "../api/pagination";
import { validateBody } from "../api/validate";

export const beneficiaryRouter = Router();

const createBeneficiarySchema = z.object({
  phone_number: z.string().trim().min(1),
  local_kyc_ref: z.string().trim().min(1),
  local_currency: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3}$/, "must be an ISO 4217 code, e.g. NGN")),
  display_name: z.string().trim().min(1).optional(),
});

/** The beneficiary, only if the guarantor supports them. Otherwise not found. */
function ownBeneficiary(req: Request) {
  const guarantorId = (req as any).guarantorId as string | undefined;
  const link = guarantorId ? linkOf(guarantorId, req.params.id) : undefined;
  const beneficiary = link ? beneficiaries.get(link.beneficiaryId) : undefined;
  return beneficiary && link ? { beneficiary, link } : null;
}

/**
 * GET /beneficiaries — The beneficiaries the guarantor supports.
 */
beneficiaryRouter.get("/", walletAuth, (req: Request, res: Response) => {
  const guarantorId = (req as any).guarantorId as string | undefined;
  if (!guarantorId) {
    return res.status(404).json({ error: "Guarantor not found. Register first." });
  }
  const all = beneficiariesOf(guarantorId);
  res.set("X-Total-Count", String(all.length));
  return res.json(
    paginate(all, req.query).map(({ beneficiary, link }) => serializeBeneficiary(beneficiary, link)),
  );
});

/**
 * POST /beneficiaries — Add a beneficiary to the guarantor's list.
 *   { phone_number, local_kyc_ref, local_currency, display_name? }
 *
 * Someone another guarantor already supports is linked, not duplicated, when
 * the phone number and partner KYC reference both match.
 */
beneficiaryRouter.post("/", walletAuth, validateBody(createBeneficiarySchema), async (req: Request, res: Response) => {
  const walletAddress = (req as any).walletAddress as string;
  const guarantorId = (req as any).guarantorId as string | undefined;
  if (!guarantorId) {
    return res.status(404).json({ error: "Guarantor not found. Register first." });
  }

  const { phone_number: phoneNumber, local_kyc_ref: localKycRef, local_currency: localCurrency, display_name: displayName } = req.body;

  let added;
  try {
    added = addBeneficiary(guarantorId, { phoneNumber, localKycRef, localCurrency, displayName });
  } catch (err) {
    // Nothing about an existing beneficiary is returned: they may be supported
    // by other guarantors, whose details are not this caller's to see.
    if (err instanceof BeneficiaryConflict) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  logAuditEvent({
    eventType: "BENEFICIARY",
    action: added.created ? "BENEFICIARY_REGISTERED" : "BENEFICIARY_LINKED",
    actor: walletAddress,
    entityType: "beneficiary",
    entityId: added.beneficiary.id,
    details: { guarantorId },
  });

  // §8.2 — pull whatever history the partner already holds for this pair, so
  // the relationship starts with the cold-start signal rather than at zero.
  await seedRemittanceHistory(guarantorId, walletAddress, added.beneficiary.id, phoneNumber);

  return res
    .status(201)
    .json(serializeBeneficiary(beneficiaries.get(added.beneficiary.id)!, added.link));
});

/**
 * GET /beneficiaries/:id — A beneficiary the guarantor supports.
 */
beneficiaryRouter.get("/:id", walletAuth, (req: Request, res: Response) => {
  const own = ownBeneficiary(req);
  if (!own) {
    return res.status(404).json({ error: "Beneficiary not found" });
  }
  return res.json(serializeBeneficiary(own.beneficiary, own.link));
});

/**
 * GET /beneficiaries/:id/reputation — The breakdown behind their score.
 */
beneficiaryRouter.get("/:id/reputation", walletAuth, (req: Request, res: Response) => {
  const own = ownBeneficiary(req);
  if (!own) {
    return res.status(404).json({ error: "Beneficiary not found" });
  }
  return res.json(serializeReputation(own.beneficiary.id, getReputationBreakdown(own.beneficiary.id)));
});
