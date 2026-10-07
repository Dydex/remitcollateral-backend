import app from "./app";
import { config } from "./config";
import { logger } from "./logging/logger";
import { logAuditEvent } from "./services/audit.service";
import { startLifecycleJob, stopLifecycleJob } from "./jobs/lifecycle.job";

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

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  stopLifecycleJob();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default app;
