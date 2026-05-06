import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootSandboxForJob,
  buildSandboxLabel,
  collectForwardedEnv,
  dispatchJsonlChunk,
  resolveRepoRevision,
  resolveRepoUrl,
  resolveWorkspaceProvider,
  streamOrchestratorEvents,
  type JsonlDispatchSinks,
} from "./sandbox.js";
import type { Sandbox, Command } from "@vercel/sandbox";
import type {
  WorkflowProgressEvent,
  WorkflowLogEvent,
  WorkflowReporter,
} from "../lib/workflow-reporter.js";
import type { EstimationJob } from "../agents/orchestrator.js";

describe("workspace provider", () => {
  it("uses Vercel Sandbox on Vercel by default", () => {
    assert.equal(resolveWorkspaceProvider({ VERCEL: "1" }), "vercel-sandbox");
  });

  it("uses local workspace outside Vercel by default", () => {
    assert.equal(resolveWorkspaceProvider({}), "local");
  });

  it("allows explicit provider override", () => {
    assert.equal(resolveWorkspaceProvider({ AGENT_WORKSPACE_PROVIDER: "local", VERCEL: "1" }), "local");
    assert.equal(resolveWorkspaceProvider({ AGENT_WORKSPACE_PROVIDER: "vercel-sandbox" }), "vercel-sandbox");
  });
});

function makeRecorder() {
  const progress: WorkflowProgressEvent[] = [];
  const logs: WorkflowLogEvent[] = [];
  const results: Array<{ status: "completed" | "failed"; error?: string }> = [];
  const unparsed: string[] = [];
  const sinks: JsonlDispatchSinks = {
    async onProgress(event) { progress.push(event); },
    async onLog(event) { logs.push(event); },
    async onResult(status, error) { results.push({ status, error }); },
    async onUnparsed(line) { unparsed.push(line); },
  };
  return { progress, logs, results, unparsed, sinks };
}

describe("dispatchJsonlChunk", () => {
  it("dispatches a single complete line and returns empty tail", async () => {
    const r = makeRecorder();
    const tail = await dispatchJsonlChunk(
      "",
      `${JSON.stringify({ kind: "progress", event: { status: "running", step: 1 } })}\n`,
      r.sinks,
    );
    assert.equal(tail, "");
    assert.deepEqual(r.progress, [{ status: "running", step: 1 }]);
  });

  it("buffers an incomplete line until terminator arrives", async () => {
    const r = makeRecorder();
    const part1 = `${JSON.stringify({ kind: "progress", event: { status: "running" } })}`;
    const tail1 = await dispatchJsonlChunk("", part1, r.sinks);
    assert.equal(tail1, part1);
    assert.equal(r.progress.length, 0);

    const tail2 = await dispatchJsonlChunk(tail1, "\n", r.sinks);
    assert.equal(tail2, "");
    assert.deepEqual(r.progress, [{ status: "running" }]);
  });

  it("dispatches log and result events in stream order", async () => {
    const r = makeRecorder();
    const stream = [
      JSON.stringify({ kind: "log", event: { level: "info", type: "system", message: "hi" } }),
      JSON.stringify({ kind: "result", status: "completed" }),
      "",
    ].join("\n");
    await dispatchJsonlChunk("", stream, r.sinks);
    assert.equal(r.logs.length, 1);
    assert.equal(r.logs[0].message, "hi");
    assert.deepEqual(r.results, [{ status: "completed", error: undefined }]);
  });

  it("routes unparseable lines and unknown kinds to onUnparsed", async () => {
    const r = makeRecorder();
    const stream = `not json\n${JSON.stringify({ kind: "weird" })}\n`;
    await dispatchJsonlChunk("", stream, r.sinks);
    assert.equal(r.unparsed.length, 2);
    assert.equal(r.unparsed[0], "not json");
  });
});

