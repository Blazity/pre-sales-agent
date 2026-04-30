# SPEC-020: Graceful Shutdown & Stall Recovery

**Status:** Done
**Date:** 2026-03-03

## Problem

Deploying while an estimation job is running kills the job. Railway sends SIGTERM, the container exits before the job finishes, and BullMQ marks it as stalled. With the default `maxStalledCount: 1`, a single stall makes the job permanently unrecoverable (`UnrecoverableError: job stalled more than allowable limit`).

**Root cause (Assessio job `est_1772541862002`):** PR #11 deploy triggered a container restart at 13:09:36 while the Presentation step was mid-execution. The new container's worker found the stalled job and failed it.

## Design

### Approach: Drain on SIGTERM + stall safety net

Two complementary changes:

1. **Drain** — On SIGTERM, stop accepting traffic and new jobs, wait for in-progress jobs to finish (up to 25 min), then exit.
2. **Stall recovery** — Increase `lockDuration` and `maxStalledCount` so crashes/OOM don't permanently kill jobs.

### Changes

#### 1. Railway shutdown timeout (`railway.toml`)

Add `shutdownTimeoutSeconds = 1500` so Railway waits up to 25 minutes before SIGKILL.

#### 2. SIGTERM handler (`src/index.ts`)

Replace the current handler with:

1. Set `shuttingDown = true` flag (idempotent guard)
2. `/health` returns 503 → Railway stops routing traffic to the old container
3. Close HTTP server to new connections
4. `worker.close()` — BullMQ stops accepting new jobs and waits for in-progress jobs to drain
5. `process.exit(0)`

Store the HTTP server reference from `httpServer.listen()` to call `.close()`.

#### 3. BullMQ worker config (`src/queue/worker.ts`)

| Setting | Old (default) | New | Reason |
|---------|---------------|-----|--------|
| `lockDuration` | 30,000 ms | 120,000 ms | Agent turns take 30-60s; default lock expires before renewal |
| `stalledInterval` | 30,000 ms | 120,000 ms | Match lock duration; reduce false stall detection |
| `maxStalledCount` | 1 | 2 | Allow 1 retry after crash/OOM instead of permanent failure |

## Implementation Plan

- [x] **Task 1:** Update `railway.toml` — add `shutdownTimeoutSeconds = 1500`
- [x] **Task 2:** Rewrite SIGTERM handler in `src/index.ts` — store server ref, add `shuttingDown` flag, 503 health check, close server, drain worker
- [x] **Task 3:** Add `lockDuration`, `stalledInterval`, `maxStalledCount` to worker options in `src/queue/worker.ts`
- [x] **Task 4:** `npx tsc --noEmit` and `npm test`
- [x] **Task 5:** Add lesson to `.ai/lessons.md` about deploy-during-active-job stall risk

## Files

- `railway.toml`
- `src/index.ts`
- `src/queue/worker.ts`
- `.ai/lessons.md`
