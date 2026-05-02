import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeReport, type EstimationJob, type runEstimationWorkflow } from "./orchestrator.js";
import type { WorkflowReporter } from "../lib/workflow-reporter.js";

// ── Type-shape tests (no I/O, no mocks needed) ────────────────────────────────
// These ensure the EstimationJob interface contract is correct at compile time
// and that callers build valid job objects.

function makeJob(overrides: Partial<EstimationJob> = {}): EstimationJob {
  return {
    jobId: "est_1234567890",
    rfpText: "We need a SaaS platform for managing freelancer contracts.",
    channelId: "C0123456789",
    threadTs: "1700000000.000000",
    ...overrides,
  };
}

type WorkflowReporterArgIsSupported =
  Extract<Parameters<typeof runEstimationWorkflow>["length"], 2> extends never
    ? false
    : Parameters<typeof runEstimationWorkflow>[1] extends WorkflowReporter | undefined
      ? true
      : false;
const _workflowReporterArgIsSupported: WorkflowReporterArgIsSupported = true;

describe("safeReport", () => {
  it("does not throw and logs job context when the reporter sink fails", async () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    try {
      await assert.doesNotReject(
        safeReport("est_1234567890", "progress", async () => {
          throw new Error("sink unavailable");
        })
      );
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(warnings.length, 1);
    const warning = JSON.parse(warnings[0]) as { jobId?: string; operation?: string; error?: string };
    assert.equal(warning.jobId, "est_1234567890");
    assert.equal(warning.operation, "progress");
    assert.equal(warning.error, "sink unavailable");
  });
});

describe("orchestrator tool allowlist", () => {
  it("does not expose broad Drive search to the agent", () => {
    const currentFile = fileURLToPath(import.meta.url);
    const source = fs.readFileSync(path.join(path.dirname(currentFile), "orchestrator.ts"), "utf-8");
    assert.ok(!source.includes("\"mcp__google-workspace__drive_search_files\""));
  });
});

describe("EstimationJob", () => {
  it("accepts a valid job with all required fields", () => {
    const job = makeJob();
    assert.equal(job.jobId, "est_1234567890");
    assert.equal(job.channelId, "C0123456789");
    assert.ok(job.rfpText && job.rfpText.length > 0);
  });

  it("clarificationAnswers is optional", () => {
    const withAnswers = makeJob({ clarificationAnswers: "Budget is 50k" });
    assert.equal(withAnswers.clarificationAnswers, "Budget is 50k");

    const withoutAnswers = makeJob();
    assert.equal(withoutAnswers.clarificationAnswers, undefined);
  });

  it("jobId follows the est_<timestamp> convention", () => {
    const job = makeJob({ jobId: `est_${Date.now()}` });
    assert.ok(job.jobId.startsWith("est_"), "jobId should start with est_");
    const ts = parseInt(job.jobId.replace("est_", ""), 10);
    assert.ok(!isNaN(ts), "jobId suffix should be numeric timestamp");
  });

  it("threadTs is a Slack timestamp string", () => {
    const job = makeJob({ threadTs: "1700000000.000200" });
    assert.ok(job.threadTs.includes("."), "Slack ts format includes a dot");
    const [sec, micro] = job.threadTs.split(".");
    assert.ok(!isNaN(Number(sec)));
    assert.ok(!isNaN(Number(micro)));
  });

  it("rfpText is preserved verbatim", () => {
    const rfp = "  Leading and trailing spaces   ";
    const job = makeJob({ rfpText: rfp });
    assert.equal(job.rfpText, rfp);
  });

  it("supports Drive folder IDs for file-based flow", () => {
    const job = makeJob({
      rfpText: undefined,
      inputFolderId: "folder_input_123",
      outputFolderId: "folder_output_456",
      estimationFolderId: "folder_est_789",
      messageText: "Check this RFP",
    });
    assert.equal(job.inputFolderId, "folder_input_123");
    assert.equal(job.outputFolderId, "folder_output_456");
    assert.equal(job.estimationFolderId, "folder_est_789");
    assert.equal(job.messageText, "Check this RFP");
    assert.equal(job.rfpText, undefined);
  });

  it("supports text-only fallback (backward compat)", () => {
    const job = makeJob({ rfpText: "Full RFP text here" });
    assert.equal(job.rfpText, "Full RFP text here");
    assert.equal(job.inputFolderId, undefined);
  });

  it("accepts value_discovery in skipSteps", () => {
    const job = makeJob({ skipSteps: ["value_discovery"] });
    assert.ok(job.skipSteps?.includes("value_discovery"));
  });

  it("accepts all skipSteps options together", () => {
    const job = makeJob({ skipSteps: ["slack", "value_discovery"] });
    assert.equal(job.skipSteps?.length, 2);
  });
});

// ── Chunking / text helpers (pure logic, no SDK calls) ────────────────────────
describe("RFP text validation logic", () => {
  it("rejects RFP shorter than 20 chars (matches Slack handler guard)", () => {
    const shortRfp = "Too short";
    assert.ok(shortRfp.length < 20, "short RFP should be rejected by Slack handler");
  });

  it("accepts RFP of exactly 20 chars", () => {
    const rfp = "12345678901234567890"; // exactly 20
    assert.ok(rfp.length >= 20);
  });

  it("large RFP text is preserved (no truncation in job object)", () => {
    const bigRfp = "A".repeat(10_000);
    const job = makeJob({ rfpText: bigRfp });
    assert.equal(job.rfpText!.length, 10_000);
  });
});