describe("resolveRepoUrl", () => {
  it("uses AGENT_REPO_URL when set", () => {
    assert.equal(
      resolveRepoUrl({ AGENT_REPO_URL: "https://example.com/x.git", VERCEL_GIT_REPO_OWNER: "a", VERCEL_GIT_REPO_SLUG: "b" }),
      "https://example.com/x.git",
    );
  });

  it("derives github URL from VERCEL_GIT_* vars", () => {
    assert.equal(
      resolveRepoUrl({ VERCEL_GIT_REPO_OWNER: "Blazity", VERCEL_GIT_REPO_SLUG: "my-fork", VERCEL_GIT_PROVIDER: "github" }),
      "https://github.com/Blazity/my-fork.git",
    );
  });

  it("falls back to upstream default when no git env present", () => {
    assert.match(resolveRepoUrl({}), /\/Blazity\/pre-sales-agent\.git$/);
  });
});

describe("resolveRepoRevision", () => {
  it("prefers AGENT_REPO_REVISION, then commit SHA, then ref, then main", () => {
    assert.equal(resolveRepoRevision({ AGENT_REPO_REVISION: "feat", VERCEL_GIT_COMMIT_SHA: "abc" }), "feat");
    assert.equal(resolveRepoRevision({ VERCEL_GIT_COMMIT_SHA: "abc", VERCEL_GIT_COMMIT_REF: "ref" }), "abc");
    assert.equal(resolveRepoRevision({ VERCEL_GIT_COMMIT_REF: "ref" }), "ref");
    assert.equal(resolveRepoRevision({ VERCEL_GIT_COMMIT_SHA: "abc" }), "abc");
    assert.equal(resolveRepoRevision({}), "main");
  });
});

describe("collectForwardedEnv", () => {
  it("forwards known keys, drops empty/unrelated, pins workspace dir", () => {
    const out = collectForwardedEnv({
      ANTHROPIC_API_KEY: "sk-ant",
      VOYAGE_API_KEY: "",
      PINECONE_API_KEY: "pc-key",
      AGENT_WORKSPACE_DIR: "/tmp/host-workspace",
      UNRELATED: "should-not-leak",
    });
    assert.equal(out.ANTHROPIC_API_KEY, "sk-ant");
    assert.equal(out.PINECONE_API_KEY, "pc-key");
    assert.equal(out.AGENT_WORKSPACE_DIR, "/vercel/sandbox/workspace");
    assert.equal(out.VOYAGE_API_KEY, undefined);
    assert.equal(out.UNRELATED, undefined);
  });
});

describe("sandbox labels and diagnostics", () => {
  it("builds a short readable label with a compact hash", () => {
    const label = buildSandboxLabel(makeJob({
      jobId: "est_1778072404569",
      rfpText: "Build a customer portal for quote approvals and invoice history.",
    }));
    assert.match(label, /^build-a-customer-portal-for-[a-f0-9]{6}$/);
    assert.ok(label.length <= 35);
  });

  it("does not emit low-value heartbeat polling logs", () => {
    const currentFile = fileURLToPath(import.meta.url);
    const runtimeDir = path.dirname(currentFile);
    const sandboxSource = fs.readFileSync(path.join(runtimeDir, "sandbox.ts"), "utf-8");
    const runnerSource = fs.readFileSync(path.join(runtimeDir, "../../scripts/run-orchestrator-in-sandbox.ts"), "utf-8");

    assert.ok(!sandboxSource.includes("Awaiting orchestrator events"));
    assert.ok(!runnerSource.includes("Orchestrator process heartbeat"));
  });
});

interface FakeSandboxOptions {
  files?: Map<string, Buffer>;
}

function makeJob(overrides: Partial<EstimationJob> = {}): EstimationJob {
  return {
    jobId: "est_test",
    channelId: "C123",
    threadTs: "1700000000.0001",
    rfpText: "Build a marketing site that converts.",
    ...overrides,
  };
}

interface FakeSandboxOptionsExt extends FakeSandboxOptions {
  /** Override the configured lifetime in ms. Defaults to 5h. */
  timeoutMs?: number;
  /** Override the createdAt offset (ms ago). Defaults to "just now". */
  ageMs?: number;
}

