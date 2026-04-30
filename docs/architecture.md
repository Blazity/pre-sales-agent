# Architecture

Pre-Sales Agent is an agency-first RFP estimation starter.

The reference workflow is:

```text
Slack RFP or brief
  -> ingress route
  -> durable job
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
- Vercel Queues is the default job provider on Vercel.
- Vercel Sandbox is the default agent workspace provider on Vercel.
- Redis-style state is still used for progress and admin views; use a Vercel Marketplace Redis provider such as Upstash.

The original Express, BullMQ, and Redis runtime remains as the local/self-hosted fallback.
