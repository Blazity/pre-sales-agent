# Pre-Sales Agent

Open-source starter for building AI-powered pre-sales agents that turn RFPs and briefs into estimates, clarification loops, and proposal drafts.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FBlazity%2Fpre-sales-agent&project-name=pre-sales-agent&repository-name=pre-sales-agent)
[![CI](https://github.com/Blazity/pre-sales-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Blazity/pre-sales-agent/actions/workflows/ci.yml)

Built by Blazity as a configurable reference implementation for agencies and product teams that want to ship useful agent workflows instead of demos. The included workflow uses Claude Agent SDK, MCP tools, Google Workspace, Pinecone, Voyage, Slack, and Vercel services.

## What This Starter Shows

- Slack ingress for RFPs and briefs.
- Durable background processing for long-running agent work.
- MCP-isolated tool servers for knowledge base, Google Workspace, web research, and Slack interaction.
- Retrieval-augmented estimation from past estimates and proposal examples.
- Google Docs and Sheets output with generated starter templates.
- Prompt-injection boundaries around untrusted user content.
- Vercel Functions, Vercel Workflow, and Vercel Sandbox as the default deployment path.

## Status

This project is an OSS starter extracted from a production-shaped internal estimator. The default deployment path is Vercel Functions, Vercel Workflow, and Vercel Sandbox.

## Deploy

Use the Deploy with Vercel button to create your own Vercel project first. The shell can deploy before provider credentials are complete; Slack setup needs the deployed URL.

Then follow `docs/first-launch.md` to configure provider credentials, generate Google templates, set Vercel environment variables, configure Slack, and run the first estimate.

Use `docs/setup.md` as the provider reference across Slack, Google Workspace, Pinecone, Voyage, and Vercel.

## Local Development

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
```

`.env.example` is for local development only. Production values should live in the Vercel project's Environment Variables settings.

## Documentation

- `docs/architecture.md` explains the agent pipeline and MCP boundaries.
- `docs/first-launch.md` guides a fresh deployment to the first successful Slack run.
- `docs/prompt-architecture.md` explains the orchestration prompt, boundaries, and review gates.
- `docs/setup.md` walks through a fresh provider setup.
- `docs/demo.md` provides a public demo runbook and sample script.
- `docs/configuration.md` explains agency profile and environment configuration.
- `docs/deployment/vercel.md` tracks the Vercel-first deployment target.
- `docs/security.md` documents security gates and threat model notes.

## License

MIT

## Community

See `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, and `CODE_OF_CONDUCT.md` before opening issues or pull requests.
