# Vercel Deployment

Vercel is the target default deployment platform for this starter.

## Deploy Button

Use the Deploy Button from the README to clone the public repository into the adopter's Git provider, create a new Vercel project, and collect required environment variables in Vercel during project creation. The starter does not require this source repository to be linked to a Vercel project.

Default service mapping:

- Slack ingress: Vercel Functions.
- Long-running jobs and observability: Vercel Workflow.
- Agent workspace isolation: Vercel Sandbox.
- Generated documents: Google Workspace by default.

## Routes

- `api/health.ts` exposes a Vercel health endpoint.
- `api/slack/events.ts` mounts the Slack Bolt receiver for Slack Events API traffic.
- `workflows/estimation.ts` runs the durable estimation workflow and records step observability in Vercel Workflow.

## Required Vercel Environment Variables

The Deploy Button asks Vercel to collect only the values needed for a first working deployment:

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

The app uses these runtime defaults when the variables are not set. Set them manually in Vercel only when changing the starter behavior:

| Variable | Default |
|---|---|
| `AGENT_WORKSPACE_PROVIDER` | `vercel-sandbox` |
| `PINECONE_INDEX` | `estimations` |
| `AGENCY_PROFILE_PATH` | Built-in starter agency profile |
| `NODE_ENV` | Vercel-provided runtime context |

The Deploy Button intentionally does not ask for optional, seeding, or branding variables. Add these later in the Vercel project settings only when needed: `BRAVE_SEARCH_API_KEY`, `FIGMA_API_KEY`, `SLACK_OPS_CHANNEL_ID`, `GDRIVE_OUTPUT_FOLDER_ID`, `GDRIVE_ESTIMATIONS_FOLDER_ID`, `GDRIVE_PROPOSALS_FOLDER_ID`, `AGENCY_PROFILE_PATH`, `AGENCY_NAME`, `AGENCY_ACCENT_COLOR`, and `CASE_STUDIES_BASE_URL`.

## Post-Deploy Setup

After Vercel creates the project:

1. Open the deployed app's `/api/health` endpoint and verify it returns `{"status":"ok","runtime":"vercel"}`.
2. In Slack, set the Events API request URL to `https://<your-vercel-domain>/api/slack/events`.
3. In Slack, set the slash command request URL to `https://<your-vercel-domain>/api/slack/events`.
4. Install or reinstall the Slack app after changing scopes or request URLs.
5. Share the configured Google Drive folders and templates with the Google OAuth account used by the app.
6. Seed knowledge-base data with `npm run seed` from a local checkout that has the same Pinecone, Voyage, and Google env vars.
7. Send a short test RFP in Slack with `!estimate <brief>` and confirm a Workflow run starts in Vercel.

Use `docs/setup.md` for provider-specific setup details and required Slack scopes.

## Local Development

Use the Vercel CLI against the cloned project and environment. No separate database or local queue worker is required.

```bash
npm run dev:vercel
```

To smoke-test Sandbox credentials:

```bash
npm run check:vercel-sandbox
```
