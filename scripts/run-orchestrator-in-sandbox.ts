import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  WorkflowReporter,
  WorkflowProgressEvent,
  WorkflowLogEvent,
} from "../src/lib/workflow-reporter.js";

const AGENT_DIR = "/vercel/sandbox/.agent";
const EVENT_LOG_PATH = path.join(AGENT_DIR, "events.jsonl");
const RESULT_PATH = path.join(AGENT_DIR, "result.json");

mkdirSync(AGENT_DIR, { recursive: true });

function emit(record: Record<string, unknown>): void {
  const line = `${JSON.stringify(record)}\n`;
  process.stdout.write(line);
  appendFileSync(EVENT_LOG_PATH, line);
}

function writeResult(record: Record<string, unknown>): void {
  writeFileSync(RESULT_PATH, JSON.stringify(record), "utf8");
}

const reporter: WorkflowReporter = {
  async progress(event: WorkflowProgressEvent) {
    emit({ kind: "progress", event });
  },
  async log(event: WorkflowLogEvent) {
    emit({ kind: "log", event });
  },
  async system(message, data) {
    emit({ kind: "log", event: { level: "info", type: "system", message, data } });
  },
  async agentText(text) {
    emit({ kind: "log", event: { level: "info", type: "agent_text", message: "agent_text", data: { textLength: text.length } } });
  },
  async toolCall(name, args) {
    emit({ kind: "log", event: { level: "info", type: "tool_call", message: name, data: { name, args } } });
  },
  async toolResult(name, result) {
    emit({ kind: "log", event: { level: "info", type: "tool_result", message: name, data: { name, resultLength: result.length } } });
  },
};

async function locateClaudeBinary(): Promise<string | null> {
  if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
  const root = path.resolve("node_modules/@anthropic-ai");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.startsWith("claude-agent-sdk-")) continue;
    const candidate = path.join(root, entry, "claude");
    try {
      const s = await stat(candidate);
      if (s.isFile() && s.size > 0) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

const jobPath = process.argv[2];
if (!jobPath) {
  emit({ kind: "result", status: "failed", error: "Missing job path argument" });
  writeResult({ status: "failed", error: "Missing job path argument" });
  process.exit(2);
}

function diag(message: string, data?: Record<string, unknown>): void {
  emit({ kind: "log", event: { level: "info", type: "system", message, ...(data ? { data } : {}) } });
}

process.on("uncaughtException", (err) => {
  emit({ kind: "result", status: "failed", error: `uncaughtException: ${err.message}`, stack: err.stack });
  writeResult({ status: "failed", error: `uncaughtException: ${err.message}`, stack: err.stack });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  emit({ kind: "result", status: "failed", error: `unhandledRejection: ${message}`, stack });
  writeResult({ status: "failed", error: `unhandledRejection: ${message}`, stack });
  process.exit(1);
});

try {
  const binary = await locateClaudeBinary();
  if (binary) {
    process.env.CLAUDE_CODE_PATH = binary;
    diag("Resolved Claude Code binary", { path: binary });
  } else {
    emit({
      kind: "log",
      event: {
        level: "warn",
        type: "system",
        message: "No Claude Code binary found under node_modules/@anthropic-ai/claude-agent-sdk-*/claude — falling back to SDK default resolver",
      },
    });
  }

  diag("Importing orchestrator module");
  const importStart = Date.now();
  const { runEstimationWorkflow } = await import("../src/agents/orchestrator.js");
  diag("Orchestrator module loaded", { durationMs: Date.now() - importStart });

  diag("Reading job file", { jobPath });
  const raw = await readFile(jobPath, "utf8");
  const job = JSON.parse(raw) as import("../src/agents/orchestrator.js").EstimationJob;

  diag("Invoking runEstimationWorkflow", { jobId: job.jobId });
  const runStart = Date.now();
  await runEstimationWorkflow(job, reporter);
  diag("runEstimationWorkflow returned", { jobId: job.jobId, durationMs: Date.now() - runStart });

  emit({ kind: "result", status: "completed" });
  writeResult({ status: "completed" });
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  emit({ kind: "result", status: "failed", error: message, stack });
  writeResult({ status: "failed", error: message, stack });
  process.exit(1);
}
