import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorkflowReporter, formatReporterEvent } from "./workflow-reporter.js";

describe("workflow reporter", () => {
  it("formats progress events with job metadata", () => {
    assert.deepEqual(formatReporterEvent({
      kind: "progress",
      jobId: "est_123",
      status: "running",
      step: 2,
      stepName: "Clarification",
      turnsCompleted: 4,
    }), {
      event: "workflow.progress",
      jobId: "est_123",
      status: "running",
      step: 2,
      stepName: "Clarification",
      turnsCompleted: 4,
    });
  });

  it("formats log events with level, type, and data", () => {
    assert.deepEqual(formatReporterEvent({
      kind: "log",
      jobId: "est_123",
      level: "info",
      type: "tool_call",
      message: "mcp__google-workspace__docs_create_document({})",
      data: { tool: "docs_create_document" },
    }), {
      event: "workflow.log",
      jobId: "est_123",
      level: "info",
      type: "tool_call",
      message: "mcp__google-workspace__docs_create_document({})",
      data: { tool: "docs_create_document" },
    });
  });

  it("keeps log data from overwriting core event fields", () => {
    assert.deepEqual(formatReporterEvent({
      kind: "log",
      jobId: "est_123",
      level: "info",
      type: "tool_call",
      message: "safe message",
      data: {
        event: "unexpected",
        jobId: "unexpected",
        level: "error",
        type: "system",
        message: "unexpected",
        tool: "docs_create_document",
      },
    }), {
      event: "workflow.log",
      jobId: "est_123",
      level: "info",
      type: "tool_call",
      message: "safe message",
      data: {
        event: "unexpected",
        jobId: "unexpected",
        level: "error",
        type: "system",
        message: "unexpected",
        tool: "docs_create_document",
      },
    });
  });

  it("logs through the provided sink", async () => {
    const events: unknown[] = [];
    const reporter = createWorkflowReporter("est_123", {
      info: (_message, data) => { events.push(data); },
      warn: (_message, data) => { events.push(data); },
      error: (_message, data) => { events.push(data); },
      debug: (_message, data) => { events.push(data); },
    });

    await reporter.progress({ status: "completed" });
    await reporter.system("Job completed", { turns: 12 });

    assert.deepEqual(events, [
      { event: "workflow.progress", jobId: "est_123", status: "completed" },
      { event: "workflow.log", jobId: "est_123", level: "info", type: "system", message: "Job completed", data: { turns: 12 } },
    ]);
  });

  it("awaits async sinks before resolving", async () => {
    let resolveProgressSink: () => void = () => {};
    let resolveLogSink: () => void = () => {};
    let progressResolved = false;
    let logResolved = false;
    const reporter = createWorkflowReporter("est_123", {
      info: () => new Promise<void>((resolve) => { resolveProgressSink = resolve; }),
      warn: () => new Promise<void>((resolve) => { resolveLogSink = resolve; }),
      error: async () => {},
      debug: async () => {},
    });

    const progressPromise = reporter.progress({ status: "running" });
    progressPromise.then(() => { progressResolved = true; });
    await Promise.resolve();

    assert.equal(progressResolved, false);
    resolveProgressSink();
    await progressPromise;
    assert.equal(progressResolved, true);

    const logPromise = reporter.log({ level: "warn", type: "system", message: "Warning" });
    logPromise.then(() => { logResolved = true; });
    await Promise.resolve();

    assert.equal(logResolved, false);
    resolveLogSink();
    await logPromise;
    assert.equal(logResolved, true);
  });

  it("supports destructured helper methods", async () => {
    const events: unknown[] = [];
    const reporter = createWorkflowReporter("est_123", {
      info: (_message, data) => { events.push(data); },
      warn: (_message, data) => { events.push(data); },
      error: (_message, data) => { events.push(data); },
      debug: (_message, data) => { events.push(data); },
    });
    const { system } = reporter;

    await system("Job completed");

    assert.deepEqual(events, [
      { event: "workflow.log", jobId: "est_123", level: "info", type: "system", message: "Job completed" },
    ]);
  });

  it("serializes tool call args without throwing for undefined, circular objects, or bigint", async () => {
    const messages: string[] = [];
    const reporter = createWorkflowReporter("est_123", {
      info: (message) => { messages.push(message); },
      warn: (message) => { messages.push(message); },
      error: (message) => { messages.push(message); },
      debug: (message) => { messages.push(message); },
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await reporter.toolCall("undefined_tool", undefined);
    await reporter.toolCall("circular_tool", circular);
    await reporter.toolCall("bigint_tool", 1n);

    assert.deepEqual(messages, [
      "undefined_tool(undefined)",
      "circular_tool([unserializable args])",
      "bigint_tool(1)",
    ]);
  });
});
