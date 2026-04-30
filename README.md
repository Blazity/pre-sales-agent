# Pre-Sales Agent

Open-source starter for building AI-powered pre-sales agents that turn RFPs and briefs into estimates, clarification loops, and proposal drafts.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FBlazity%2Fpre-sales-agent&project-name=pre-sales-agent&repository-name=pre-sales-agent&env=ANTHROPIC_API_KEY%2CSLACK_BOT_TOKEN%2CSLACK_SIGNING_SECRET%2CGOOGLE_CLIENT_ID%2CGOOGLE_CLIENT_SECRET%2CGOOGLE_REFRESH_TOKEN%2CGDRIVE_ROOT_FOLDER_ID%2CGDRIVE_TEMPLATE_ID%2CGSHEETS_TEMPLATE_ID%2CPINECONE_API_KEY%2CVOYAGE_API_KEY&envDescription=Required+provider+keys+and+project+resources+for+Slack%2C+Claude%2C+Google+Workspace%2C+Pinecone%2C+and+Voyage.+Optional+defaults+can+be+customized+after+deploy.&envLink=https%3A%2F%2Fgithub.com%2FBlazity%2Fpre-sales-agent%2Fblob%2Fmain%2Fdocs%2Fdeployment%2Fvercel.md)
[![CI](https://github.com/Blazity/pre-sales-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Blazity/pre-sales-agent/actions/workflows/ci.yml)

Built by Blazity as a configurable reference implementation for agencies and product teams that want to ship useful agent workflows instead of demos. The included workflow uses Claude Agent SDK, MCP tools, Google Workspace, Pinecone, Voyage, Slack, and Vercel services.

## What This Starter Shows

- Slack ingress for RFPs and briefs.
- Durable background processing for long-running agent work.
- MCP-isolated tool servers for knowledge base, Google Workspace, web research, and Slack interaction.
- Retrieval-augmented estimation from past estimates and proposal examples.
- Google Docs and Sheets output.
- Prompt-injection boundaries around untrusted user content.
- Vercel Functions, Vercel Queues, and Vercel Sandbox as the default deployment path.

## Status

This project is an OSS starter extracted from a production-shaped internal estimator. The default deployment path is Vercel Functions, Vercel Workflow, and Vercel Sandbox.

## Deploy

Use the Deploy with Vercel button to create your own Vercel project and enter environment variables in Vercel during project creation. No local Vercel project link is required for the OSS starter.

Follow `docs/setup.md` for provider setup across Slack, Google Workspace, Pinecone, Voyage, and Vercel.

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
