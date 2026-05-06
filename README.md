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

This starter is designed to be used with an AI coding agent. The repository includes project instructions, skills, doctors, and review gates so an agent can guide setup step by step instead of leaving operators to stitch together dashboard steps and commands manually.

Use the deploy-first path. Vercel must exist before final Slack setup because Slack needs the deployed public URL.

1. Click **Deploy with Vercel** to create the project and get a public URL.
2. Open the cloned repository in your AI coding agent or agent-enabled editor.
3. Ask the agent to launch the registered `first-launch` onboarding skill.
4. Follow the skill checklist one step at a time until Slack starts an estimate and Google Docs and Sheets outputs are created.
5. Seed the knowledge base only after first launch works, unless you already have curated Google Drive source folders ready.

Use this prompt to start guided onboarding:

```text
Use the first-launch skill in this repository and guide me from a fresh Vercel deployment to the first successful Slack estimation run. Stop after each checklist step and tell me what dashboard action or command to run next.
```

The canonical onboarding skill lives in `.ai/skills/first-launch/SKILL.md` and is exposed through `.claude/skills`, `.agents/skills`, and `.cursor/skills` for compatible agents.

## Agent Onboarding Order

The `first-launch` skill is the source of truth for the setup sequence. At a high level, the order is:

1. Deploy the Vercel shell.
2. Choose the stable Vercel production/project domain for Slack. Do not use a one-off deployment URL.
3. Verify `/api/health`.
4. Install locally with `npm install`.
5. Configure provider credentials for Anthropic, Slack, Google Workspace, Pinecone, and Voyage.
6. Generate or choose Google Docs and Sheets templates.
7. Set required Vercel environment variables and redeploy.
8. Run `npm run doctor:first-launch -- --health-url https://<your-vercel-domain>`.
9. Configure Slack Events and `/estimate` with the same tested stable domain.
10. Invite the Slack bot to the channel and run the first `!estimate` or `/estimate`.
11. Run `npm run doctor:seed` and `npm run seed` only after first launch, or when Drive source folders are ready.

After the first run works, read `docs/architecture.md` to understand the runtime, orchestration, MCP tools, and extension points. For new MCP tools, use `.ai/skills/add-mcp-server/SKILL.md` and keep the MCP isolation rules intact.

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

## Environment Variables

First launch requires provider credentials for Anthropic, Slack, Google Workspace, Pinecone, and Voyage. It also needs Google Drive template IDs after you run `npm run setup:google-templates`.

For Vercel Sandbox, set these only when needed:

| Variables | When needed |
|---|---|
| `AGENT_REPO_TOKEN` or `GITHUB_TOKEN` | Required for private repos when the snapshot build or runtime git-clone fallback must clone the source repo. |
| `AGENT_REPO_URL`, `AGENT_REPO_REVISION` | Optional overrides for non-default repo source or revision. |

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

## Contributing

See `CONTRIBUTING.md` before opening pull requests and `SECURITY.md` for vulnerability reporting.
