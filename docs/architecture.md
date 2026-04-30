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

## Current Runtime

The copied implementation currently uses Express, BullMQ, and Redis. The public starter target is Vercel-first: Vercel Functions for ingress, Vercel Queues or Vercel Workflow for durable work, and Vercel Sandbox for isolated agent workspaces.
