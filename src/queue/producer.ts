import { Queue } from "bullmq";
import { send } from "@vercel/queue";
import { getRedis } from "../lib/redis.js";
import { type EstimationJob } from "../agents/orchestrator.js";

let queue: Queue<EstimationJob> | null = null;
export type QueueProvider = "vercel" | "bullmq";

export const ESTIMATION_QUEUE_TOPIC = process.env.VERCEL_QUEUE_TOPIC ?? "estimations";

export function getQueue() {
  if (!queue) {
    queue = new Queue<EstimationJob>("estimations", { connection: getRedis() });
  }
  return queue;
}

export function resolveQueueProvider(env: NodeJS.ProcessEnv = process.env): QueueProvider {
  const configured = env.JOB_QUEUE_PROVIDER;
  if (configured === "vercel" || configured === "bullmq") return configured;
  return env.VERCEL ? "vercel" : "bullmq";
}

export function generateJobId(now = Date.now()): string {
  return `est_${now}`;
}

export function buildJobPayload(job: Omit<EstimationJob, "jobId">, now = Date.now()): EstimationJob {
  return {
    ...job,
    jobId: generateJobId(now),
  };
}

/** Enqueue an estimation job and return the queue provider's message/job ID. */
export async function enqueueEstimation(job: Omit<EstimationJob, "jobId">): Promise<string> {
  const payload = buildJobPayload(job);
  const provider = resolveQueueProvider();

  if (provider === "vercel") {
    const { messageId } = await send(ESTIMATION_QUEUE_TOPIC, payload, {
      idempotencyKey: payload.jobId,
    });
    return messageId ?? payload.jobId;
  }

  const q = getQueue();
  const added = await q.add("run-estimation", payload, {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
  });
  return added.id ?? "unknown";
}
