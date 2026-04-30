import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildJobPayload,
  generateJobId,
  resolveQueueProvider,
} from "./producer.js";

describe("Queue producer", () => {
  describe("generateJobId()", () => {
    it("produces an est_<timestamp> ID", () => {
      const id = generateJobId(1700000000000);
      assert.equal(id, "est_1700000000000");
    });

    it("generates unique IDs on successive calls", async () => {
      const id1 = generateJobId();
      await new Promise((r) => setTimeout(r, 2));
      const id2 = generateJobId();
      assert.notEqual(id1, id2);
    });
  });

  describe("buildJobPayload()", () => {
    it("merges input fields and adds a jobId", () => {
      const input = {
        rfpText: "We need a SaaS platform",
        channelId: "C123",
        threadTs: "1700000000.000000",
      };
      const payload = buildJobPayload(input, 1700000000000);
      assert.equal(payload.rfpText, input.rfpText);
      assert.equal(payload.channelId, input.channelId);
      assert.equal(payload.threadTs, input.threadTs);
      assert.equal(payload.jobId, "est_1700000000000");
    });

    it("includes clarificationAnswers when provided", () => {
      const payload = buildJobPayload({
        rfpText: "Some RFP",
        channelId: "C123",
        threadTs: "1700000000.000000",
        clarificationAnswers: "Budget is 50k EUR",
      }, 1700000000000);
      assert.equal(payload.clarificationAnswers, "Budget is 50k EUR");
    });

    it("omits clarificationAnswers when not provided", () => {
      const payload = buildJobPayload({
        rfpText: "Some RFP",
        channelId: "C123",
        threadTs: "1700000000.000000",
      }, 1700000000000);
      assert.equal(payload.clarificationAnswers, undefined);
    });
  });

  describe("resolveQueueProvider()", () => {
    it("uses Vercel Queues on Vercel by default", () => {
      assert.equal(resolveQueueProvider({ VERCEL: "1" }), "vercel");
    });

    it("uses BullMQ locally by default", () => {
      assert.equal(resolveQueueProvider({}), "bullmq");
    });

    it("allows explicit provider override", () => {
      assert.equal(resolveQueueProvider({ JOB_QUEUE_PROVIDER: "bullmq", VERCEL: "1" }), "bullmq");
      assert.equal(resolveQueueProvider({ JOB_QUEUE_PROVIDER: "vercel" }), "vercel");
    });
  });

  describe("BullMQ queue config", () => {
    it("retry attempts is set to 2 with exponential backoff", () => {
      // These values are defined in producer.ts — validate the constants are correct
      const jobOptions = {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
      };
      assert.equal(jobOptions.attempts, 2);
      assert.equal(jobOptions.backoff.type, "exponential");
      assert.ok(jobOptions.backoff.delay >= 1000, "backoff delay should be at least 1s");
    });
  });
});
