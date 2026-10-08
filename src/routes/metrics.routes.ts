import { Router, Request, Response } from "express";
import { registry } from "../metrics";

export const metricsRouter = Router();

metricsRouter.get("/", async (_req: Request, res: Response) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});
