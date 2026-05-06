import ms from "ms";
import { Sandbox, type Command } from "@vercel/sandbox";
import { logger } from "../lib/logger.js";
import type { EstimationJob } from "../agents/orchestrator.js";
import type {
  WorkflowReporter,
  WorkflowProgressEvent,
  WorkflowLogEvent,
} from "../lib/workflow-reporter.js";
import { SANDBOX_TEMPLATE_SNAPSHOT_ID } from "./sandbox-snapshot-id.js";

export type WorkspaceProvider = "vercel-sandbox" | "local";

const SANDBOX_CWD = "/vercel/sandbox";
const AGENT_DIR = `${SANDBOX_CWD}/.agent`;
const JOB_FILE = `${AGENT_DIR}/job.json`;
const EVENT_LOG_PATH = `${AGENT_DIR}/events.jsonl`;
const RESULT_PATH = `${AGENT_DIR}/result.json`;
const SANDBOX_TIMEOUT_MS = ms("5h");
const SANDBOX_EXTEND_MS = ms("1h");
const SANDBOX_EXTEND_THRESHOLD_MS = ms("30m");
const POLL_INTERVAL_MS = 2000;
const DEFAULT_REPO_URL = "https://github.com/Blazity/pre-sales-agent.git";

function shortStableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

export function buildSandboxLabel(job: EstimationJob): string {
  const rawTitle = (job.messageText ?? job.rfpText ?? job.jobId)
    .replace(/https?:\/\/\S+/g, " ")
    .trim();
  const title = rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/g, "") || "estimation";
  const hash = shortStableHash(`${job.jobId}:${rawTitle}`);
  return `${title}-${hash}`;
}

export function resolveWorkspaceProvider(env: NodeJS.ProcessEnv = process.env): WorkspaceProvider {
  const configured = env.AGENT_WORKSPACE_PROVIDER;
  if (configured === "vercel-sandbox" || configured === "local") return configured;
  return env.VERCEL ? "vercel-sandbox" : "local";
}

export async function runSandboxSmokeTest(): Promise<{ sandboxId: string; exitCode: number }> {
  const sandbox = await Sandbox.create({
    resources: { vcpus: 4 },
    timeout: ms("10m"),
    runtime: "node24",
  });

  console.log(`Sandbox created: ${sandbox.sandboxId}`);

  try {
    console.log(`Installing Claude Code CLI...`);
    const installCLI = await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "-g", "@anthropic-ai/claude-code"],
      stderr: process.stderr,
      stdout: process.stdout,
      sudo: true,
    });
    if (installCLI.exitCode != 0) {
      console.log("installing Claude Code CLI failed");
      return { sandboxId: sandbox.sandboxId, exitCode: installCLI.exitCode };
    }
    console.log(`✓ Claude Code CLI installed`);

    console.log(`Installing Anthropic SDK...`);
    const installSDK = await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "@anthropic-ai/sdk"],
      stderr: process.stderr,
      stdout: process.stdout,
    });
    if (installSDK.exitCode != 0) {
      console.log("installing Anthropic SDK failed");
      return { sandboxId: sandbox.sandboxId, exitCode: installSDK.exitCode };
    }
    console.log(`✓ Anthropic SDK installed`);

    console.log(`Verifying SDK connection...`);
    const verifyScript = `
import Anthropic from '@anthropic-ai/sdk';
console.log('SDK imported successfully');
console.log('Anthropic SDK version:', Anthropic.VERSION);
console.log('SDK is ready to use');
`;
    await sandbox.writeFiles([
      {
        path: "/vercel/sandbox/verify.mjs",
        content: Buffer.from(verifyScript),
      },
    ]);

    const verifyRun = await sandbox.runCommand({
      cmd: "node",
      args: ["verify.mjs"],
      stderr: process.stderr,
      stdout: process.stdout,
    });
    if (verifyRun.exitCode != 0) {
      console.log("SDK verification failed");
      return { sandboxId: sandbox.sandboxId, exitCode: verifyRun.exitCode };
    }
    console.log(`✓ Anthropic SDK is properly connected`);
    console.log(`\nSuccess! Both Claude Code CLI and Anthropic SDK are installed and ready to use.`);

    logger.info("Vercel Sandbox smoke test completed", {
      sandboxId: sandbox.sandboxId,
      exitCode: 0,
    });

    return { sandboxId: sandbox.sandboxId, exitCode: 0 };
  } finally {
    await sandbox.stop().catch((err) => {
      logger.warn("Failed to stop Vercel Sandbox after smoke test", {
        sandboxId: sandbox.sandboxId,
        error: String(err),
      });
    });
    console.log(`Sandbox stopped`);
  }
}

