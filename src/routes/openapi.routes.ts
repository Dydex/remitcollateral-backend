import { Router, Request, Response } from "express";
import { openApiDocument } from "../openapi";

export const openApiRouter = Router();

openApiRouter.get("/openapi.json", (_req: Request, res: Response) => {
  res.json(openApiDocument);
});