function makeFakeSandbox(opts: FakeSandboxOptionsExt = {}) {
  const files = opts.files ?? new Map<string, Buffer>();
  const calls: Array<{ method: string; args: unknown }> = [];
  const sandbox = {
    sandboxId: "sb_fake_123",
    timeout: opts.timeoutMs ?? 5 * 60 * 60 * 1000,
    createdAt: new Date(Date.now() - (opts.ageMs ?? 0)),
    fs: {
      async mkdir(path: string, _options?: unknown) {
        calls.push({ method: "fs.mkdir", args: { path } });
      },
      async writeFile(path: string, content: string, _encoding?: string) {
        files.set(path, Buffer.from(content, "utf8"));
        calls.push({ method: "fs.writeFile", args: { path, length: content.length } });
      },
    },
    async runCommand(params: { cmd: string; args?: string[]; detached?: boolean }) {
      calls.push({ method: "runCommand", args: params });
      // Detached commands return a Command-like; blocking commands a CommandFinished-like.
      if (params.detached) {
        return { cmdId: "cmd_fake", logs: async function* () {}, wait: async () => ({ exitCode: 0 }) } as unknown as Command;
      }
      return {
        exitCode: 0,
        async stderr() { return ""; },
        async stdout() { return ""; },
      };
    },
    async readFileToBuffer({ path }: { path: string }) {
      return files.get(path) ?? null;
    },
    async extendTimeout(_ms: number) {
      calls.push({ method: "extendTimeout", args: _ms });
    },
    async stop() {
      calls.push({ method: "stop", args: null });
      return sandbox;
    },
  };
  return { sandbox, files, calls };
}

function makeFakeCommand(opts: { exitCode?: number; stderr?: string; waitDelay?: number } = {}) {
  return {
    cmdId: "cmd_fake",
    // wait() never resolves by default, so the polling loop is what ends the test.
    // Set waitDelay > 0 to simulate process exit after N ms.
    wait: () => new Promise((resolve) => {
      if (typeof opts.waitDelay === "number") {
        setTimeout(() => resolve({ exitCode: opts.exitCode ?? 0 }), opts.waitDelay);
      }
      // else: never resolves
    }),
    async stderr() { return opts.stderr ?? ""; },
  };
}

function makeRecordingReporter() {
  const events: Array<{ kind: string; payload: unknown }> = [];
  const reporter: WorkflowReporter = {
    async progress(event) { events.push({ kind: "progress", payload: event }); },
    async log(event) { events.push({ kind: "log", payload: event }); },
    async system(message, data) { events.push({ kind: "system", payload: { message, data } }); },
    async agentText(text) { events.push({ kind: "agent_text", payload: { textLength: text.length } }); },
    async toolCall(name, args) { events.push({ kind: "tool_call", payload: { name, args } }); },
    async toolResult(name, result) { events.push({ kind: "tool_result", payload: { name, length: result.length } }); },
  };
  return { reporter, events };
}

