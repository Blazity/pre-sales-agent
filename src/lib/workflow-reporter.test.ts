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

  it("summarizes unusual tool call args without throwing for undefined, circular objects, or bigint", async () => {
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
      "undefined_tool(args_redacted)",
      "circular_tool(args_redacted)",
      "bigint_tool(args_redacted)",
    ]);
  });

  it("redacts raw agent text from workflow logs", async () => {
    const events: Array<{ message?: string; data?: Record<string, unknown> }> = [];
    const reporter = createWorkflowReporter("est_123", {
      info: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      warn: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      error: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      debug: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
    });

    await reporter.agentText("SECRET_RFP_TEXT: client wants acquisition strategy");

    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes("SECRET_RFP_TEXT"));
    assert.ok(serialized.includes("agent_text_redacted"));
    assert.ok(serialized.includes("\"textLength\""));
  });

  it("redacts sensitive tool arguments and preserves safe summaries", async () => {
    const events: Array<{ message?: string; data?: Record<string, unknown> }> = [];
    const reporter = createWorkflowReporter("est_123", {
      info: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      warn: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      error: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      debug: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
    });

    await reporter.toolCall("mcp__web-research__fetch_web_page", {
      url: "https://example.com/private?token=SECRET_TOKEN",
      extract_prompt: "extract SECRET_CLIENT_DETAIL",
    });
    await reporter.toolCall("mcp__google-workspace__docs_write_sections", {
      document_id: "doc_SECRET_ID",
      sections: [
        { type: "paragraph", text: "SECRET_PROPOSAL_BODY" },
        { type: "table", rows: [["SECRET_TABLE_VALUE"]] },
      ],
    });

    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes("SECRET_TOKEN"));
    assert.ok(!serialized.includes("SECRET_CLIENT_DETAIL"));
    assert.ok(!serialized.includes("SECRET_PROPOSAL_BODY"));
    assert.ok(!serialized.includes("SECRET_TABLE_VALUE"));
    assert.ok(serialized.includes("example.com"));
    assert.ok(serialized.includes("\"sectionCount\":2"));
  });

  it("redacts raw tool results from workflow logs", async () => {
    const events: Array<{ message?: string; data?: Record<string, unknown> }> = [];
    const reporter = createWorkflowReporter("est_123", {
      info: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      warn: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      error: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      debug: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
    });

    await reporter.toolResult("mcp__google-workspace__drive_export_file", "SECRET_DOC_TEXT with confidential budget");
    await reporter.toolResult("mcp__google-workspace__drive_export_file", "Error: Drive API error: forbidden");

    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes("SECRET_DOC_TEXT"));
    assert.ok(serialized.includes("\"resultLength\""));
    assert.ok(serialized.includes("\"status\":\"ok\""));
    assert.ok(serialized.includes("\"status\":\"error\""));
  });
});
