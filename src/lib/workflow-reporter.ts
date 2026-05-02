import { logger } from "./logger.js";

export type WorkflowStatus = "running" | "completed" | "failed" | "cancelled";
export type WorkflowLogLevel = "info" | "warn" | "error" | "debug";
export type WorkflowLogType = "system" | "agent_text" | "tool_call" | "tool_result";

export interface WorkflowProgressEvent {
  status?: WorkflowStatus;
  step?: number;
  stepName?: string;
  turnsCompleted?: number;
  costClaudeUsd?: number;
  costBraveUsd?: number;
  costTotalUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface WorkflowLogEvent {
  level: WorkflowLogLevel;
  type: WorkflowLogType;
  message: string;
  data?: Record<string, unknown>;
}

export interface WorkflowReporter {
  progress(event: WorkflowProgressEvent): Promise<void>;
  log(event: WorkflowLogEvent): Promise<void>;
  system(message: string, data?: Record<string, unknown>): Promise<void>;
  agentText(text: string): Promise<void>;
  toolCall(name: string, args: unknown): Promise<void>;
  toolResult(name: string, result: string): Promise<void>;
}

type LoggerSink = Record<WorkflowLogLevel, (message: string, data?: Record<string, unknown>) => void | Promise<void>>;

type ReporterEvent =
  | ({ kind: "progress"; jobId: string } & WorkflowProgressEvent)
  | ({ kind: "log"; jobId: string } & WorkflowLogEvent);

export function formatReporterEvent(event: ReporterEvent): Record<string, unknown> {
  if (event.kind === "progress") {
    const { kind: _kind, ...rest } = event;
    return { event: "workflow.progress", ...rest };
  }

  const { kind: _kind, jobId, level, type, message, data } = event;
  const formatted = { event: "workflow.log", jobId, level, type, message };
  return data === undefined ? formatted : { ...formatted, data };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function shortToolName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "");
}

function summarizeUrl(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return { url: "invalid" };
  try {
    const url = new URL(value);
    return { protocol: url.protocol.replace(":", ""), hostname: url.hostname };
  } catch {
    return { url: "invalid" };
  }
}

function summarizeToolArgs(name: string, args: unknown): Record<string, unknown> {
  const tool = shortToolName(name);
  const record = toRecord(args);
  if (!record) return { argType: typeof args };

  if (tool === "fetch_web_page") {
    return {
      ...summarizeUrl(record.url),
      hasExtractPrompt: typeof record.extract_prompt === "string" && record.extract_prompt.length > 0,
    };
  }

  if (tool === "docs_write_sections") {
    const sections = Array.isArray(record.sections) ? record.sections : [];
    const sectionTypes = sections
      .map((section) => toRecord(section)?.type)
      .filter((type): type is string => typeof type === "string");
    return {
      hasDocumentId: typeof record.document_id === "string" && record.document_id.length > 0,
      sectionCount: sections.length,
      sectionTypes,
    };
  }

  if (tool === "post_message") {
    return {
      hasChannel: typeof record.channel === "string" && record.channel.length > 0,
      hasThread: typeof record.thread_ts === "string" && record.thread_ts.length > 0,
      hasBlocks: typeof record.blocks === "string" && record.blocks.length > 0,
      textLength: typeof record.text === "string" ? record.text.length : 0,
    };
  }

  const keys = Object.keys(record).sort();
  return { argKeys: keys, argCount: keys.length };
}

function classifyToolResult(result: string): "ok" | "error" | "timeout" {
  const lower = result.slice(0, 120).toLowerCase();
  if (lower.includes("timeout")) return "timeout";
  if (lower.startsWith("error") || lower.includes(" error:") || lower.includes("failed") || lower.includes("forbidden")) {
    return "error";
  }
  return "ok";
}

export function createWorkflowReporter(jobId: string, sink: LoggerSink = logger): WorkflowReporter {
  const progress = async (event: WorkflowProgressEvent) => {
    await sink.info("Workflow progress", formatReporterEvent({ kind: "progress", jobId, ...event }));
  };

  const log = async (event: WorkflowLogEvent) => {
    await sink[event.level](event.message, formatReporterEvent({ kind: "log", jobId, ...event }));
  };

  return {
    progress,
    log,

    system(message, data) {
      return log({ level: "info", type: "system", message, data });
    },

    agentText(text) {
      return log({
        level: "info",
        type: "agent_text",
        message: "agent_text_redacted",
        data: { textLength: text.length },
      });
    },

    toolCall(name, args) {
      const summary = summarizeToolArgs(name, args);
      return log({
        level: "info",
        type: "tool_call",
        message: `${name}(args_redacted)`,
        data: { tool: shortToolName(name), summary },
      });
    },

    toolResult(name, result) {
      return log({
        level: "info",
        type: "tool_result",
        message: `${name} -> result_redacted`,
        data: {
          tool: shortToolName(name),
          resultLength: result.length,
          status: classifyToolResult(result),
        },
      });
    },
  };
}