interface SandboxRunnerEvent {
  kind: "progress" | "log" | "result";
  event?: WorkflowProgressEvent | WorkflowLogEvent;
  status?: "completed" | "failed";
  error?: string;
  stack?: string;
}

export interface JsonlDispatchSinks {
  onProgress: (event: WorkflowProgressEvent) => Promise<void>;
  onLog: (event: WorkflowLogEvent) => Promise<void>;
  onResult: (status: "completed" | "failed", error?: string) => Promise<void>;
  onUnparsed: (line: string) => Promise<void>;
}

export async function dispatchJsonlChunk(
  buffered: string,
  chunk: string,
  sinks: JsonlDispatchSinks,
): Promise<string> {
  const combined = buffered + chunk;
  const newlineIdx = combined.lastIndexOf("\n");
  if (newlineIdx < 0) return combined;

  const complete = combined.slice(0, newlineIdx);
  const tail = combined.slice(newlineIdx + 1);

  for (const raw of complete.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let parsed: SandboxRunnerEvent | null = null;
    try {
      parsed = JSON.parse(line) as SandboxRunnerEvent;
    } catch {
      await sinks.onUnparsed(line);
      continue;
    }
    if (parsed.kind === "progress" && parsed.event) {
      await sinks.onProgress(parsed.event as WorkflowProgressEvent);
    } else if (parsed.kind === "log" && parsed.event) {
      await sinks.onLog(parsed.event as WorkflowLogEvent);
    } else if (parsed.kind === "result") {
      await sinks.onResult(parsed.status ?? "failed", parsed.error);
    } else {
      await sinks.onUnparsed(line);
    }
  }

  return tail;
}

const FORWARDED_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "VOYAGE_API_KEY",
  "PINECONE_API_KEY",
  "PINECONE_INDEX",
  "PINECONE_NAMESPACE",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GDRIVE_ROOT_FOLDER_ID",
  "GDRIVE_TEMPLATE_ID",
  "GSHEETS_TEMPLATE_ID",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "BRAVE_API_KEY",
  "FIGMA_API_KEY",
  "AGENCY_PROFILE_PATH",
  "AGENT_WORKSPACE_DIR",
  "LOG_LEVEL",
  "NODE_ENV",
] as const;

export function collectForwardedEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FORWARDED_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  out.AGENT_WORKSPACE_DIR = "/vercel/sandbox/workspace";
  return out;
}

export function resolveRepoUrl(env: NodeJS.ProcessEnv): string {
  if (env.AGENT_REPO_URL) return env.AGENT_REPO_URL;
  const provider = env.VERCEL_GIT_PROVIDER;
  const owner = env.VERCEL_GIT_REPO_OWNER;
  const slug = env.VERCEL_GIT_REPO_SLUG;
  if (owner && slug) {
    if (!provider || provider === "github") return `https://github.com/${owner}/${slug}.git`;
    if (provider === "gitlab") return `https://gitlab.com/${owner}/${slug}.git`;
    if (provider === "bitbucket") return `https://bitbucket.org/${owner}/${slug}.git`;
  }
  return DEFAULT_REPO_URL;
}

export function resolveRepoRevision(env: NodeJS.ProcessEnv): string {
  return env.AGENT_REPO_REVISION ?? env.VERCEL_GIT_COMMIT_REF ?? env.VERCEL_GIT_COMMIT_SHA ?? "main";
}

