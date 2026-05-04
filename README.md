# Pre-Sales Agent

Open-source starter for building AI-powered pre-sales agents that turn RFPs and briefs into estimates, clarification loops, and proposal drafts.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FBlazity%2Fpre-sales-agent&project-name=pre-sales-agent&repository-name=pre-sales-agent)
[![CI](https://github.com/Blazity/pre-sales-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Blazity/pre-sales-agent/actions/workflows/ci.yml)

Built by Blazity as a configurable reference implementation for agencies and product teams that want to ship useful agent workflows instead of demos. The included workflow uses Claude Agent SDK, MCP tools, Google Workspace, Pinecone, Voyage, Slack, and Vercel services.

## What This Starter Shows

- Slack ingress for RFPs and briefs as the default request channel.
- Durable background processing for long-running agent work.
- MCP-isolated tool servers for knowledge base, Google Workspace, web research, and Slack interaction.
- Retrieval-augmented estimation from past estimates and proposal examples.
- Google Docs and Sheets output with generated starter templates as the default output system.
- Prompt-injection boundaries around untrusted user content.
- Vercel Functions, Vercel Workflow, and Vercel Sandbox as the supported runtime.

## Status

This project is an OSS starter extracted from a production-shaped internal estimator. The supported runtime today is Vercel Functions, Vercel Workflow, and Vercel Sandbox.

## Start Here

This starter is designed for first launch on Vercel. The supported path today is Vercel Functions, Vercel Workflow, and Vercel Sandbox.

1. Click **Deploy with Vercel** to create the project and get a public URL.
2. Follow `docs/first-launch.md` from the deployed shell to the first successful Slack estimation run.
3. If you are working with an AI coding assistant, use the registered `first-launch` skill. The canonical skill lives in `.ai/skills/first-launch/SKILL.md` and is discovered through `.claude/skills`, `.agents/skills`, and `.cursor/skills`.
4. After the first run works, read `docs/architecture.md` to understand the runtime, orchestration, MCP tools, and extension points.
5. For new MCP tools, use `.ai/skills/add-mcp-server/SKILL.md` and keep the MCP isolation rules intact.

Slack is the default ingress integration in this starter. Other channels, such as Microsoft Teams, should be treated as extension work after the Vercel first-launch path is working.

Google Workspace is the default output system for first launch. Replacing it means adding or changing output tools, not changing the first-launch guide.

## Runtime Flow

```text
Slack request
  -> Vercel Function ingress
  -> Vercel Workflow run
  -> Claude Agent SDK orchestrator
  -> MCP stdio tool servers
  -> Google Docs and Sheets outputs
  -> Slack thread update
```

## Local Development

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
```

`.env.example` is for local development only. Production values should live in the Vercel project's Environment Variables settings.

## Documentation

- `docs/first-launch.md` guides a fresh Vercel deployment to the first successful Slack run.
- `docs/setup.md` is the provider reference across Slack, Google Workspace, Pinecone, Voyage, and Vercel.
- `docs/architecture.md` explains the supported Vercel runtime, agent pipeline, MCP boundaries, and extension points.
- `docs/prompt-architecture.md` explains the orchestration prompt, boundaries, and review gates.
- `docs/demo.md` provides a public demo runbook and sample script.
- `docs/configuration.md` explains agency profile and environment configuration.
- `docs/deployment/vercel.md` tracks the Vercel-first deployment target.
- `docs/security.md` documents security gates and threat model notes.

## License

MIT

## Community

See `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, and `CODE_OF_CONDUCT.md` before opening issues or pull requests.
