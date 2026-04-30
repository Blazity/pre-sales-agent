type Level = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  ts: string;
  level: Level;
  message: string;
  [key: string]: unknown;
}

function log(level: Level, message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(data ?? {}),
  };
  const output = JSON.stringify(entry);
  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  info:  (msg: string, data?: Record<string, unknown>) => log("info",  msg, data),
  warn:  (msg: string, data?: Record<string, unknown>) => log("warn",  msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),

  /** Returns a child logger that merges fixed context into every log line. */
  withContext(ctx: Record<string, unknown>) {
    return {
      info:  (msg: string, data?: Record<string, unknown>) => log("info",  msg, { ...ctx, ...data }),
      warn:  (msg: string, data?: Record<string, unknown>) => log("warn",  msg, { ...ctx, ...data }),
      error: (msg: string, data?: Record<string, unknown>) => log("error", msg, { ...ctx, ...data }),
      debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, { ...ctx, ...data }),
    };
  },

  /** Logs the start of an operation and returns a function to log its end with elapsed ms. */
  startTimer(label: string, ctx?: Record<string, unknown>) {
    const start = Date.now();
    log("info", `${label} started`, ctx);
    return {
      end(extraData?: Record<string, unknown>) {
        log("info", `${label} completed`, {
          ...ctx,
          ...extraData,
          durationMs: Date.now() - start,
        });
      },
      fail(err: unknown, extraData?: Record<string, unknown>) {
        log("error", `${label} failed`, {
          ...ctx,
          ...extraData,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      },
    };
  },
};

export function logStartupBanner(port: number, env: string) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      message: "estimation-agent starting",
      port,
      env,
      node: process.version,
      pid: process.pid,
    })
  );
}
