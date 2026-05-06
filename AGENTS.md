# Pre-Sales Agent — Agent Instructions

## Repository Purpose

Pre-Sales Agent is an open-source starter for AI-powered agency pre-sales workflows. It turns Slack RFPs and briefs into clarification loops, structured estimates, Google Docs proposals, and Google Sheets estimations.

## Current Runtime Architecture

Default flow:

```text
Slack RFP or brief
  -> Vercel Function ingress
  -> Vercel Workflow run
  -> Claude Agent SDK orchestrator
  -> standalone stdio MCP servers
  -> Google Docs and Sheets outputs
  -> Slack thread completion message
```

The public starter is Vercel-first: Vercel Functions for HTTP ingress, Vercel Workflow for durable execution and observability, and Vercel Sandbox for the agent workspace on Vercel. Each estimation gets exactly one sandbox, created from a build-time snapshot when available (so per-job creation is ~5–10s) and reused across every workflow step retry via `@vercel/sandbox`'s native `@workflow/serde` integration.

## Repository Facts

- Default branch: `main`
- Package manager: `npm`
- Runtime: Node.js 20+ with TypeScript ESM
- Tests: Node's built-in test runner through `tsx --test`
- Production agent model provider: Anthropic Claude Agent SDK
- Embeddings: Voyage `voyage-3`
- Vector store: Pinecone, 1024 dimensions, cosine metric

## Required Gates

Run these before considering a change complete:

```bash
npm run typecheck
npm test
npm run build
npm run check:vercel-output
npm run audit:high
npm run scan:secrets
npm run check:mcp-isolation
npm run check:ai-docs
```

If `npm run audit:high` reports only lower-than-high advisories, document the advisory and do not force breaking dependency changes without a separate decision.

## Critical Invariants

- MCP servers in `src/mcp-servers/` are standalone stdio processes. They must not import from application internals.
- Every MCP server loads its own dotenv config.
- MCP tools return MCP content blocks: `{ content: [{ type: "text", text: "..." }] }`.
- The orchestrator `TOOL_TO_STEP` map and `allowedTools` array must stay in sync with MCP tool names.
- User-controlled prompt inputs must be wrapped in boundary tags declared in the system prompt.
- Google Docs template placeholders must match the orchestrator prompt and template setup code.
- Agency identity, proof points, voice, links, and colors must remain configurable through `AGENCY_PROFILE_PATH` or the default starter profile.
- Pinecone is locked to Voyage `voyage-3` embeddings. Changing the model requires a full re-index.
- Never commit secrets, `.env` files, credentials, API keys, customer RFPs, or real customer data.

## AI Operating Layer

Consult `.ai/` before guessing runtime facts:

- `.ai/README.md` — map of the AI operating layer
- `.ai/architecture.md` — current agent architecture and MCP boundaries
- `.ai/guardrails.md` — safety, prompt-injection, and data-handling rules
- `.ai/mcp-tools.md` — MCP tool inventory by server and pipeline stage
- `.ai/lessons.md` — known pitfalls and recovery steps
- `.ai/evals/` — eval-style expectations for prompt boundaries, tool routing, and review severity
- `.ai/skills/` — on-demand task workflows

## Review Process

For code review, follow `.ai/skills/code-review/SKILL.md` and `.ai/skills/code-review/references/checklist.md`.

Severity levels:

- Critical: security vulnerabilities, data loss risks, prompt-injection regressions, MCP isolation violations.
- High: architecture violations, broken orchestrator pipeline, wrong Pinecone/Voyage configuration, output-generation regressions.
- Medium: convention violations, missing tests, missing error handling, review-gate drift.
- Low: style, naming, or documentation clarity issues.

Request changes for Critical and High findings. Medium and Low findings are comments unless they accumulate into real risk.
