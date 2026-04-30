import { QueueClient } from "@vercel/queue";
import { processEstimationJob } from "../../src/queue/worker.js";
import type { EstimationJob } from "../../src/agents/orchestrator.js";
import { logger } from "../../src/lib/logger.js";

const queue = new QueueClient();
const { handleNodeCallback } = queue;

export default handleNodeCallback<EstimationJob>(
  async (message, metadata) => {
    logger.info("Vercel queue message received", {
      messageId: metadata.messageId,
      deliveryCount: metadata.deliveryCount,
      topicName: metadata.topicName,
      region: metadata.region,
      jobId: message.jobId,
    });
    await processEstimationJob(message, "vercel-queue-estimation");
  },
  {
    visibilityTimeoutSeconds: 900,
    retry: (_error, metadata) => ({
      afterSeconds: Math.min(60 * metadata.deliveryCount, 300),
    }),
  },
);
