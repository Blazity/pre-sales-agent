# Pre-Sales Agent

Open-source starter for AI-powered pre-sales agents.

The included workflow turns Slack RFPs, documents, and briefs into structured analysis, clarification questions, estimates, and proposal drafts using Claude Agent SDK, MCP tools, Google Workspace, Pinecone, Voyage, and Vercel-oriented deployment patterns.

## What This Starter Shows

- Slack ingress for RFPs and briefs.
- Durable background processing for long-running agent work.
- MCP-isolated tool servers for knowledge base, Google Workspace, web research, and Slack interaction.
- Retrieval-augmented estimation from past estimates and proposal examples.
- Google Docs and Sheets output.
- Prompt-injection boundaries around untrusted user content.
- A path toward Vercel Functions, Vercel Queues, Vercel Workflow, and Vercel Sandbox.

## Status

This project is an OSS starter extracted from a production-shaped internal estimator. The current codebase still includes compatibility with the original Express, BullMQ, and Redis runtime while the Vercel-first runtime is being implemented.

## Quick Start

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
```

Fill `.env` with provider credentials before running the application.

Use `npm run dev:vercel` for the default Vercel Functions + Vercel Queues path, or set `JOB_QUEUE_PROVIDER=bullmq` and run `npm run dev` for the local Express/BullMQ fallback.

## Documentation

- `docs/architecture.md` explains the agent pipeline and MCP boundaries.
- `docs/configuration.md` explains agency profile and environment configuration.
- `docs/deployment/vercel.md` tracks the Vercel-first deployment target.
- `docs/security.md` documents security gates and threat model notes.

## License

MIT
