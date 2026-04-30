import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEstimationWorkflowPayload, createEstimationWorkflowStarter } from "./launcher.js";

describe("estimation workflow launcher", () => {
  it("adds a jobId when missing", () => {
    const payload = buildEstimationWorkflowPayload({
      channelId: "C123",
      threadTs: "1710000000.000100",
      rfpText: "Build a customer portal with billing and reporting.",
    }, 1710000000000);

    assert.equal(payload.jobId, "est_1710000000000");
    assert.equal(payload.channelId, "C123");
  });

  it("preserves an existing jobId", () => {
    const payload = buildEstimationWorkflowPayload({
      jobId: "est_existing",
      channelId: "C123",
      threadTs: "1710000000.000100",
      rfpText: "Build a customer portal with billing and reporting.",
    });

    assert.equal(payload.jobId, "est_existing");
  });

  it("returns jobId and runId from the workflow starter", async () => {
    const started: unknown[] = [];
    const startWorkflow = createEstimationWorkflowStarter(async (_workflow, args) => {
      started.push(args);
      return { runId: "wrun_test" };
    });

    const result = await startWorkflow({
      channelId: "C123",
      threadTs: "1710000000.000100",
      rfpText: "Build a customer portal with billing and reporting.",
    }, 1710000000000);

    assert.deepEqual(result, { jobId: "est_1710000000000", runId: "wrun_test" });
    assert.equal(started.length, 1);
  });
});
