/**
 * Waits for every given target to finish, up to timeoutMs, then resolves
 * either way. A shutdown must never hang forever waiting on a connection
 * that never closes or a tick that never settles -- better to exit with
 * timedOut: true than not exit at all.
 *
 * The timer is deliberately NOT unref'd. Its whole job is to fire when a
 * target never settles; an unref'd timer lets Node exit the event loop first
 * whenever nothing else is holding it open, so the promise would simply never
 * resolve -- the exact hang this function exists to prevent. It is cleared as
 * soon as the graceful path wins, so it never outlives the shutdown.
 */
export async function gracefulShutdown(
  targets: Array<() => Promise<void>>,
  timeoutMs: number,
): Promise<{ timedOut: boolean }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<true>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
  });
  const graceful = Promise.all(targets.map((close) => close())).then(() => false as const);

  try {
    const timedOut = await Promise.race([graceful, timeout]);
    return { timedOut };
  } finally {
    clearTimeout(timer);
  }
}
