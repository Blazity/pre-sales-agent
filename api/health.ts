import type { IncomingMessage, ServerResponse } from "http";

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  res.statusCode = 200;
  res.end(JSON.stringify({
    status: "ok",
    runtime: "vercel",
    queueProvider: process.env.JOB_QUEUE_PROVIDER ?? (process.env.VERCEL ? "vercel" : "bullmq"),
  }));
}