describe("bootSandboxForJob", () => {
  it("creates from snapshot and skips npm ci / build when snapshotId is set", async () => {
    const fake = makeFakeSandbox();
    const createCalls: Array<Record<string, unknown>> = [];
    const result = await bootSandboxForJob({
      job: makeJob(),
      env: {},
      snapshotId: "snap_abc123",
      createSandbox: (async (params: Record<string, unknown>) => {
        createCalls.push(params);
        return fake.sandbox as unknown as Sandbox;
      }) as unknown as typeof import("@vercel/sandbox").Sandbox.create,
    });

    assert.equal(createCalls.length, 1);
    const source = (createCalls[0] as { source: { type: string; snapshotId: string } }).source;
    assert.equal(source.type, "snapshot");
    assert.equal(source.snapshotId, "snap_abc123");
    assert.equal((createCalls[0] as { runtime?: string }).runtime, undefined, "snapshot create must not pass runtime — locked by snapshot");
    assert.match((createCalls[0] as { env?: Record<string, string> }).env?.AGENT_SANDBOX_LABEL ?? "", /^build-a-marketing-site-that-[a-f0-9]{6}$/);

    const npmCalls = fake.calls.filter((c) => c.method === "runCommand" && (c.args as { cmd: string }).cmd === "npm");
    assert.equal(npmCalls.length, 0, "snapshot path must not run npm ci or npm run build");

    const detached = fake.calls.find((c) => c.method === "runCommand" && (c.args as { detached?: boolean }).detached === true);
    assert.ok(detached, "must start the orchestrator detached");

    assert.ok(result.sandbox);
    assert.ok(result.command);
  });

  it("creates from git and runs npm ci + build when snapshotId is null", async () => {
    const fake = makeFakeSandbox();
    const createCalls: Array<Record<string, unknown>> = [];
    await bootSandboxForJob({
      job: makeJob(),
      env: { VERCEL_GIT_REPO_OWNER: "Blazity", VERCEL_GIT_REPO_SLUG: "fork", VERCEL_GIT_COMMIT_REF: "feat" },
      snapshotId: null,
      createSandbox: (async (params: Record<string, unknown>) => {
        createCalls.push(params);
        return fake.sandbox as unknown as Sandbox;
      }) as unknown as typeof import("@vercel/sandbox").Sandbox.create,
    });

    assert.equal(createCalls.length, 1);
    const source = (createCalls[0] as { source: { type: string; url?: string } }).source;
    assert.equal(source.type, "git");
    assert.match(source.url ?? "", /Blazity\/fork\.git$/);

    const ciCall = fake.calls.find((c) => c.method === "runCommand" && (c.args as { args?: string[] }).args?.[0] === "ci");
    const buildCall = fake.calls.find((c) => c.method === "runCommand" && (c.args as { args?: string[] }).args?.[0] === "run");
    assert.match((createCalls[0] as { env?: Record<string, string> }).env?.AGENT_SANDBOX_LABEL ?? "", /^build-a-marketing-site-that-[a-f0-9]{6}$/);
    assert.ok(ciCall, "git path must run npm ci");
    assert.ok(buildCall, "git path must run npm run build");
  });

  it("passes private GitHub repo tokens as x-access-token credentials", async () => {
    const fake = makeFakeSandbox();
    const createCalls: Array<Record<string, unknown>> = [];
    await bootSandboxForJob({
      job: makeJob(),
      env: {
        VERCEL_GIT_REPO_OWNER: "Blazity",
        VERCEL_GIT_REPO_SLUG: "private-fork",
        VERCEL_GIT_COMMIT_SHA: "abc123",
        AGENT_REPO_TOKEN: "github_pat_test",
      },
      snapshotId: null,
      createSandbox: (async (params: Record<string, unknown>) => {
        createCalls.push(params);
        return fake.sandbox as unknown as Sandbox;
      }) as unknown as typeof import("@vercel/sandbox").Sandbox.create,
    });

    const source = (createCalls[0] as {
      source: { type: string; username?: string; password?: string; revision?: string };
    }).source;
    assert.equal(source.type, "git");
    assert.equal(source.username, "x-access-token");
    assert.equal(source.password, "github_pat_test");
    assert.equal(source.revision, "abc123");
  });
});

