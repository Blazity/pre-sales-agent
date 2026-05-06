import type { IncomingMessage, ServerResponse } from "http";
import type { Request, Response } from "express";
import { createSlackApp } from "../../src/slack/bolt-app.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const { receiver } = createSlackApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.headers["x-slack-retry-num"]) {
    res.statusCode = 200;
    res.end();
    return;
  }

  const originalUrl = req.url;
  req.url = "/events";

  receiver.router(req as unknown as Request, res as unknown as Response, (err?: unknown) => {
    req.url = originalUrl;
    if (err) {
      res.statusCode = 500;
      res.end("Slack receiver error");
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
  });
}
