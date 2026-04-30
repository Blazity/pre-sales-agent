# SPEC-012: Admin Panel

**Status:** Implemented
**Date:** 2026-02-27

---

# Admin Panel — Design

## Problem

No visibility into running estimation jobs. Checking status, reading logs, and killing jobs requires SSH into Railway, parsing stdout JSON, and running Redis CLI commands. This wastes time and tokens.

## Goal

A minimal admin panel showing:
- Active and recent jobs with name, step, elapsed time, status
- Live logs per job (auto-refreshing)
- Instant kill button that aborts the job and notifies the Slack thread

Behind IP allowlist + HTTP Basic Auth. Not indexable.

## Solution Overview

Server-rendered HTML mounted on the existing Express server. Redis for per-job state, logs, and cancellation signals. AbortController for instant job termination.

| Component | Implementation |
|-----------|---------------|
| Job state tracking | Redis hash per job, updated from orchestrator |
| Per-job logs | Redis list per job, pushed from orchestrator |
| Step detection | Parse agent tool calls in the `for await` loop |
| Job cancellation | AbortController per job + Redis flag + Slack notification |
| Admin UI | Server-rendered HTML, auto-refresh every 3s |
| Auth | IP allowlist + HTTP Basic Auth |

---

## 1. Job State Tracking

### Redis Hash

**Key:** `job:<jobId>:progress`
**TTL:** 24 hours

```typescript
interface JobProgress {
  step: number;           // 1-5
  stepName: string;       // "Analysis" | "Clarification" | "Offer" | "Presentation" | "Knowledge Base"
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;      // ISO timestamp
  lastActivityAt: string; // ISO timestamp
  turnsCompleted: number;
  channelId: string;
  threadTs: string;
  estimationName: string; // first ~60 chars of RFP text or messageText
}
```

### Step Detection

Inside the orchestrator's `for await (const message of query(...))` loop, inspect each message for tool calls:

| Tool Call | Step | Name |
|-----------|------|------|
| `search_similar_projects`, `search_case_studies` | 1 | Analysis |
| `wait_for_reply` | 2 | Clarification |
| `docs_create_document`, `docs_write_sections` | 3 | Offer |
| `create_presentation` | 4 | Presentation |
| `store_estimation` | 5 | Knowledge Base |

Detection logic: when a tool call is seen that maps to a higher step number than the current step, update the step. This handles cases where the agent skips steps (e.g., skips clarification).

### Write Path

**File:** `src/agents/orchestrator.ts`

At the start of `runEstimationWorkflow()`:
1. Create the progress hash in Redis with `status: "running"`, `step: 0`, `stepName: "Starting"`
2. Inside the `for await` loop, after each message: update `turnsCompleted`, `lastActivityAt`, and step if changed
3. After the loop: update `status: "completed"`
4. In the catch block: update `status: "failed"` or `status: "cancelled"`

### Redis Client

Create a shared Redis singleton in `src/lib/redis.ts`:

```typescript
import IORedis from "ioredis";
import { env } from "./env.js";

let client: IORedis | null = null;

export function getRedis(): IORedis {
  if (!client) {
    client = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return client;
}
```

Replace the inline `new IORedis()` calls in producer.ts and worker.ts with this singleton. Avoids multiple Redis connections.

---

## 2. Per-Job Log Capture

### Redis List

**Key:** `job:<jobId>:logs`
**TTL:** 24 hours
**Max entries:** 500 (enforced via LTRIM after each push)

### Log Entry Format

```typescript
interface JobLogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  type: "system" | "agent_text" | "tool_call" | "tool_result";
  message: string;
  data?: Record<string, unknown>;
}
```

### What Gets Logged

1. **System logs** (`type: "system"`) — orchestrator events: "Job started", "Step changed to Offer", "Job completed"
2. **Agent text** (`type: "agent_text"`) — the assistant's text content from each turn (truncated to 500 chars)
3. **Tool calls** (`type: "tool_call"`) — tool name + arguments (arguments truncated to 300 chars). This captures what MCP servers received.
4. **Tool results** (`type: "tool_result"`) — tool name + result content (truncated to 500 chars). This captures what MCP servers returned.

### Implementation

**File:** `src/lib/job-logger.ts`

```typescript
export function createJobLogger(jobId: string, redis: IORedis) {
  return {
    async log(entry: JobLogEntry) {
      // Write to stdout (existing behavior)
      logger.info(entry.message, { jobId, type: entry.type, ...entry.data });
      // Push to Redis
      await redis.rpush(`job:${jobId}:logs`, JSON.stringify(entry));
      await redis.ltrim(`job:${jobId}:logs`, -500, -1);
      await redis.expire(`job:${jobId}:logs`, 86400);
    },
    // Convenience methods
    system(msg: string, data?: Record<string, unknown>) { ... },
    agentText(text: string) { ... },
    toolCall(name: string, args: unknown) { ... },
    toolResult(name: string, result: string) { ... },
  };
}
```

