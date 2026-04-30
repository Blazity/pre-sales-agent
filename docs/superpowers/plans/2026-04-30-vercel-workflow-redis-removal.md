# Vercel Workflow Redis Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Redis, BullMQ, Express fallback, and the custom admin dashboard from the OSS starter, then run estimation jobs through Vercel Workflow observability.

**Architecture:** Slack HTTP handlers remain in `api/slack/events.ts`, but they start a Vercel Workflow run instead of enqueueing a custom queue job. The current agent orchestration stays intact and receives a reporter interface that writes structured events to Vercel logs, which Workflow records alongside step status, retries, and failures.

**Tech Stack:** Node.js, TypeScript ESM, Vercel Functions, Vercel Workflow SDK (`workflow`), Claude Agent SDK, MCP servers, Slack Bolt, Google Workspace, Pinecone, Voyage.

---

## File Structure

- Create `src/lib/workflow-reporter.ts`: reporter interface and console/Vercel-log implementation.
- Create `src/lib/workflow-reporter.test.ts`: unit tests for event formatting.
- Create `workflows/estimation.ts`: Vercel Workflow function and step wrappers.
- Create `src/workflows/launcher.ts`: builds job payloads and starts workflow runs.
- Create `src/workflows/launcher.test.ts`: tests job payload/run metadata handling with a stub starter.
- Modify `src/agents/orchestrator.ts`: remove Redis imports and use `WorkflowReporter`.
- Modify `src/slack/bolt-app.ts`: start workflows instead of queue jobs.
- Modify `src/slack/bolt-app.test.ts`: update mocked launcher assertions.
- Modify `src/lib/env.ts` and `src/lib/env.test.ts`: remove `REDIS_URL`.
- Modify `api/health.ts`: remove BullMQ/Redis queue provider reporting.
- Modify `vercel.json`: remove custom queue trigger.
- Modify `package.json` and `package-lock.json`: add `workflow`; remove `bullmq` and `ioredis`; update scripts.
- Delete `api/queues/estimations.ts`.
- Delete `src/queue/producer.ts`, `src/queue/producer.test.ts`, and `src/queue/worker.ts`.
- Delete `src/lib/redis.ts` and `src/lib/job-logger.ts`.
- Delete `src/index.ts`.
- Delete `src/admin/auth.ts`, `src/admin/auth.test.ts`, and `src/admin/routes.ts`.
- Delete `src/lib/job-registry.ts` and `src/lib/job-registry.test.ts`.
- Delete `scripts/check-jobs.ts`.
- Modify `.env.example`, `README.md`, `docs/setup.md`, `docs/deployment/vercel.md`, `docs/configuration.md`, `docs/architecture.md`, `docs/demo.md`, and `docs/phase-0-notes.md`.

---

### Task 1: Add Workflow SDK And Remove Queue Package Surface

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install Workflow SDK and remove Redis/BullMQ packages**

Run:

```bash
npm install workflow
npm uninstall bullmq ioredis
```

Expected:

```text
added ... workflow ...
removed ... bullmq ...
removed ... ioredis ...
```

- [ ] **Step 2: Update scripts in `package.json`**

Change the scripts block to remove the Express fallback and keep Vercel-shaped local development:

```json
{
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "dev": "npx vercel dev",
    "dev:vercel": "npx vercel dev",
    "seed": "tsx scripts/seed-knowledge-base.ts",
    "check:vercel-sandbox": "tsx scripts/check-vercel-sandbox.ts",
    "test": "tsx --test src/**/*.test.ts",
    "audit:high": "npm audit --audit-level=high",
    "scan:secrets": "tsx scripts/scan-secrets.ts",
    "check:mcp-isolation": "rg \"from ['\\\"]\\.\\./\" src/mcp-servers && exit 1 || exit 0"
  }
}
```

- [ ] **Step 3: Verify package metadata**

Run:

```bash
node -e "const p=require('./package.json'); console.log({workflow:p.dependencies.workflow, bullmq:p.dependencies.bullmq, ioredis:p.dependencies.ioredis, dev:p.scripts.dev})"
```

Expected:

```text
{ workflow: '<installed-version>', bullmq: undefined, ioredis: undefined, dev: 'npx vercel dev' }
```

