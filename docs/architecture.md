# Architecture

Pre-Sales Agent is an agency-first RFP estimation starter.

The reference workflow is:

```text
Slack RFP or brief
  -> ingress route
  -> Vercel Workflow run
  -> Claude Agent SDK orchestrator
  -> MCP tool servers
  -> Google Workspace outputs
  -> Slack thread completion message
```

## MCP Isolation

MCP servers in `src/mcp-servers/` run as standalone stdio processes. They must not import from application internals. Each server loads its own environment configuration and returns MCP-compatible content blocks.

## Runtime

The public starter is Vercel-first:

- Vercel Functions handle health checks and Slack Events API ingress from the `api/` directory.
- Vercel Workflow is the durable execution and observability layer.
- Vercel Sandbox is the default agent workspace provider on Vercel.
- Structured workflow events are written to Vercel logs and Workflow run timelines.
