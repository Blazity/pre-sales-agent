# Agent Architecture

## System Overview

```text
Slack RFP or brief
  -> Vercel Function ingress
  -> Vercel Workflow run
  -> Claude Agent SDK orchestrator
  -> standalone stdio MCP servers
  -> Google Docs and Sheets outputs
  -> Slack thread completion message
```

The orchestrator (`src/agents/orchestrator.ts`) drives a four-stage estimation workflow through a Claude Agent SDK `query()` call. MCP tools provide retrieval, file access, web research, Slack interaction, and Google Workspace output.

## Runtime

The public starter is Vercel-first:

- Vercel Functions handle health checks and Slack Events API ingress from `api/`.
- Vercel Workflow is the durable execution and observability layer. The estimation workflow runs as three `'use step'` functions: `bootJobStep` (creates one sandbox per job, `maxRetries=0`), `streamOrchestratorStep` (reattaches to the running orchestrator and replays events from a JSONL byte offset, retries OK), and `cleanupSandboxStep` (always runs in `finally`).
- Vercel Sandbox is the default agent workspace provider on Vercel. Each estimation gets exactly one sandbox: created at job start (from a build-time snapshot when available, or git-clone fallback) and reused across every step retry via the `@workflow/serde` integration that ships with `@vercel/sandbox`.
- A build-time template snapshot is created by `scripts/snapshot-sandbox.ts` when `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID` are present. The snapshot id is written into `src/runtime/sandbox-snapshot-id.ts` and bundled into the runtime function so per-job sandboxes skip `npm ci` and `npm run build` (~5–10s ready vs ~60–120s).
- Structured workflow events are written to Vercel logs and Workflow run timelines. The orchestrator inside the sandbox additionally writes `events.jsonl` and a `result.json` sentinel, so a workflow step retry after a Vercel Function timeout (800s ceiling) can resume streaming without losing events emitted while the function was offline.

## Pipeline Stages

| Stage | Purpose | Primary Tools |
|---|---|---|
| 1. Analysis | Understand the RFP, retrieve comparable work, inspect supplied files, and gather initial context. | `search_past_estimations`, `search_past_proposals`, `search_case_studies`, `web_search`, optional `get_figma_data`, optional `download_figma_images`, Drive read tools |
| 2. Clarification | Ask targeted follow-up questions in the Slack thread when clarification is not skipped. | `post_message`, `wait_for_reply` |
| 3. Value Discovery | Research the client, market context, and credible benchmark data for value framing. | `web_search`, `fetch_web_page` |
| 4. Offer | Create Google Docs and Sheets outputs and fill template placeholders. | `docs_copy_template`, `docs_find_and_replace`, `docs_write_sections`, `sheets_create_estimation` |

`wait_for_reply` polls for up to 15 minutes.

## MCP Server Pattern

Every MCP server in `src/mcp-servers/` is a standalone stdio process:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "dotenv";
config();

const server = new McpServer({ name: "server-name", version: "1.0.0" });

server.tool("tool_name", "description", { param: z.string() }, async ({ param }) => {
  return { content: [{ type: "text" as const, text: `Result: ${param}` }] };
});

server.connect(new StdioServerTransport());
```

Rules:

- Do not import from application internals.
- Load dotenv inside each MCP server.
- Validate tool parameters with Zod.
- Return MCP content blocks.
- Keep server env vars scoped to only what the server needs.

## Key Files

| File | Purpose |
|---|---|
| `api/health.ts` | Vercel health endpoint |
| `api/slack/events.ts` | Slack Events API ingress |
| `workflows/estimation.ts` | Durable estimation workflow |
| `src/agents/orchestrator.ts` | Claude Agent SDK orchestration prompt, MCP config, allowed tools, and tool-step tracking |
| `src/mcp-servers/*.ts` | Standalone MCP tool servers |
| `src/runtime/sandbox.ts` | Workspace provider selection, `bootSandboxForJob`, `streamOrchestratorEvents`, `stopSandbox` |
| `src/runtime/sandbox-snapshot-id.ts` | Generated at build time — exports the snapshot id used by `bootSandboxForJob` |
| `scripts/snapshot-sandbox.ts` | Build-time prewarm: creates the template snapshot and writes its id into the bundled runtime |
| `scripts/run-orchestrator-in-sandbox.ts` | Orchestrator entry point inside the sandbox; writes `events.jsonl` + `result.json` for resumable streaming |
| `scripts/seed-knowledge-base.ts` | Pinecone seeding from Google Drive |
| `scripts/setup-google-templates.ts` | Starter Google Docs and Sheets template creation |
| `scripts/get-google-token.ts` | One-time Google OAuth refresh-token flow |

## Agency Profile

Agency identity, voice, proof points, links, commercial assumptions, document colors, and template generation defaults come from `src/config/agency-profile.ts`.

Use `AGENCY_PROFILE_PATH` to provide a real agency profile. The default profile must remain a public starter.
