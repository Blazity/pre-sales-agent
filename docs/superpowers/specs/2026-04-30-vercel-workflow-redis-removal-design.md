# Vercel Workflow Redis Removal Design

Date: 2026-04-30

## Goal

Make the OSS starter simpler to deploy and stronger as a Vercel-first agent reference by removing Redis, BullMQ, and the Express self-hosted fallback completely. Vercel Workflow becomes the durable execution and observability layer for estimation runs.

This change should not reduce estimation quality. The estimation quality comes from the orchestration prompt, Claude Agent SDK, MCP servers, Google Workspace output, Pinecone retrieval, Voyage embeddings, and Slack interaction. Redis currently supports only internal job progress, logs, BullMQ state, and the custom admin dashboard.

## Non-Goals

- Keep a self-hosted runtime.
- Keep BullMQ compatibility.
- Keep Redis as an optional provider.
- Preserve the custom `/admin` job dashboard.
- Add a separate database such as Postgres, Blob, Edge Config, or Marketplace Redis.
- Rewrite the core estimation prompt or MCP tools.

## Current State

The app currently has two execution paths:

- Vercel path: Slack HTTP events enqueue estimation jobs through Vercel Queues, and `api/queues/estimations.ts` consumes them.
- Legacy path: Express starts Slack Bolt, an optional admin panel, and a BullMQ worker backed by Redis.

Redis is used for:

- `job:${jobId}:progress` hashes for step status, cost, token counts, and timestamps.
- `job:${jobId}:logs` lists for admin log viewing.
- BullMQ queue connection and state.
- Custom admin actions such as job kill/status views.

The Vercel-first starter still asks for `REDIS_URL`, which adds a Marketplace provider and secret to the first deploy even though Redis is not needed for generated estimate quality.

## Target Architecture

The default architecture becomes Vercel-only:

```text
Slack Events API / slash command
  -> Vercel Function validates and acknowledges the Slack request
  -> starts a Vercel Workflow run
  -> Workflow records durable run state, step events, retries, errors, and logs
  -> agent executes with MCP servers and Vercel Sandbox workspace
  -> Google Docs/Sheets are created
  -> Slack thread receives completion or failure message
```

Vercel Queues remain only as an implementation detail of Vercel Workflow if required by the Workflow runtime. The app should not expose or maintain its own queue consumer unless the Workflow SDK requires a route for execution.

## Workflow Shape

Create an estimation workflow with explicit durable steps:

1. `prepareInput`
   - Normalize Slack command text, Slack uploads, Drive links, and file manifests into an `EstimationJob`.
   - Reuse the existing file ingestion helpers.
   - Emit structured run metadata: `jobId`, Slack `channelId`, Slack `threadTs`, input mode, file count.

2. `runAgent`
   - Call the existing agent orchestration.
   - Refactor `runEstimationWorkflow` so it no longer imports Redis.
   - Pass a reporter/logger interface into the workflow execution.
   - Emit structured events for progress step changes, tool calls, tool results, agent text previews, token usage, and cost.

3. `postCompletion`
   - Ensure the Slack thread has a final success message.
   - Record output links and final cost/token metadata in Workflow observability.

4. `postFailure`
   - Send a concise failure message into the Slack thread.
   - Record the error, failing step, and job metadata in Workflow observability.

The agent may still post intermediate Slack messages through the Slack MCP server. Workflow observability is for operators; Slack remains the user-facing progress surface.

## Reporter Interface

Replace Redis progress/log writes with a small reporting boundary:

```ts
interface WorkflowReporter {
  progress(event: {
    jobId: string;
    step?: number;
    stepName?: string;
    status?: "running" | "completed" | "failed" | "cancelled";
    turnsCompleted?: number;
    costClaudeUsd?: number;
    costBraveUsd?: number;
    costTotalUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<void>;

  log(event: {
    jobId: string;
    level: "info" | "warn" | "error" | "debug";
    type: "system" | "agent_text" | "tool_call" | "tool_result";
    message: string;
    data?: Record<string, unknown>;
  }): Promise<void>;
}
```

The first implementation writes structured logs through the existing JSON logger. When called inside Vercel Workflow steps, these logs and step boundaries appear in Vercel's Workflow/Function observability instead of a custom Redis-backed admin UI.

## Deletions

Remove these runtime surfaces:

