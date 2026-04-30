import IORedis from "ioredis";
import { env } from "./env.js";

let client: IORedis | null = null;

export function getRedis(): IORedis {
  if (!client) {
    client = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return client;
}
