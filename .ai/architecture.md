# Architecture

## System Overview

```
Slack (!estimate or /estimate) → Express/Bolt → BullMQ job → Orchestrator → MCP servers (stdio)
```

The orchestrator (`src/agents/orchestrator.ts`) drives a multi-stage agent pipeline through a single `query()` call to the Claude Agent SDK. Each stage maps to specific MCP tools via `TOOL_TO_STEP`.

## Pipeline Stages

| Stage | MCP Server | Tools | Purpose |
|-------|-----------|-------|---------|
| 1. Analysis | knowledge-base, figma (optional) | `search_past_estimations`, `search_past_proposals`, `search_case_studies`, `get_figma_data`, `download_figma_images` | Structured estimation search + proposal text search + case studies via Pinecone. Figma design file reading when `FIGMA_API_KEY` is set |
| 2. Clarification | slack-interaction | `wait_for_reply` | Posts questions to Slack, polls for human response (up to 15 min) |
| 3. Value Discovery | web-research | `fetch_web_page` | Research client business and industry benchmarks |
| 4. Offer | google-workspace | `docs_copy_template`, `docs_write_sections` | Clones Google Doc template, fills sections |

## MCP Server Pattern

Every MCP server follows this structure:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "dotenv";
config();

const server = new McpServer({ name: "server-name", version: "1.0.0" });
server.tool("tool_name", "description", { /* Zod schema */ }, async (params) => {
  return { content: [{ type: "text", text: "result" }] };
});
server.connect(new StdioServerTransport());
```

Rules:
- Standalone stdio processes — NEVER import from `src/`
- Each loads its own `dotenv/config`
- Google services use token caching with `expiresAt` check
- Tool params validated with Zod schemas

## Orchestrator MCP Config

Each server is registered in the orchestrator with:
- `command: "node"`, `args: [path.join(ROOT, "dist/mcp-servers/[name].js")]`
- `env:` — only the env vars that specific server needs
- Tools whitelisted in `allowedTools` array with prefix `mcp__[server]__[tool]`

## Key Files

| File | Purpose |
|------|---------|
| `src/agents/orchestrator.ts` | Agent pipeline driver, MCP configs, system prompt |
| `src/mcp-servers/*.ts` | MCP tool servers (stdio, standalone) |
| `src/lib/queue.ts` | BullMQ job queue setup |
| `src/slack/bolt-app.ts` | Slack Bolt app mounted at `/slack` on Express |
| `scripts/seed-knowledge-base.ts` | Seeds Pinecone from Google Drive (Sheets + Docs) |
| `scripts/get-google-token.ts` | One-time OAuth flow for `GOOGLE_REFRESH_TOKEN` |

## Brand Style Profile

- **Colors:** Coal `#181B20`, Mariner `#3C43E7`, Burnt Orange `#FD6027`, Off-White `#F9FAFB`, Vibe Yellow `#FFC800`
- **Fonts:** Space Mono (titles), Inter (body), JetBrains Mono (code)
- **Placeholder pattern:** `{{TOKEN_NAME}}` in Docs templates
- **Template IDs:** `GDRIVE_TEMPLATE_ID` (Docs)