- [ ] **Step 4: Commit package changes**

```bash
git add package.json package-lock.json
git commit -m "chore: add Workflow SDK"
```

---

### Task 2: Add Reporter Boundary

**Files:**
- Create: `src/lib/workflow-reporter.ts`
- Create: `src/lib/workflow-reporter.test.ts`

- [ ] **Step 1: Write reporter tests**

Create `src/lib/workflow-reporter.test.ts`:

```ts
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
      tool: "docs_create_document",
    });
  });

  it("logs through the provided sink", async () => {
    const events: unknown[] = [];
    const reporter = createWorkflowReporter("est_123", {
      info: (_message, data) => events.push(data),
      warn: (_message, data) => events.push(data),
      error: (_message, data) => events.push(data),
      debug: (_message, data) => events.push(data),
    });

    await reporter.progress({ status: "completed" });
    await reporter.system("Job completed", { turns: 12 });

    assert.deepEqual(events, [
      { event: "workflow.progress", jobId: "est_123", status: "completed" },
      { event: "workflow.log", jobId: "est_123", level: "info", type: "system", message: "Job completed", turns: 12 },
    ]);
  });
});
```

- [ ] **Step 2: Run failing reporter tests**

Run:

```bash
npm test -- src/lib/workflow-reporter.test.ts
```

Expected:

```text
Error: Cannot find module './workflow-reporter.js'
```

- [ ] **Step 3: Implement reporter**

Create `src/lib/workflow-reporter.ts`:

```ts
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

type LoggerSink = Pick<typeof logger, "info" | "warn" | "error" | "debug">;

type ReporterEvent =
  | ({ kind: "progress"; jobId: string } & WorkflowProgressEvent)
  | ({ kind: "log"; jobId: string } & WorkflowLogEvent);

export function formatReporterEvent(event: ReporterEvent): Record<string, unknown> {
  if (event.kind === "progress") {
    const { kind: _kind, ...rest } = event;
    return { event: "workflow.progress", ...rest };
  }

  const { kind: _kind, data, ...rest } = event;
  return { event: "workflow.log", ...rest, ...(data ?? {}) };
}

export function createWorkflowReporter(jobId: string, sink: LoggerSink = logger): WorkflowReporter {
  return {
    async progress(event) {
      sink.info("Workflow progress", formatReporterEvent({ kind: "progress", jobId, ...event }));
    },

    async log(event) {
      sink[event.level](event.message, formatReporterEvent({ kind: "log", jobId, ...event }));
    },

    system(message, data) {
      return this.log({ level: "info", type: "system", message, data });
    },

    agentText(text) {
      return this.log({
        level: "info",
        type: "agent_text",
        message: text.slice(0, 500),
      });
    },

    toolCall(name, args) {
      const argsStr = typeof args === "string" ? args : JSON.stringify(args);
      return this.log({
        level: "info",
        type: "tool_call",
        message: `${name}(${argsStr.slice(0, 300)})`,
        data: { tool: name },
      });
    },

    toolResult(name, result) {
      return this.log({
        level: "info",
        type: "tool_result",
        message: `${name} -> ${result.slice(0, 500)}`,
        data: { tool: name },
      });
    },
  };
}
```

- [ ] **Step 4: Run reporter tests**

Run:

```bash
npm test -- src/lib/workflow-reporter.test.ts
```

Expected:

```text
pass 3
fail 0
```

- [ ] **Step 5: Commit reporter boundary**

```bash
git add src/lib/workflow-reporter.ts src/lib/workflow-reporter.test.ts
git commit -m "feat: add workflow reporter"
```

---

### Task 3: Remove Redis From Orchestrator

**Files:**
- Modify: `src/agents/orchestrator.ts`
- Modify: `src/agents/orchestrator.test.ts`
- Delete later: `src/lib/job-logger.ts`, `src/lib/redis.ts`

- [ ] **Step 1: Update orchestrator imports**

In `src/agents/orchestrator.ts`, remove:

```ts
import { getRedis } from "../lib/redis.js";
import { registerJob, unregisterJob } from "../lib/job-registry.js";
import { createJobLogger } from "../lib/job-logger.js";
```

Add:

