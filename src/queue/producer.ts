import { Queue } from "bullmq";
import { getRedis } from "../lib/redis.js";
import { type EstimationJob } from "../agents/orchestrator.js";

let queue: Queue<EstimationJob> | null = null;

export function getQueue() {
  if (!queue) {
    queue = new Queue<EstimationJob>("estimations", { connection: getRedis() });
  }
  return queue;
}

/** Enqueue an estimation job in BullMQ and return the generated job ID. */
export async function enqueueEstimation(job: Omit<EstimationJob, "jobId">): Promise<string> {
  const q = getQueue();
  const added = await q.add("run-estimation", {
    ...job,
    jobId: `est_${Date.now()}`,
  }, {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
  });
  return added.id ?? "unknown";
}
