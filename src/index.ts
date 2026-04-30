import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { logger, logStartupBanner } from "./lib/logger.js";

// Prevent unhandled promise rejections from crashing the process.
// The Slack Bolt App constructor fires an async auth.test() call that rejects
// if SLACK_BOT_TOKEN is invalid — without this handler the process dies silently.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { error: String(reason) });
});

let shuttingDown = false;

async function main() {
  // ── Step 1: Validate env vars ─────────────────────────────────────────────
  // Do this first so deployment logs show a clear error if any var
  // is missing, rather than a cryptic module-load failure.
  let env: typeof import("./lib/env.js")["env"];
  try {
    ({ env } = await import("./lib/env.js"));
  } catch (err) {
    // Log as plain JSON so hosted runtimes surface it clearly.
    process.stderr.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        message: "STARTUP FAILED — missing required environment variable",
        detail: String(err),
      }) + "\n"
    );
    process.exit(1);
  }

  // ── Step 2: Start HTTP server immediately ─────────────────────────────────
  // Health checks hit /health in the Express fallback runtime; keep it available ASAP.
  // We bind the port BEFORE initialising Slack or Redis so the container is
  // considered healthy even if those take a few seconds to connect.
  const httpServer = express();
  httpServer.set("trust proxy", 2);
  httpServer.use(helmet());
  httpServer.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req) => req.path === "/health" || req.path.startsWith("/slack") || req.path.startsWith("/admin"),
  }));

  // Returns 503 during shutdown so the runtime stops routing traffic to the old process.
  httpServer.get("/health", (_req, res) => {
    if (shuttingDown) {
      res.status(503).json({ status: "shutting_down" });
      return;
    }
    res.json({ status: "ok" });
  });

  // express.json() must NOT run on /slack/* — Bolt needs the raw body
  // to verify Slack's request signature and respond to the challenge handshake.
  httpServer.use((req, res, next) => {
    if (req.path.startsWith("/slack")) return next();
    express.json({ limit: "2mb" })(req, res, next);
  });

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = httpServer.listen(env.PORT, () => {
      logStartupBanner(env.PORT, env.NODE_ENV);
      resolve(s);
    });
  });

  // ── Step 3: Initialise Slack Bolt ─────────────────────────────────────────
  try {
    const { createSlackApp, validateSlackToken } = await import("./slack/bolt-app.js");

    // Validate the bot token BEFORE creating the Bolt app. This call logs a
    // clear success/failure message so deployment logs show whether
    // the token is valid. Without a valid token Bolt silently drops all events.
    const authResult = await validateSlackToken();
    if (!authResult) {
      logger.error("SLACK BOT WILL NOT RESPOND — fix SLACK_BOT_TOKEN and redeploy");
    }

    const { receiver } = createSlackApp();

    // Log every Slack request for production debugging.
    httpServer.use("/slack", (req, res, next) => {
      const start = Date.now();
      res.on("finish", () => {
        logger.info("Slack HTTP request", {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Date.now() - start,
        });
      });
      next();
    });

    httpServer.use("/slack", receiver.router);
    logger.info("Slack Bolt initialised", authResult ? { botUserId: authResult.botUserId } : {});
  } catch (err) {
    logger.error("Slack Bolt failed to initialise — Slack features unavailable", {
      error: String(err),
    });
  }

  // ── Step 3.5: Mount admin panel (opt-in) ──────────────────────────────────
  if (env.ADMIN_USER) {
    const { mountAdmin } = await import("./admin/routes.js");
    mountAdmin(httpServer);
    logger.info("Admin panel mounted at /admin");
  } else {
    logger.info("Admin panel disabled (ADMIN_USER not set)");
  }

  // ── Step 4: Start BullMQ worker ───────────────────────────────────────────
  // Wrapped in try/catch so a Redis connection failure doesn't kill the process.
  let worker: Awaited<ReturnType<typeof import("./queue/worker.js")["startWorker"]>> | null = null;
  try {
    const { startWorker } = await import("./queue/worker.js");
    worker = startWorker();
    logger.info("BullMQ worker started");
  } catch (err) {
    logger.error("BullMQ worker failed to start — job processing unavailable", {
      error: String(err),
    });
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  process.on("SIGTERM", async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("SIGTERM received — draining in-flight jobs before exit");

    server.close();
    if (worker) {
      const timeout = setTimeout(() => {
        logger.warn("Drain timeout — forcing exit");
        process.exit(1);
      }, 24 * 60 * 1000);
      await worker.close();
      clearTimeout(timeout);
    }
    logger.info("Drain complete, exiting");
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      message: "Fatal unhandled error during startup",
      error: String(err),
    }) + "\n"
  );
  process.exit(1);
});