### Message Parsing in Orchestrator

The Claude Agent SDK's `query()` returns messages. Each message has a `type`:
- `"assistant"` — has `content` which may include text blocks and `tool_use` blocks
- Other types — tool results, errors

For each assistant message:
- Extract text blocks → `jobLogger.agentText(text)`
- Extract tool_use blocks → `jobLogger.toolCall(toolName, toolInput)`

For tool results received by the SDK:
- `jobLogger.toolResult(toolName, resultContent)`

---

## 3. Job Cancellation (Instant Kill)

### Architecture

```
Admin UI [Kill button]
    │
    ▼ POST /admin/jobs/:id/kill
    │
    ├─→ Redis: SET job:<id>:cancelled "true"
    │
    └─→ In-memory Map: abortControllers.get(id).abort()
         │
         ▼
    Orchestrator: Promise.race throws AbortError
         │
         ├─→ Post Slack message: "Estimation cancelled by admin"
         ├─→ Redis: update status to "cancelled"
         ├─→ MCP child processes die (broken pipe from abandoned iterator)
         └─→ BullMQ: throw error → job marked as failed
```

### AbortController Registry

**File:** `src/lib/job-registry.ts`

```typescript
const controllers = new Map<string, AbortController>();

export function registerJob(jobId: string): AbortController {
  const controller = new AbortController();
  controllers.set(jobId, controller);
  return controller;
}

export function cancelJob(jobId: string): boolean {
  const controller = controllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  controllers.delete(jobId);
  return true;
}

export function unregisterJob(jobId: string) {
  controllers.delete(jobId);
}
```

### Abortable Iterator Wrapper

**File:** `src/lib/abortable.ts`

```typescript
export async function* abortable<T>(
  iterable: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  const abortPromise = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });

  try {
    while (true) {
      const result = await Promise.race([iterator.next(), abortPromise]);
      if (result.done) break;
      yield result.value;
    }
  } finally {
    iterator.return?.();
  }
}
```

### Orchestrator Changes

In `runEstimationWorkflow()`:

```typescript
const controller = registerJob(jobId);

try {
  for await (const message of abortable(query({ ... }), controller.signal)) {
    // ... existing turn processing + step detection + logging
  }
  // ... completed
} catch (err) {
  if (err instanceof DOMException && err.name === "AbortError") {
    // Cancelled by admin
    await postToThread(channelId, threadTs, "This estimation was cancelled by an administrator.");
    await redis.hset(`job:${jobId}:progress`, { status: "cancelled" });
    jobLogger.system("Job cancelled by admin");
    return; // Don't rethrow — this is a clean cancellation
  }
  throw err; // Rethrow real errors
} finally {
  unregisterJob(jobId);
}
```

### Redis Flag (Backup)

Also set `job:<jobId>:cancelled = "true"` in Redis when killing. This serves as a backup check — if the AbortController doesn't fire (edge case), the orchestrator can also check this flag between turns.

---

## 4. Admin UI & Auth

### Auth Middleware

**File:** `src/admin/auth.ts`

Two middleware functions applied to all `/admin/*` routes:

**IP Allowlist:**
```typescript
function ipAllowlist(req, res, next) {
  const allowed = (process.env.ADMIN_ALLOWED_IPS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return next(); // No allowlist configured = allow all (dev mode)
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;
  if (!allowed.includes(clientIp)) return res.status(403).send("Forbidden");
  next();
}
```

**HTTP Basic Auth:**
```typescript
function basicAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Admin"');
    return res.status(401).send("Authentication required");
  }
  const [user, pass] = Buffer.from(header.slice(6), "base64").toString().split(":");
  if (user !== process.env.ADMIN_USER || pass !== process.env.ADMIN_PASS) {
    return res.status(401).send("Invalid credentials");
  }
  next();
}
```

### Environment Variables

Add to `src/lib/env.ts` (all optional — admin panel disabled if `ADMIN_USER` not set):

```
ADMIN_USER          — admin username
ADMIN_PASS          — admin password
ADMIN_ALLOWED_IPS   — comma-separated IP allowlist (empty = allow all)
```

### Routes

