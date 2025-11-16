import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";

declare module "express-serve-static-core" {
  interface Request {
    rawBody?: Buffer;
  }
}

const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (!secret) {
  throw new Error("GITHUB_WEBHOOK_SECRET is required");
}

export const rawBodySaver = (
  req: Request,
  res: Response,
  buf: Buffer,
  encoding: BufferEncoding,
): void => {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
};

export const verifyWebhook = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const signature = req.headers["x-hub-signature-256"];

  if (!signature || typeof signature !== "string") {
    res.status(400).send("Invalid or missing signature");
    return;
  }

  if (!req.rawBody) {
    res.status(400).send("Missing raw body");
    return;
  }

  const expectedSignature = `sha256=${createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("hex")}`;

  const valid =
    signature.length === expectedSignature.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!valid) {
    res.status(401).send("Unauthorized");
    return;
  }

  next();
};