```ts
import { createWorkflowReporter, type WorkflowReporter } from "../lib/workflow-reporter.js";
```

- [ ] **Step 2: Change function signature**

Replace:

```ts
export async function runEstimationWorkflow(job: EstimationJob): Promise<void> {
```

With:

```ts
export async function runEstimationWorkflow(
  job: EstimationJob,
  reporter: WorkflowReporter = createWorkflowReporter(job.jobId ?? "unknown")
): Promise<void> {
```

- [ ] **Step 3: Remove Redis/controller setup**

Replace:

```ts
  const redis = getRedis();
  const controller = registerJob(jobId);
  const jobLog = createJobLogger(jobId, redis);
```

With:

```ts
  const controller = new AbortController();
  await reporter.system("Job started", {
    estimationName: (job.rfpText ?? job.messageText ?? "Untitled").slice(0, 60),
  });
```

- [ ] **Step 4: Replace progress writes**

Replace each `redis.hset(progressKey(jobId), ...)` with `reporter.progress(...)`.

Examples:

```ts
await reporter.progress({
  turnsCompleted: turns,
});
```

```ts
await reporter.progress({
  step: currentStep,
  stepName: STEP_NAMES[currentStep],
});
```

```ts
await reporter.progress({
  status: "completed",
});
```

```ts
await reporter.progress({
  status: "failed",
});
```

- [ ] **Step 5: Replace job log calls**

Replace:

```ts
await jobLog.agentText(block.text);
await jobLog.toolCall(block.name, block.input);
await jobLog.system(`Step changed to ${STEP_NAMES[currentStep]}`);
await jobLog.toolResult(block.tool_use_id ?? "unknown", text);
await jobLog.system("Job completed", { turns });
await jobLog.system("Job failed", { error: err instanceof Error ? err.message : String(err) });
```

With:

```ts
await reporter.agentText(block.text);
await reporter.toolCall(block.name, block.input);
await reporter.system(`Step changed to ${STEP_NAMES[currentStep]}`);
await reporter.toolResult(block.tool_use_id ?? "unknown", text);
await reporter.system("Job completed", { turns });
await reporter.system("Job failed", { error: err instanceof Error ? err.message : String(err) });
```

- [ ] **Step 6: Remove cancellation branch tied to admin kill**

Keep the `AbortController` for SDK compatibility, but remove admin-kill status semantics. Replace aborted handling with a generic cancellation log:

```ts
if (controller.signal.aborted) {
  await reporter.progress({ status: "cancelled" });
  await reporter.system("Job cancelled");
  timer.end({ turns, cancelled: true });
  return;
}
```

At the end of the function, remove:

```ts
  } finally {
    unregisterJob(jobId);
  }
```

- [ ] **Step 7: Remove dead helper**

Delete the local `progressKey(jobId)` helper from `src/agents/orchestrator.ts`.

- [ ] **Step 8: Typecheck orchestrator**

Run:

```bash
npm run typecheck
```

Expected:

```text
tsc --noEmit
```

with no errors from `src/agents/orchestrator.ts`.

- [ ] **Step 9: Commit orchestrator migration**

```bash
git add src/agents/orchestrator.ts src/agents/orchestrator.test.ts
git commit -m "refactor: report workflow progress without Redis"
```

---

### Task 4: Add Vercel Workflow And Launcher

**Files:**
- Create: `workflows/estimation.ts`
- Create: `src/workflows/launcher.ts`
- Create: `src/workflows/launcher.test.ts`

- [ ] **Step 1: Write launcher tests**

Create `src/workflows/launcher.test.ts`:

```ts
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
```

- [ ] **Step 2: Run failing launcher tests**

Run:

```bash
npm test -- src/workflows/launcher.test.ts
```

Expected:

```text
Error: Cannot find module './launcher.js'
```

- [ ] **Step 3: Add workflow function**

Create `workflows/estimation.ts`:

