import { Worker, type Job } from "bullmq";
import { runEstimationWorkflow, type EstimationJob } from "../agents/orchestrator.js";
import { logger } from "../lib/logger.js";
import { getRedis } from "../lib/redis.js";
import { alertOps } from "../lib/alerting.js";
import { createJobLogger } from "../lib/job-logger.js";

const PROGRESS_TTL = 604800; // 7 days

function progressKey(jobId: string) {
  return `job:${jobId}:progress`;
}

export async function processEstimationJob(jobData: EstimationJob, name = "run-estimation") {
  const jobId = jobData.jobId || "unknown";
  const log = logger.withContext({ jobId });
  const redis = getRedis();
  const jobLog = createJobLogger(jobId, redis);

  log.info("Processing estimation job", { name });

  const estimationName = (jobData.rfpText ?? jobData.messageText ?? "Untitled").slice(0, 60);

  // Initialize progress hash before orchestrator so admin/status views can see early failures.
  await redis.hset(progressKey(jobId), {
    step: "0",
    stepName: "Initializing",
    status: "running",
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    turnsCompleted: "0",
    channelId: jobData.channelId,
    threadTs: jobData.threadTs,
    estimationName,
  });
  await redis.expire(progressKey(jobId), PROGRESS_TTL);
  await jobLog.system("Job started", { estimationName });

  try {
    await runEstimationWorkflow(jobData);
  } catch (err) {
    await redis.hset(progressKey(jobId), {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    await jobLog.system("Job failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** Start the BullMQ worker that processes estimation jobs. */
export function startWorker() {
  const worker = new Worker<EstimationJob>(
    "estimations",
    async (job: Job<EstimationJob>) => {
      const jobId = job.data.jobId || job.id || "unknown";
      await processEstimationJob({ ...job.data, jobId }, job.name);
    },
    {
      connection: getRedis(),
      concurrency: 3,
      lockDuration: 120_000,
      stalledInterval: 120_000,
      maxStalledCount: 2,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  function logMemory(jobId?: string | null) {
    const mem = process.memoryUsage();
    logger.info("Job memory usage", {
      event: "job_completed_memory",
      jobId,
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heapUsed_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal_mb: Math.round(mem.heapTotal / 1024 / 1024),
    });
  }

  worker.on("completed", (job) => {
    logger.info("Job completed", { jobId: job.id });
    logMemory(job.id);
  });

  worker.on("failed", (job, err) => {
    logger.error("Job failed", { jobId: job?.id, error: String(err) });
    logMemory(job?.id);

    if (job) {
      const jobId = job.data.jobId || job.id || "unknown";
      const redis = getRedis();
      redis.hset(progressKey(jobId), {
        status: "failed",
        finishedAt: new Date().toISOString(),
      }).catch((redisErr) => {
        logger.error("Failed to update progress hash on job failure", { jobId, error: String(redisErr) });
      });
    }

    alertOps("Estimation job failed", { jobId: job?.id, error: String(err) });
  });

  worker.on("error", (err) => {
    logger.error("Worker error", { error: String(err) });
  });

  logger.info("BullMQ worker started");
  return worker;
}