type GitSource =
  | { type: "git"; url: string; revision: string; depth: number }
  | {
      type: "git";
      url: string;
      revision: string;
      depth: number;
      username: string;
      password: string;
    };

function buildGitSource(env: NodeJS.ProcessEnv): GitSource {
  const repoUrl = resolveRepoUrl(env);
  const revision = resolveRepoRevision(env);
  const gitToken = env.AGENT_REPO_TOKEN ?? env.GITHUB_TOKEN;
  return gitToken
    ? {
        type: "git",
        url: repoUrl,
        revision,
        depth: 1,
        username: env.AGENT_REPO_USERNAME ?? gitToken,
        password: env.AGENT_REPO_USERNAME ? gitToken : "x-oauth-basic",
      }
    : { type: "git", url: repoUrl, revision, depth: 1 };
}

export interface BootSandboxForJobOptions {
  job: EstimationJob;
  env?: NodeJS.ProcessEnv;
  createSandbox?: typeof Sandbox.create;
  snapshotId?: string | null;
}

export async function bootSandboxForJob(opts: BootSandboxForJobOptions): Promise<{ sandbox: Sandbox; command: Command }> {
  const env = opts.env ?? process.env;
  const create = opts.createSandbox ?? Sandbox.create;
  const snapshotId = opts.snapshotId === undefined ? SANDBOX_TEMPLATE_SNAPSHOT_ID : opts.snapshotId;
  const fromSnapshot = Boolean(snapshotId);
  const sandboxLabel = buildSandboxLabel(opts.job);
  const commandEnv = {
    ...collectForwardedEnv(env),
    AGENT_JOB_ID: opts.job.jobId,
    AGENT_SANDBOX_LABEL: sandboxLabel,
  };

  logger.info("Booting sandbox for estimation", {
    jobId: opts.job.jobId,
    sandboxLabel,
    fromSnapshot,
  });

  if (!fromSnapshot) {
    logger.warn(
      "No build-time sandbox snapshot — falling back to git-clone path. " +
        "Set VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID in the project's Build env to enable the snapshot, " +
        "and AGENT_REPO_TOKEN (or GITHUB_TOKEN) for private repos.",
      {
        jobId: opts.job.jobId,
        repoUrl: resolveRepoUrl(env),
        revision: resolveRepoRevision(env),
        hasGitToken: Boolean(env.AGENT_REPO_TOKEN ?? env.GITHUB_TOKEN),
      },
    );
  }

  let sandbox: Sandbox;
  try {
    sandbox = fromSnapshot
      ? await create({
          source: { type: "snapshot", snapshotId: snapshotId! },
          resources: { vcpus: 2 },
          timeout: SANDBOX_TIMEOUT_MS,
          env: {
            AGENT_JOB_ID: opts.job.jobId,
            AGENT_SANDBOX_LABEL: sandboxLabel,
          },
        })
      : await create({
          source: buildGitSource(env),
          resources: { vcpus: 2 },
          runtime: "node24",
          timeout: SANDBOX_TIMEOUT_MS,
          env: {
            AGENT_JOB_ID: opts.job.jobId,
            AGENT_SANDBOX_LABEL: sandboxLabel,
          },
        });
  } catch (err) {
    const e = err as {
      message?: string;
      response?: { status?: number; statusText?: string };
      json?: unknown;
      text?: string;
    };
    const body = e.text ?? (e.json ? JSON.stringify(e.json) : undefined);
    const detail = {
      message: e.message,
      status: e.response?.status,
      statusText: e.response?.statusText,
      body,
      fromSnapshot,
      repoUrl: fromSnapshot ? undefined : resolveRepoUrl(env),
      revision: fromSnapshot ? undefined : resolveRepoRevision(env),
      hasGitToken: fromSnapshot ? undefined : Boolean(env.AGENT_REPO_TOKEN ?? env.GITHUB_TOKEN),
    };
    logger.error("Sandbox.create rejected by Vercel API", detail);

    const hint = (() => {
      if (fromSnapshot) {
        return ` Snapshot id was ${JSON.stringify(snapshotId)}; if it was deleted or expired, redeploy to rebuild it.`;
      }
      const isGitClone = typeof body === "string" && body.includes("git clone failed");
      if (isGitClone) {
        const tokenHint = env.AGENT_REPO_TOKEN ?? env.GITHUB_TOKEN
          ? "AGENT_REPO_TOKEN/GITHUB_TOKEN was set but git rejected it (check token scope and repo access)"
          : "no AGENT_REPO_TOKEN or GITHUB_TOKEN was set, so the clone tried unauthenticated — set one of these in the runtime env for private repos";
        return ` Tried git-clone of ${detail.repoUrl}@${detail.revision}; ${tokenHint}. Or, set VERCEL_TOKEN/VERCEL_TEAM_ID/VERCEL_PROJECT_ID at build time so per-job sandboxes use the prebuilt snapshot instead.`;
      }
      return "";
    })();

    throw new Error(
      `Sandbox.create failed (${detail.status ?? "?"} ${detail.statusText ?? ""}): ${
        body ?? detail.message ?? "no detail"
      }.${hint}`,
    );
  }

  logger.info("Sandbox created", { jobId: opts.job.jobId, sandboxId: sandbox.sandboxId, sandboxLabel });

  await sandbox.fs.mkdir(AGENT_DIR, { recursive: true });
  await sandbox.fs.writeFile(JOB_FILE, JSON.stringify(opts.job), "utf8");
  await sandbox.fs.writeFile(`${AGENT_DIR}/sandbox-label`, sandboxLabel, "utf8");

  if (!fromSnapshot) {
    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["ci", "--no-audit", "--no-fund"],
      cwd: SANDBOX_CWD,
    });
    if (install.exitCode !== 0) {
      const stderr = await install.stderr();
      throw new Error(`npm ci failed in sandbox (exit ${install.exitCode}): ${stderr.slice(0, 500)}`);
    }

    const build = await sandbox.runCommand({
      cmd: "npm",
      args: ["run", "build"],
      cwd: SANDBOX_CWD,
      env: commandEnv,
    });
    if (build.exitCode !== 0) {
      const stderr = await build.stderr();
      throw new Error(`npm run build failed in sandbox (exit ${build.exitCode}): ${stderr.slice(0, 500)}`);
    }
  }

  const command = await sandbox.runCommand({
    cmd: "npx",
    args: ["tsx", "scripts/run-orchestrator-in-sandbox.ts", ".agent/job.json"],
    cwd: SANDBOX_CWD,
    env: commandEnv,
    detached: true,
  });

  return { sandbox, command };
}