```ts
import type { EstimationJob } from "../src/agents/orchestrator.js";

export interface EstimationWorkflowResult {
  jobId: string;
  status: "completed";
}

export async function estimationWorkflow(job: EstimationJob): Promise<EstimationWorkflowResult> {
  "use workflow";

  await runAgentStep(job);
  return { jobId: job.jobId, status: "completed" };
}

async function runAgentStep(job: EstimationJob): Promise<void> {
  "use step";

  const { runEstimationWorkflow } = await import("../src/agents/orchestrator.js");
  const { createWorkflowReporter } = await import("../src/lib/workflow-reporter.js");
  const reporter = createWorkflowReporter(job.jobId);

  try {
    await reporter.progress({ status: "running", step: 0, stepName: "Initializing", turnsCompleted: 0 });
    await runEstimationWorkflow(job, reporter);
  } catch (err) {
    await reporter.progress({ status: "failed" });
    await reporter.system("Workflow step failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
```

- [ ] **Step 4: Add workflow launcher**

Create `src/workflows/launcher.ts`:

```ts
import { start } from "workflow/runtime";
import { estimationWorkflow } from "../../workflows/estimation.js";
import type { EstimationJob } from "../agents/orchestrator.js";

type WorkflowStart = (
  workflow: typeof estimationWorkflow,
  args: [EstimationJob]
) => Promise<{ runId: string }>;

export function buildEstimationWorkflowPayload(
  job: Omit<EstimationJob, "jobId"> | EstimationJob,
  now = Date.now()
): EstimationJob {
  return {
    ...job,
    jobId: "jobId" in job && job.jobId ? job.jobId : `est_${now}`,
  };
}

export function createEstimationWorkflowStarter(startWorkflow: WorkflowStart = start) {
  return async function startEstimationWorkflow(
    job: Omit<EstimationJob, "jobId"> | EstimationJob,
    now = Date.now()
  ): Promise<{ jobId: string; runId: string }> {
    const payload = buildEstimationWorkflowPayload(job, now);
    const run = await startWorkflow(estimationWorkflow, [payload]);
    return { jobId: payload.jobId, runId: run.runId };
  };
}

export const startEstimationWorkflow = createEstimationWorkflowStarter();
```

- [ ] **Step 5: Run launcher tests**

Run:

```bash
npm test -- src/workflows/launcher.test.ts
```

Expected:

```text
pass 3
fail 0
```

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
tsc --noEmit
```

with no Workflow import or type errors. If `workflow/runtime` is not the correct import for the installed SDK version, switch only the import to the SDK-supported start entrypoint and keep the same launcher API.

- [ ] **Step 7: Commit workflow launcher**

```bash
git add workflows/estimation.ts src/workflows/launcher.ts src/workflows/launcher.test.ts
git commit -m "feat: start estimations with Vercel Workflow"
```

---

### Task 5: Route Slack To Workflow

**Files:**
- Modify: `src/slack/bolt-app.ts`
- Modify: `src/slack/bolt-app.test.ts`

- [ ] **Step 1: Replace queue import**

In `src/slack/bolt-app.ts`, replace:

```ts
import { enqueueEstimation } from "../queue/producer.js";
```

With:

```ts
import { startEstimationWorkflow } from "../workflows/launcher.js";
```

- [ ] **Step 2: Replace payload type**

Replace:

```ts
let jobPayload: Parameters<typeof enqueueEstimation>[0];
```

With:

```ts
let jobPayload: Parameters<typeof startEstimationWorkflow>[0];
```

- [ ] **Step 3: Replace message command enqueue call**

Replace:

```ts
const jobId = await enqueueEstimation(jobPayload);
logger.info("Estimation job enqueued", {
  jobId,
  channelId: msg.channel,
  threadTs: msg.ts,
});
```

With:

```ts
const { jobId, runId } = await startEstimationWorkflow(jobPayload);
logger.info("Estimation workflow started", {
  jobId,
  runId,
  channelId: msg.channel,
  threadTs: msg.ts,
});
```

- [ ] **Step 4: Replace slash command enqueue call**

Replace the slash command `enqueueEstimation(...)` block with:

```ts
const { jobId, runId } = await startEstimationWorkflow({
  rfpText: text,
  channelId: command.channel_id,
  threadTs: response.ts ?? command.trigger_id,
});

