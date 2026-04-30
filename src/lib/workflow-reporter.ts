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

function serializeToolArgs(args: unknown): string {
  if (typeof args === "string") {
    return args;
  }

  if (args === undefined || typeof args === "bigint") {
    return String(args);
  }

  try {
    const serialized = JSON.stringify(args);
    return serialized ?? String(args);
  } catch {
    return "[unserializable args]";
  }
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
        message: text.slice(0, 500),
      });
    },

    toolCall(name, args) {
      const argsStr = serializeToolArgs(args);
      return log({
        level: "info",
        type: "tool_call",
        message: `${name}(${argsStr.slice(0, 300)})`,
        data: { tool: name },
      });
    },

    toolResult(name, result) {
      return log({
        level: "info",
        type: "tool_result",
        message: `${name} -> ${result.slice(0, 500)}`,
        data: { tool: name },
      });
    },
  };
}
