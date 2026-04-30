# Vercel Deployment

Vercel is the target default deployment platform for this starter.

## Deploy Button

Use the Deploy Button from the README to clone the public repository into the adopter's Git provider, create a new Vercel project, and collect required environment variables in Vercel during project creation. The starter does not require this source repository to be linked to a Vercel project.

Before release, replace the placeholder `your-org` in the README Deploy Button URL with the final public repository owner.

Default service mapping:

- Slack ingress: Vercel Functions.
- Long-running jobs: Vercel Queues, topic `estimations`.
- Agent workspace isolation: Vercel Sandbox, selected by `AGENT_WORKSPACE_PROVIDER=vercel-sandbox`.
- Redis-style state: Vercel Marketplace Redis, such as Upstash Redis.
- Generated documents: Google Workspace by default.

## Routes

- `api/health.ts` exposes a Vercel health endpoint.
- `api/slack/events.ts` mounts the Slack Bolt receiver for Slack Events API traffic.
- `api/queues/estimations.ts` consumes Vercel Queue messages and runs the estimation workflow.

## Required Vercel Environment Variables

The Deploy Button asks Vercel to collect these values:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Agent SDK and web-page extraction |
| `SLACK_BOT_TOKEN` | Slack bot API calls and MCP Slack interaction |
| `SLACK_SIGNING_SECRET` | Slack request signature verification |
| `GOOGLE_CLIENT_ID` | Google Workspace OAuth |
| `GOOGLE_CLIENT_SECRET` | Google Workspace OAuth |
| `GOOGLE_REFRESH_TOKEN` | Google Workspace OAuth refresh token |
| `GDRIVE_ROOT_FOLDER_ID` | Root folder for generated estimation assets |
| `GDRIVE_TEMPLATE_ID` | Google Docs proposal template |
| `GSHEETS_TEMPLATE_ID` | Google Sheets estimation template |
| `PINECONE_API_KEY` | Knowledge-base vector search |
| `VOYAGE_API_KEY` | Embeddings for knowledge-base search |
| `REDIS_URL` | Progress state and admin/job logs, use a Vercel Marketplace Redis provider |

The Deploy Button also pre-fills safe defaults for:

| Variable | Default |
|---|---|
| `JOB_QUEUE_PROVIDER` | `vercel` |
| `VERCEL_QUEUE_TOPIC` | `estimations` |
| `AGENT_WORKSPACE_PROVIDER` | `vercel-sandbox` |
| `PINECONE_INDEX` | `estimations` |
| `AGENCY_PROFILE_PATH` | `config/agency.example.json` |
| `AGENCY_NAME` | `Example Digital Studio` |
| `AGENCY_ACCENT_COLOR` | `#F97316` |
| `CASE_STUDIES_BASE_URL` | `https://example.com` |
| `NODE_ENV` | `production` |

Optional integrations can be added later in the Vercel project settings: `BRAVE_SEARCH_API_KEY`, `FIGMA_API_KEY`, `SLACK_OPS_CHANNEL_ID`, `GDRIVE_ESTIMATIONS_FOLDER_ID`, and `GDRIVE_PROPOSALS_FOLDER_ID`.

## Local Fallback

BullMQ remains available for local development or self-hosted runs. Set `JOB_QUEUE_PROVIDER=bullmq` and run `npm run dev` with Redis.

For Vercel-style local development in an adopter's own project, use the Vercel CLI against their cloned project and environment. This is optional for the OSS repository itself.

```bash
npm run dev:vercel
```

To smoke-test Sandbox credentials:

```bash
npm run check:vercel-sandbox
```