logger.info("Estimation workflow started via slash command", {
  jobId,
  runId,
  channelId: command.channel_id,
});
```

- [ ] **Step 5: Update tests**

In `src/slack/bolt-app.test.ts`, replace queue module mocks with workflow launcher mocks. The mocked function should return:

```ts
{ jobId: "est_test", runId: "wrun_test" }
```

Assert logs or payload behavior against `startEstimationWorkflow`, not `enqueueEstimation`.

- [ ] **Step 6: Run Slack tests**

Run:

```bash
npm test -- src/slack/bolt-app.test.ts
```

Expected:

```text
fail 0
```

- [ ] **Step 7: Commit Slack workflow routing**

```bash
git add src/slack/bolt-app.ts src/slack/bolt-app.test.ts
git commit -m "refactor: route Slack estimations to Workflow"
```

---

### Task 6: Delete Redis, BullMQ, Express, And Admin Runtime

**Files:**
- Delete: `api/queues/estimations.ts`
- Delete: `src/queue/producer.ts`
- Delete: `src/queue/producer.test.ts`
- Delete: `src/queue/worker.ts`
- Delete: `src/lib/redis.ts`
- Delete: `src/lib/job-logger.ts`
- Delete: `src/lib/job-registry.ts`
- Delete: `src/lib/job-registry.test.ts`
- Delete: `src/index.ts`
- Delete: `src/admin/auth.ts`
- Delete: `src/admin/auth.test.ts`
- Delete: `src/admin/routes.ts`
- Delete: `scripts/check-jobs.ts`
- Modify: `api/health.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Delete files**

Run:

```bash
rm api/queues/estimations.ts \
  src/queue/producer.ts \
  src/queue/producer.test.ts \
  src/queue/worker.ts \
  src/lib/redis.ts \
  src/lib/job-logger.ts \
  src/lib/job-registry.ts \
  src/lib/job-registry.test.ts \
  src/index.ts \
  src/admin/auth.ts \
  src/admin/auth.test.ts \
  src/admin/routes.ts \
  scripts/check-jobs.ts
```

- [ ] **Step 2: Simplify `api/health.ts`**

Replace the response body with:

```ts
export default function handler(_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) {
  res.status(200).json({
    status: "ok",
    runtime: "vercel",
    workflow: "enabled",
  });
}
```

Keep the existing handler shape if the file already uses Vercel request/response types; only the JSON body matters.

- [ ] **Step 3: Remove queue trigger from `vercel.json`**

Replace `vercel.json` with:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json"
}
```

- [ ] **Step 4: Search for deleted imports**

Run:

```bash
rg -n "queue/producer|queue/worker|getRedis|createJobLogger|job-registry|BullMQ|ioredis|bullmq|REDIS_URL|/admin|ADMIN_USER|ADMIN_PASS|check-jobs|api/queues" src api scripts docs README.md package.json .env.example vercel.json
```

Expected:

```text
```

No matches in runtime code. Docs may still match before Task 7; do not commit until runtime code has no stale imports.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
tsc --noEmit
```

with no references to deleted modules.

- [ ] **Step 6: Commit runtime deletion**

```bash
git add -A api src scripts vercel.json
git commit -m "refactor: remove Redis and BullMQ runtime"
```

---

