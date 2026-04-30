# Pre-Sales Agent

Open-source starter for AI-powered pre-sales agents.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyour-org%2Fpre-sales-agent&project-name=pre-sales-agent&repository-name=pre-sales-agent&env=ANTHROPIC_API_KEY%2CSLACK_BOT_TOKEN%2CSLACK_SIGNING_SECRET%2CGOOGLE_CLIENT_ID%2CGOOGLE_CLIENT_SECRET%2CGOOGLE_REFRESH_TOKEN%2CGDRIVE_ROOT_FOLDER_ID%2CGDRIVE_TEMPLATE_ID%2CGSHEETS_TEMPLATE_ID%2CPINECONE_API_KEY%2CVOYAGE_API_KEY%2CREDIS_URL%2CJOB_QUEUE_PROVIDER%2CVERCEL_QUEUE_TOPIC%2CAGENT_WORKSPACE_PROVIDER%2CPINECONE_INDEX%2CAGENCY_PROFILE_PATH%2CAGENCY_NAME%2CAGENCY_ACCENT_COLOR%2CCASE_STUDIES_BASE_URL%2CNODE_ENV&envDefaults=%7B%22JOB_QUEUE_PROVIDER%22%3A%22vercel%22%2C%22VERCEL_QUEUE_TOPIC%22%3A%22estimations%22%2C%22AGENT_WORKSPACE_PROVIDER%22%3A%22vercel-sandbox%22%2C%22PINECONE_INDEX%22%3A%22estimations%22%2C%22AGENCY_PROFILE_PATH%22%3A%22config%2Fagency.example.json%22%2C%22AGENCY_NAME%22%3A%22Example+Digital+Studio%22%2C%22AGENCY_ACCENT_COLOR%22%3A%22%23F97316%22%2C%22CASE_STUDIES_BASE_URL%22%3A%22https%3A%2F%2Fexample.com%22%2C%22NODE_ENV%22%3A%22production%22%7D&envDescription=Provider+keys+and+project+configuration+for+Slack%2C+Claude%2C+Google+Workspace%2C+Pinecone%2C+Voyage%2C+Redis%2C+Vercel+Queues%2C+and+Vercel+Sandbox.&envLink=https%3A%2F%2Fgithub.com%2Fyour-org%2Fpre-sales-agent%2Fblob%2Fmain%2Fdocs%2Fdeployment%2Fvercel.md)

The included workflow turns Slack RFPs, documents, and briefs into structured analysis, clarification questions, estimates, and proposal drafts using Claude Agent SDK, MCP tools, Google Workspace, Pinecone, Voyage, and Vercel-oriented deployment patterns.

## What This Starter Shows

- Slack ingress for RFPs and briefs.
- Durable background processing for long-running agent work.
- MCP-isolated tool servers for knowledge base, Google Workspace, web research, and Slack interaction.
- Retrieval-augmented estimation from past estimates and proposal examples.
- Google Docs and Sheets output.
- Prompt-injection boundaries around untrusted user content.
- Vercel Functions, Vercel Queues, and Vercel Sandbox as the default deployment path.

## Status

This project is an OSS starter extracted from a production-shaped internal estimator. The default deployment path is Vercel, while Express, BullMQ, and Redis compatibility remains available for local or self-hosted runs.

## Deploy

Use the Deploy with Vercel button to create your own Vercel project and enter environment variables in Vercel during project creation. No local Vercel project link is required for the OSS starter.

Before publishing this repository, replace `your-org` in the Deploy Button URL with the final public GitHub organization or user.

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
- `docs/configuration.md` explains agency profile and environment configuration.
- `docs/deployment/vercel.md` tracks the Vercel-first deployment target.
- `docs/security.md` documents security gates and threat model notes.

## License

MIT
