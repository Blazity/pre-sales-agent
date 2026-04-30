import type IORedis from "ioredis";
import { logger } from "./logger.js";

type LogLevel = "info" | "warn" | "error" | "debug";
type LogType = "system" | "agent_text" | "tool_call" | "tool_result";

interface JobLogEntry {
  ts: string;
  level: LogLevel;
  type: LogType;
  message: string;
  data?: Record<string, unknown>;
}

const MAX_LOG_ENTRIES = 500;
const TTL_SECONDS = 604800; // 7 days

function redisKey(jobId: string) {
  return `job:${jobId}:logs`;
}

/** Create a structured logger that writes job events to a Redis stream. */
export function createJobLogger(jobId: string, redis: IORedis) {
  async function push(entry: JobLogEntry) {
    logger.info(entry.message, { jobId, type: entry.type, ...entry.data });
    const key = redisKey(jobId);
    await redis.rpush(key, JSON.stringify(entry));
    await redis.ltrim(key, -MAX_LOG_ENTRIES, -1);
    await redis.expire(key, TTL_SECONDS);
  }

  return {
    log: push,

    system(msg: string, data?: Record<string, unknown>) {
      return push({ ts: new Date().toISOString(), level: "info", type: "system", message: msg, data });
    },

    agentText(text: string) {
      return push({
        ts: new Date().toISOString(),
        level: "info",
        type: "agent_text",
        message: text.slice(0, 500),
      });
    },

    toolCall(name: string, args: unknown) {
      const argsStr = typeof args === "string" ? args : JSON.stringify(args);
      return push({
        ts: new Date().toISOString(),
        level: "info",
        type: "tool_call",
        message: `${name}(${argsStr.slice(0, 300)})`,
        data: { tool: name },
      });
    },

    toolResult(name: string, result: string) {
      return push({
        ts: new Date().toISOString(),
        level: "info",
        type: "tool_result",
        message: `${name} → ${result.slice(0, 500)}`,
        data: { tool: name },
      });
    },
  };
}
