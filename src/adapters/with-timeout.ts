/**
 * Distinguishes "the partner told us it failed" from "we don't know what
 * happened" -- a disbursement call that never responds is not the same
 * failure mode as one that responds with a clear rejection, and treating
 * them the same is what makes it unsafe to roll back blindly: the partner
 * may have already paid the beneficiary by the time this fires.
 */
export class DisbursementTimeoutError extends Error {
  constructor(message = "Disbursement did not respond in time") {
    super(message);
    this.name = "DisbursementTimeoutError";
  }
}

/** Races a promise against a timeout, throwing DisbursementTimeoutError if the timer wins first. */
export function withDisbursementTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DisbursementTimeoutError(`Disbursement did not respond within ${timeoutMs}ms`)),
      timeoutMs,
    );

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