- `src/lib/redis.ts`
- `src/lib/job-logger.ts`
- `src/queue/worker.ts`
- BullMQ-specific code in `src/queue/producer.ts`
- `api/queues/estimations.ts` if Workflow replaces the queue consumer route
- Express server entrypoint support in `src/index.ts`
- `src/admin/routes.ts`, `src/admin/auth.ts`, and admin tests
- `scripts/check-jobs.ts`
- `REDIS_URL` from `.env.example`, docs, tests, and README Deploy Button
- `bullmq` and `ioredis` dependencies
- Docs that describe Redis, BullMQ, self-hosted fallback, or custom admin observability as part of the starter

Keep or adapt these surfaces:

- `api/health.ts`
- `api/slack/events.ts`
- Slack parsing and ingestion logic
- Vercel Sandbox runtime selection
- MCP isolation
- Google Drive/Docs/Sheets helpers
- Pinecone/Voyage retrieval
- Local scripts for provider setup, seeding, and smoke tests

## Local Development

Local development should use the Vercel-shaped path:

- `npm run dev:vercel` is the supported local runtime for HTTP routes and Workflow behavior.
- `npm run dev` should either be removed or changed to a Vercel-compatible helper.
- No local Redis container is required.
- No local BullMQ worker is required.

If the Workflow SDK has local-runtime limitations, document the exact supported local smoke path instead of preserving the old Express worker.

## Deployment UX

The Deploy Button should no longer ask for `REDIS_URL`.

First-deploy environment variables become:

- `ANTHROPIC_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GDRIVE_ROOT_FOLDER_ID`
- `GDRIVE_TEMPLATE_ID`
- `GSHEETS_TEMPLATE_ID`
- `PINECONE_API_KEY`
- `VOYAGE_API_KEY`

Optional variables remain optional and should be added only after first deploy: web research, Figma, admin/ops alerts if any remain, seeding folders, agency profile overrides, and queue/workflow tuning variables if the Workflow SDK exposes any useful knobs.

## Observability

The replacement for Redis admin observability is:

- Vercel Workflow run timeline for durable step status, retries, and failures.
- Structured Vercel logs with `jobId`, Slack channel/thread, step name, tool name, cost, token usage, and output links.
- Slack thread messages for user-facing progress and completion.
- Google Drive output folder as the durable business artifact.

The custom admin dashboard is intentionally removed from the launch scope. If a UI is needed later, it should be rebuilt against Vercel Workflow metadata or a first-party Vercel-compatible data source, not reintroduced through Redis.

## Error Handling

- Slack ingress must acknowledge quickly and fail closed on invalid input.
- Workflow start failures should be reported to the Slack thread when possible.
- Agent failures should be caught at the workflow boundary, logged with structured metadata, and posted to Slack.
- Retriable external API errors should live at Workflow step boundaries where Vercel can retry safely.
- Tool-call logs must continue to include tool results, because previous lessons show tool result logs are essential for debugging MCP failures.

## Testing

Update tests around the new architecture:

- Add tests for workflow launcher payload construction.
- Add tests for reporter event formatting.
- Update orchestrator tests to assert reporter calls instead of Redis writes.
- Remove Redis env tests, BullMQ queue tests, worker tests, admin tests, and `check-jobs` assumptions.
- Keep MCP isolation, secret scan, typecheck, and existing unit coverage for parsing, ingestion, Google helpers, retrieval formatting, and prompt utilities.

Required verification before completion:

```bash
npm run typecheck
npm test
npm run scan:secrets
npm run check:mcp-isolation
npm run audit:high
```

## Migration Order

1. Introduce the reporter interface and remove direct Redis writes from the orchestrator.
2. Add the Vercel Workflow launcher and workflow steps.
3. Route Slack events to start the workflow instead of enqueueing a Vercel Queue message directly.
4. Delete Redis, BullMQ, worker, admin, and Express fallback code.
5. Remove dependencies and stale scripts.
6. Update README, setup, deployment, architecture, and configuration docs.
7. Run full verification and check the Deploy Button env list.

## Open Risks

- The Workflow SDK is newer than the current queue route, so the implementation should verify exact local dev and route conventions before deleting the queue consumer.
- If Workflow local execution is limited, local testing may depend more heavily on deployed preview environments.
- If Workflow observability does not expose a programmatic run list, that is acceptable for launch because the custom admin UI is out of scope.

## Decision

Proceed with the full cleanup:

- Redis removed, not optional.
- BullMQ removed.
- Express/self-hosted fallback removed.
- Custom admin dashboard removed.
- Vercel Workflow becomes the durable execution and observability layer.
