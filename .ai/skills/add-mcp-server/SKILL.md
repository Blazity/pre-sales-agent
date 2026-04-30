---
name: add-mcp-server
description: Use when creating a new MCP tool server or adding tools to an existing one
---

# Add MCP Server

Guide for creating or extending MCP tool servers in this project.

## Rules

- MCP servers are standalone stdio processes in `src/mcp-servers/`.
- NEVER import from `src/`. Each server loads its own `dotenv/config`.
- All tool params use Zod schemas.
- Return format: `{ content: [{ type: "text", text: "..." }] }`.
- Google services use token caching pattern (see `google-workspace.ts`).

## Creating a New MCP Server

### 1. Create the server file

Create `src/mcp-servers/{name}.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "dotenv";
config();

const server = new McpServer({ name: "{name}", version: "1.0.0" });

server.tool(
  "tool_name",
  "What this tool does — one sentence",
  {
    param: z.string().describe("What this param is"),
  },
  async ({ param }) => {
    // implementation
    return { content: [{ type: "text", text: `Result: ${param}` }] };
  }
);

server.connect(new StdioServerTransport());
```

### 2. Register in orchestrator

In `src/agents/orchestrator.ts`, add three things:

**a) TOOL_TO_STEP mapping** (around line 17):
```typescript
const TOOL_TO_STEP: Record<string, number> = {
  // ... existing entries ...
  tool_name: N,  // N = pipeline stage number
};
```

**b) MCP server config** (in the `mcpServers` object, around line 420):
```typescript
"{name}": {
  command: "node",
  args: [path.join(ROOT, "dist/mcp-servers/{name}.js")],
  env: {
    ONLY_VARS_THIS_SERVER_NEEDS: process.env.ONLY_VARS_THIS_SERVER_NEEDS ?? "",
  },
},
```

**c) Allowed tools** (in the `allowedTools` array, around line 470):
```typescript
"mcp__{name}__tool_name",
```

### 3. Update system prompt

Add a line describing the new server in the orchestrator's system prompt (the `content` string, around line 60):

```
- {name} MCP: what this server does
```

Add instructions in the relevant Step section of the prompt telling the agent when and how to use the new tools.

### 4. Update .env.example

Add any new environment variables with comments.

### 5. Check OAuth scopes

If the server uses Google APIs, check whether `scripts/get-google-token.ts` includes the required scope. If not, add it to the SCOPES array and re-run the script.

### 6. Create test file

Create `src/mcp-servers/{name}.test.ts` with at least one unit test per tool.

### 7. Verify

```bash
npx tsc --noEmit
npm test
```

## Adding Tools to an Existing Server

Same steps 2-7 above, but modify the existing server file instead of creating a new one.

## Checklist

- [ ] Server file created with dotenv, Zod schemas, stdio transport
- [ ] No imports from `src/`
- [ ] TOOL_TO_STEP mapping added
- [ ] MCP config added with correct env vars
- [ ] Tools added to allowedTools array
- [ ] System prompt updated
- [ ] .env.example updated if new vars
- [ ] OAuth scopes checked
- [ ] Test file created
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