export interface StreamOrchestratorEventsOptions {
  sandbox: Sandbox;
  command: Command;
  reporter: WorkflowReporter;
  offset?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export interface StreamOrchestratorEventsResult {
  status: "completed" | "failed";
  error?: string;
  offset: number;
}

export interface PumpOrchestratorOptions {
  sandbox: Sandbox;
  command: Command;
  reporter: WorkflowReporter;
  offset: number;
  isFirstTick?: boolean;
}

export interface PumpOrchestratorTick {
  done: boolean;
  status?: "completed" | "failed";
  error?: string;
  offset: number;
}

interface ReadFileLike {
  readFile?: (params: { path: string }) => Promise<Buffer | null | { toString(encoding: string): string }>;
  readFileToBuffer?: (params: { path: string }) => Promise<Buffer | null>;
}

async function readSandboxFileBuffer(sandbox: Sandbox, filePath: string): Promise<Buffer | null> {
  const candidate = sandbox as unknown as ReadFileLike;
  if (typeof candidate.readFileToBuffer === "function") {
    return candidate.readFileToBuffer({ path: filePath });
  }
  if (typeof candidate.readFile === "function") {
    const result = await candidate.readFile({ path: filePath });
    if (result === null) return null;
    if (Buffer.isBuffer(result)) return result;
    return Buffer.from((result as { toString(encoding: string): string }).toString("utf8"), "utf8");
  }
  throw new Error("@vercel/sandbox client missing readFile / readFileToBuffer");
}

export async function pumpOrchestratorEventsOnce(
  opts: PumpOrchestratorOptions,
): Promise<PumpOrchestratorTick> {
  const { sandbox, command, reporter } = opts;
  let offset = opts.offset;
  let finalStatus: "completed" | "failed" | null = null;
  let finalError: string | undefined;

  if (opts.isFirstTick) {
    const remainingMs = Math.max(
      0,
      sandbox.timeout - (Date.now() - sandbox.createdAt.getTime()),
    );
    if (remainingMs < SANDBOX_EXTEND_THRESHOLD_MS) {
      await sandbox.extendTimeout(SANDBOX_EXTEND_MS).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        const atCap = message.includes("400");
        const log = atCap ? logger.info : logger.warn;
        log("extendTimeout did not extend sandbox", {
          sandboxId: sandbox.sandboxId,
          remainingMs,
          atCap,
          error: message,
        });
      });
    }
  }

  const sinks: JsonlDispatchSinks = {
    onProgress: (event) => reporter.progress(event),
    onLog: (event) => reporter.log(event),
    onResult: async (status, error) => {
      finalStatus = status;
      finalError = error;
    },
    onUnparsed: async (line) => {
      await reporter.system("sandbox stdout", { line: line.slice(0, 500) });
    },
  };

  const buf = await readSandboxFileBuffer(sandbox, EVENT_LOG_PATH);
  if (buf && buf.length > offset) {
    const newBytes = buf.slice(offset);
    const lastNl = newBytes.lastIndexOf(0x0a);
    if (lastNl >= 0) {
      const completeChunk = newBytes.slice(0, lastNl + 1).toString("utf8");
      offset += lastNl + 1;
      await dispatchJsonlChunk("", completeChunk, sinks);
    }
  }

  if (finalStatus === null) {
    const resultBuf = await readSandboxFileBuffer(sandbox, RESULT_PATH).catch(() => null);
    if (resultBuf && resultBuf.length > 0) {
      try {
        const parsed = JSON.parse(resultBuf.toString("utf8")) as {
          status: "completed" | "failed";
          error?: string;
        };
        finalStatus = parsed.status;
        finalError = parsed.error;
      } catch {}
    }
  }

  if (finalStatus === null) {
    const exitInfo = await Promise.race([
      command.wait().then((f) => ({ exited: true as const, exitCode: f.exitCode })).catch(() => ({ exited: false as const })),
      new Promise<{ exited: false }>((r) => setTimeout(() => r({ exited: false as const }), 100)),
    ]);
    if (exitInfo.exited) {
      const stderr = await command.stderr().catch(() => "");
      finalStatus = "failed";
      finalError =
        `Sandbox orchestrator exited (code ${exitInfo.exitCode ?? "?"}) without writing result.json. ` +
        `stderr tail: ${stderr.slice(-500) || "<empty>"}`;
    }
  }

  return finalStatus !== null
    ? { done: true, status: finalStatus, error: finalError, offset }
    : { done: false, offset };
}

export async function streamOrchestratorEvents(
  opts: StreamOrchestratorEventsOptions,
): Promise<StreamOrchestratorEventsResult> {
  const pollMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  let offset = opts.offset ?? 0;
  let isFirstTick = true;
  while (true) {
    if (opts.signal?.aborted) {
      return { status: "failed", error: "aborted by caller", offset };
    }
    const tick = await pumpOrchestratorEventsOnce({
      sandbox: opts.sandbox,
      command: opts.command,
      reporter: opts.reporter,
      offset,
      isFirstTick,
    });
    isFirstTick = false;
    offset = tick.offset;
    if (tick.done) {
      return {
        status: tick.status ?? "failed",
        error: tick.error,
        offset,
      };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export async function stopSandbox(sandbox: Sandbox, jobId: string): Promise<void> {
  await sandbox.stop().catch((err) => {
    logger.warn("Failed to stop sandbox", {
      sandboxId: sandbox.sandboxId,
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
