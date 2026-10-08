import { ContractGateway } from "./gateway.interface";
import { gatewayErrorsTotal } from "../metrics";
import { logger } from "../logging/logger";

const log = logger.child({ component: "contract-gateway" });

async function call<T>(method: string, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    if (result && typeof result === "object" && "success" in result && (result as { success: unknown }).success === false) {
      gatewayErrorsTotal.inc({ method });
      log.warn({ method, result }, "contract gateway call failed");
    }
    return result;
  } catch (err) {
    gatewayErrorsTotal.inc({ method });
    log.error({ method, err }, "contract gateway call threw");
    throw err;
  }
}

/**
 * Wraps a ContractGateway so every failed (success: false) or thrown call
 * increments remitcollateral_contract_gateway_errors_total, labeled by
 * method -- these were previously visible only by reading the audit log.
 */
export function instrumented(gateway: ContractGateway): ContractGateway {
  return {
    depositCollateral: (...args) => call("depositCollateral", () => gateway.depositCollateral(...args)),
    withdrawCollateral: (...args) => call("withdrawCollateral", () => gateway.withdrawCollateral(...args)),
    lockCollateral: (...args) => call("lockCollateral", () => gateway.lockCollateral(...args)),
    releaseCollateral: (...args) => call("releaseCollateral", () => gateway.releaseCollateral(...args)),
    getCollateralPosition: (...args) => call("getCollateralPosition", () => gateway.getCollateralPosition(...args)),
    recordLoan: (...args) => call("recordLoan", () => gateway.recordLoan(...args)),
    recordRepayment: (...args) => call("recordRepayment", () => gateway.recordRepayment(...args)),
    closeLoan: (...args) => call("closeLoan", () => gateway.closeLoan(...args)),
    liquidateCollateral: (...args) => call("liquidateCollateral", () => gateway.liquidateCollateral(...args)),
  };
}
