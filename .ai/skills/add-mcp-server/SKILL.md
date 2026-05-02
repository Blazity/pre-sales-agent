---
name: add-mcp-server
description: Use when creating a new MCP tool server or adding tools to an existing one
---

# Add MCP Server

Guide for creating or extending MCP tool servers in this project.

## Rules

- MCP servers are standalone stdio processes in `src/mcp-servers/`.
- Never import from application internals.
- Each server loads its own dotenv config.
- All tool params use Zod schemas.
- Return format: `{ content: [{ type: "text", text: "..." }] }`.
- Google services use token caching with an `expiresAt` check.

## Creating A New MCP Server

1. Create `src/mcp-servers/{name}.ts`.
2. Register the server in `src/agents/orchestrator.ts`.
3. Add exposed tools to `allowedTools`.
4. Add stage-tracked tools to `TOOL_TO_STEP`.
5. Update the orchestrator system prompt only when tool behavior or routing changes.
6. Add new env vars to `.env.example`.
7. Check Google OAuth scopes when using Google APIs.
8. Add tests for pure helpers and tool behavior.
9. Update `.ai/mcp-tools.md`.
10. Update `.ai/evals/tool-routing.md` if routing expectations changed.

## Server Template

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "dotenv";
config();

const server = new McpServer({ name: "{name}", version: "1.0.0" });

server.tool(
  "tool_name",
  "What this tool does in one sentence.",
  {
    param: z.string().describe("What this param is"),
  },
  async ({ param }) => {
    return { content: [{ type: "text" as const, text: `Result: ${param}` }] };
  },
);

server.connect(new StdioServerTransport());
```

## Adding Tools To An Existing Server

Follow the same registration, docs, eval, and verification steps. Modify the existing server file instead of creating a new one.

## Checklist

- [ ] Server file created or updated with dotenv, Zod schemas, and stdio transport.
- [ ] No imports from application internals.
- [ ] `TOOL_TO_STEP` updated for stage-tracked tools.
- [ ] MCP config updated with only required env vars.
- [ ] `allowedTools` updated when the orchestrator should call the tool.
- [ ] System prompt updated if tool behavior or routing changed.
- [ ] `.env.example` updated if new env vars are required.
- [ ] OAuth scopes checked if Google APIs are used.
- [ ] Tests added or updated.
- [ ] `.ai/mcp-tools.md` updated.
- [ ] `.ai/evals/tool-routing.md` updated if routing expectations changed.

## Verify

```bash
npm run typecheck
npm test
npm run check:mcp-isolation
npm run check:ai-docs
```
