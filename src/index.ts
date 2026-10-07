import app from "./app";
import { config } from "./config";
import { logger } from "./logging/logger";
import { logAuditEvent } from "./services/audit.service";
import { startLifecycleJob, stopLifecycleJob, waitForCurrentTick } from "./jobs/lifecycle.job";
import { gracefulShutdown } from "./shutdown";

// ─── Start Server ────────────────────────────────────────────────────

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      network: config.stellarNetwork,
      healthUrl: `http://localhost:${config.port}/health`,
      apiUrl: `http://localhost:${config.port}/api/v1`,
    },
    "RemitCollateral Backend started",
  );

  logAuditEvent({
    eventType: "SYSTEM",
    action: "SERVER_START",
    details: {
      port: config.port,
      network: config.stellarNetwork,
      adapter: "MockOffRampAdapter",
      contractGateway: "MockContractGateway",
    },
  });

  // §7.3 — overdue installments, grace expiry and default are detected on
  // the backend's own clock, so the sweep has to be running for the loan
  // lifecycle to advance at all.
  startLifecycleJob();
});

// ─── Shutdown ────────────────────────────────────────────────────────

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "shutting down");
  // Stop scheduling new ticks immediately; a tick already in progress is
  // waited for below rather than interrupted mid-sweep.
  stopLifecycleJob();

  gracefulShutdown(
    [
      () => new Promise<void>((resolve) => server.close(() => resolve())),
      waitForCurrentTick,
    ],
    config.shutdownTimeoutMs,
  ).then(({ timedOut }) => {
    logger.info(
      { signal, timedOut },
      timedOut ? "shutdown timed out waiting for in-flight work, forcing exit" : "shutdown complete",
    );
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default app;
