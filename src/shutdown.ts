/**
 * Waits for every given target to finish, up to timeoutMs, then resolves
 * either way. A shutdown must never hang forever waiting on a connection
 * that never closes or a tick that never settles -- better to exit with
 * timedOut: true than not exit at all.
 */
export async function gracefulShutdown(
  targets: Array<() => Promise<void>>,
  timeoutMs: number,
): Promise<{ timedOut: boolean }> {
  const graceful = Promise.all(targets.map((close) => close())).then(() => false as const);
  const timeout = new Promise<true>((resolve) => {
    const timer = setTimeout(() => resolve(true), timeoutMs);
    timer.unref?.();
  });

  const timedOut = await Promise.race([graceful, timeout]);
  return { timedOut };
}