**File:** `src/admin/routes.ts`

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /admin` | GET | Dashboard: active + recent jobs table |
| `GET /admin/jobs/:id/logs` | GET | Log viewer for a specific job |
| `POST /admin/jobs/:id/kill` | POST | Kill a running job (redirects back to /admin) |

### Dashboard Page (`GET /admin`)

Server-rendered HTML. Queries Redis for all `job:*:progress` keys (using SCAN). Renders two tables:

**Active Jobs** (status = "running"):
- Estimation name
- Current step (e.g., "3/5 Offer")
- Elapsed time (calculated from startedAt)
- [View Logs] link
- [Kill] button (red, submits POST form)

**Recent Jobs** (status = completed/failed/cancelled, last 24h):
- Estimation name
- Status (green/red/yellow badge)
- Total duration
- [View Logs] link

Auto-refresh: `<meta http-equiv="refresh" content="3">` — reloads every 3 seconds.

Anti-indexing: `<meta name="robots" content="noindex, nofollow">` + `X-Robots-Tag: noindex` response header.

### Log Viewer Page (`GET /admin/jobs/:id/logs`)

Fetches `LRANGE job:<id>:logs 0 -1` from Redis. Renders as a `<pre>` block with each line color-coded:

- `debug` → grey
- `info` → white
- `warn` → yellow
- `error` → red
- `tool_call` type → cyan
- `tool_result` type → green

Auto-refresh: same 3-second interval.

Back link to dashboard. Job name and status shown at top.

### Inline CSS

~60 lines of inline CSS. Dark background (`#1a1a2e`), monospace font, colored status badges, minimal table styling. No external CSS, no build step.

---

## 5. Express Mount

**File:** `src/index.ts`

After the Slack Bolt initialization (Step 3), mount the admin routes:

```typescript
if (env.ADMIN_USER) {
  const { mountAdmin } = await import("./admin/routes.js");
  mountAdmin(httpServer);
  logger.info("Admin panel mounted at /admin");
} else {
  logger.info("Admin panel disabled (ADMIN_USER not set)");
}
```

Admin panel is opt-in. If `ADMIN_USER` is not configured, no admin routes are mounted.

---

## Implementation Order

- [x] **Task 1:** Create `src/lib/redis.ts` — shared Redis singleton. Update producer.ts and worker.ts to use it.
- [x] **Task 2:** Create `src/lib/job-registry.ts` — AbortController registry (registerJob, cancelJob, unregisterJob)
- [x] **Task 3:** Create `src/lib/abortable.ts` — async iterator wrapper with AbortSignal support
- [x] **Task 4:** Create `src/lib/job-logger.ts` — per-job logger that writes to Redis list + stdout
- [x] **Task 5:** Update orchestrator — add job progress tracking (Redis hash), step detection, per-job logging, AbortController integration
- [x] **Task 6:** Update orchestrator — cancellation handling (catch AbortError, post Slack message, update Redis status)
- [x] **Task 7:** Create `src/admin/auth.ts` — IP allowlist + HTTP Basic Auth middleware
- [x] **Task 8:** Create `src/admin/routes.ts` — dashboard page (GET /admin), log viewer (GET /admin/jobs/:id/logs), kill endpoint (POST /admin/jobs/:id/kill)
- [x] **Task 9:** Add env vars (ADMIN_USER, ADMIN_PASS, ADMIN_ALLOWED_IPS) to env.ts as optional
- [x] **Task 10:** Mount admin routes in index.ts (opt-in based on ADMIN_USER)
- [x] **Task 11:** Write tests — abortable iterator, auth middleware, job registry
- [x] **Task 12:** Full build verification (npx tsc --noEmit + node --test)

## Files Created / Modified

| File | Changes |
|------|---------|
| `src/lib/redis.ts` | **New:** shared Redis singleton |
| `src/lib/job-registry.ts` | **New:** AbortController per-job registry |
| `src/lib/abortable.ts` | **New:** abortable async iterator wrapper |
| `src/lib/job-logger.ts` | **New:** per-job Redis log writer |
| `src/admin/auth.ts` | **New:** IP allowlist + Basic Auth middleware |
| `src/admin/routes.ts` | **New:** dashboard, log viewer, kill endpoint |
| `src/agents/orchestrator.ts` | Job progress writes, step detection, log capture, AbortController, cancellation handling |
| `src/queue/worker.ts` | Use shared Redis singleton, register/unregister AbortController per job |
| `src/queue/producer.ts` | Use shared Redis singleton |
| `src/lib/env.ts` | Add optional ADMIN_USER, ADMIN_PASS, ADMIN_ALLOWED_IPS |
| `src/index.ts` | Mount admin routes |
| `.env.example` | Add admin env vars |

## Dependencies

- No new npm packages — uses Express (already installed), IORedis (already installed)
- Redis required (already required for BullMQ)
- Admin panel is opt-in — disabled if ADMIN_USER not set