describe("streamOrchestratorEvents", () => {
  it("dispatches events from byte offset and stops when result.json is present", async () => {
    const eventsLog = [
      JSON.stringify({ kind: "progress", event: { status: "running", step: 1 } }),
      JSON.stringify({ kind: "log", event: { level: "info", type: "system", message: "hello" } }),
      "",
    ].join("\n");
    const earlyBytes = Buffer.from(eventsLog.slice(0, 60), "utf8"); // first attempt: partial
    const fullBytes = Buffer.from(eventsLog, "utf8");
    const result = JSON.stringify({ status: "completed" });

    const files = new Map<string, Buffer>();
    files.set("/vercel/sandbox/.agent/events.jsonl", earlyBytes);

    const fake = makeFakeSandbox({ files });
    let polls = 0;
    fake.sandbox.readFileToBuffer = async ({ path }: { path: string }) => {
      polls++;
      if (path === "/vercel/sandbox/.agent/events.jsonl") {
        // Reveal full bytes after the first poll so we exercise the resume path.
        return polls > 1 ? fullBytes : earlyBytes;
      }
      if (path === "/vercel/sandbox/.agent/result.json") {
        // Result appears after 2 polls.
        return polls > 2 ? Buffer.from(result, "utf8") : null;
      }
      return null;
    };

    const { reporter, events } = makeRecordingReporter();
    const out = await streamOrchestratorEvents({
      sandbox: fake.sandbox as unknown as Sandbox,
      command: makeFakeCommand() as unknown as Command,
      reporter,
      offset: 0,
      pollIntervalMs: 1,
    });

    assert.equal(out.status, "completed");
    assert.ok(out.offset > 0, "offset must advance past the bytes we read");
    assert.ok(events.some((e) => e.kind === "progress"), "progress event must be dispatched");
    assert.ok(events.some((e) => e.kind === "log"), "log event must be dispatched");
    // Fresh sandbox has plenty of headroom; extendTimeout must NOT be called yet.
    assert.equal(
      fake.calls.filter((c) => c.method === "extendTimeout").length,
      0,
      "must skip extend when remaining lifetime is comfortably above the threshold",
    );
  });

  it("fails fast when the orchestrator process exits without writing result.json", async () => {
    const fake = makeFakeSandbox();
    // events.jsonl and result.json both empty — simulate a hard crash before the catch in run-orchestrator-in-sandbox.ts could write result.
    fake.sandbox.readFileToBuffer = async () => null;

    const { reporter } = makeRecordingReporter();
    const out = await streamOrchestratorEvents({
      sandbox: fake.sandbox as unknown as Sandbox,
      command: makeFakeCommand({ exitCode: 137, stderr: "Killed (OOM)\n", waitDelay: 5 }) as unknown as Command,
      reporter,
      offset: 0,
      pollIntervalMs: 1,
    });

    assert.equal(out.status, "failed");
    assert.match(out.error ?? "", /exited \(code 137\)/);
    assert.match(out.error ?? "", /Killed \(OOM\)/);
  });

  it("extends sandbox timeout when remaining lifetime is below the threshold", async () => {
    const result = Buffer.from(JSON.stringify({ status: "completed" }), "utf8");
    // Sandbox created 4h55m ago with a 5h timeout — only 5 min left.
    const fake = makeFakeSandbox({ timeoutMs: 5 * 60 * 60 * 1000, ageMs: (5 * 60 - 5) * 60 * 1000 });
    fake.sandbox.readFileToBuffer = async ({ path }: { path: string }) => {
      if (path === "/vercel/sandbox/.agent/result.json") return result;
      return null;
    };

    const { reporter } = makeRecordingReporter();
    await streamOrchestratorEvents({
      sandbox: fake.sandbox as unknown as Sandbox,
      command: makeFakeCommand() as unknown as Command,
      reporter,
      pollIntervalMs: 1,
    });

    assert.equal(
      fake.calls.filter((c) => c.method === "extendTimeout").length,
      1,
      "must extend when remaining lifetime is below the 30 min threshold",
    );
  });

  it("skips events already replayed when resuming from a non-zero offset", async () => {
    const lineA = JSON.stringify({ kind: "progress", event: { status: "running", step: 1 } });
    const lineB = JSON.stringify({ kind: "progress", event: { status: "running", step: 2 } });
    const fullLog = `${lineA}\n${lineB}\n`;
    const fullBytes = Buffer.from(fullLog, "utf8");
    const result = Buffer.from(JSON.stringify({ status: "completed" }), "utf8");

    const fake = makeFakeSandbox();
    fake.sandbox.readFileToBuffer = async ({ path }: { path: string }) => {
      if (path === "/vercel/sandbox/.agent/events.jsonl") return fullBytes;
      if (path === "/vercel/sandbox/.agent/result.json") return result;
      return null;
    };

    const { reporter, events } = makeRecordingReporter();
    const skipBytes = Buffer.byteLength(`${lineA}\n`, "utf8");
    const out = await streamOrchestratorEvents({
      sandbox: fake.sandbox as unknown as Sandbox,
      command: makeFakeCommand() as unknown as Command,
      reporter,
      offset: skipBytes,
      pollIntervalMs: 1,
    });

    const progresses = events.filter((e) => e.kind === "progress");
    assert.equal(progresses.length, 1, "exactly one progress event should be dispatched (the not-yet-replayed one)");
    assert.deepEqual((progresses[0].payload as { step: number }).step, 2);
    assert.equal(out.status, "completed");
  });
});