### Task 7: Remove Redis From Env And Docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/setup.md`
- Modify: `docs/deployment/vercel.md`
- Modify: `docs/configuration.md`
- Modify: `docs/architecture.md`
- Modify: `docs/demo.md`
- Modify: `docs/phase-0-notes.md`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`

- [ ] **Step 1: Remove `REDIS_URL` from env loader**

In `src/lib/env.ts`, remove:

```ts
REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
```

- [ ] **Step 2: Update env tests**

In `src/lib/env.test.ts`, remove the default and override assertions for `REDIS_URL`.

Delete tests named:

```ts
it("respects REDIS_URL override", () => {
  const env = loadEnv({ ...FULL_ENV, REDIS_URL: "redis://upstash:6379" });
  assert.equal(env.REDIS_URL, "redis://upstash:6379");
});
```

Remove `REDIS_URL` from any expected env object.

- [ ] **Step 3: Update README Deploy Button**

Remove `REDIS_URL` from the `env=` query string and change the description from:

```text
Required provider keys and project resources for Slack, Claude, Google Workspace, Pinecone, Voyage, and Redis.
```

To:

```text
Required provider keys and project resources for Slack, Claude, Google Workspace, Pinecone, and Voyage.
```

- [ ] **Step 4: Update `.env.example`**

Delete:

```text
REDIS_URL=redis://localhost:6379
```

Delete the optional admin panel block if it only supports the removed `/admin` dashboard:

```text
ADMIN_USER=
ADMIN_PASS=
ADMIN_ALLOWED_IPS=
```

- [ ] **Step 5: Update docs**

Make these replacements:

```text
Redis, and Vercel -> Vercel
Redis-style state -> Vercel Workflow observability
BullMQ remains available -> Vercel Workflow is the supported local/deployed execution model
self-hosted fallback -> removed from the OSS starter
```

In `docs/deployment/vercel.md`, the required env table must contain exactly:

```text
ANTHROPIC_API_KEY
SLACK_BOT_TOKEN
SLACK_SIGNING_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GDRIVE_ROOT_FOLDER_ID
GDRIVE_TEMPLATE_ID
GSHEETS_TEMPLATE_ID
PINECONE_API_KEY
VOYAGE_API_KEY
```

- [ ] **Step 6: Verify Deploy Button env list**

Run:

```bash
node - <<'NODE'
const fs = require('node:fs');
const readme = fs.readFileSync('README.md', 'utf8');
const match = readme.match(/https:\/\/vercel\.com\/new\/clone\?[^)]+/);
if (!match) throw new Error('Deploy URL not found');
const url = new URL(match[0]);
const envs = url.searchParams.get('env').split(',');
const expected = [
  'ANTHROPIC_API_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'GDRIVE_ROOT_FOLDER_ID',
  'GDRIVE_TEMPLATE_ID',
  'GSHEETS_TEMPLATE_ID',
  'PINECONE_API_KEY',
  'VOYAGE_API_KEY',
];
const missing = expected.filter((env) => !envs.includes(env));
const extra = envs.filter((env) => !expected.includes(env));
console.log(JSON.stringify({ envs, missing, extra, hasEnvDefaults: url.searchParams.has('envDefaults') }, null, 2));
if (missing.length || extra.length || url.searchParams.has('envDefaults')) process.exit(1);
NODE
```

Expected:

```json
{
  "envs": [
    "ANTHROPIC_API_KEY",
    "SLACK_BOT_TOKEN",
    "SLACK_SIGNING_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "GDRIVE_ROOT_FOLDER_ID",
    "GDRIVE_TEMPLATE_ID",
    "GSHEETS_TEMPLATE_ID",
    "PINECONE_API_KEY",
    "VOYAGE_API_KEY"
  ],
  "missing": [],
  "extra": [],
  "hasEnvDefaults": false
}
```

- [ ] **Step 7: Commit docs and env cleanup**

```bash
git add -A README.md .env.example docs src/lib/env.ts src/lib/env.test.ts
git commit -m "docs: remove Redis from Vercel setup"
```

---

### Task 8: Final Verification And Push

**Files:**
- All touched files

- [ ] **Step 1: Search for removed architecture**

Run:

```bash
rg -n "Redis|REDIS_URL|BullMQ|ioredis|bullmq|self-hosted|Express fallback|/admin|ADMIN_USER|ADMIN_PASS|check-jobs|api/queues" README.md docs src api scripts package.json .env.example vercel.json
```

Expected:

```text
```

No matches, except historical notes in the approved design/plan files are acceptable.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
tsc --noEmit
```

- [ ] **Step 3: Run tests**

Run:

```bash
npm test
```

Expected:

```text
fail 0
```

- [ ] **Step 4: Run security and architecture checks**

Run:

```bash
npm run scan:secrets
npm run check:mcp-isolation
npm run audit:high
```

Expected:

```text
No high-confidence secrets found.
found 0 vulnerabilities
```

`check:mcp-isolation` should exit with code 0 and no output.

- [ ] **Step 5: Check working tree and diff**

Run:

```bash
git status --short
git log --oneline -5
```

Expected:

```text
```

No uncommitted files, and recent commits for the workflow migration are visible.

- [ ] **Step 6: Push**

Run:

```bash
git push
```

Expected:

```text
main -> main
```

