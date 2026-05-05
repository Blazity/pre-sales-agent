# Vercel Deployment

Vercel is the target default deployment platform for this starter.

## Deploy Button

Use the Deploy Button from the README to clone the public repository into the adopter's Git provider and create a new Vercel project. The starter is deploy-first: create the Vercel shell, get the public URL, then finish provider setup and environment variables.

The starter does not require this source repository to be linked to a Vercel project.

For Slack setup, use a stable production/project domain, such as `https://<project>.vercel.app` or a custom production domain. Do not copy an immutable deployment-specific URL from one Vercel deployment into Slack unless you understand that later redeploys will not update that URL.

Default service mapping:

- Slack ingress: Vercel Functions.
- Long-running jobs and observability: Vercel Workflow.
- Agent workspace isolation: Vercel Sandbox.
- Generated documents: Google Workspace by default.

## Routes

- `api/health.ts` exposes a Vercel health endpoint.
- `api/slack/events.ts` mounts the Slack Bolt receiver for Slack Events API traffic.
- `workflows/estimation.ts` runs the durable estimation workflow and records step observability in Vercel Workflow.

## First Launch Environment Variables

The Deploy Button intentionally does not collect provider credentials up front. After the Vercel shell exists, follow `docs/first-launch.md` and set these variables in Vercel Project Settings:

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

If you do not have template IDs yet, configure Google OAuth locally and run:

```bash
npm run setup:google-templates -- --folder-id <GDRIVE_ROOT_FOLDER_ID>
```

The command creates user-owned Google Docs and Sheets starter templates and prints the two template IDs to paste into Vercel.

The app uses these runtime defaults when the variables are not set. Set them manually in Vercel only when changing the starter behavior:

| Variable | Default |
|---|---|
| `AGENT_WORKSPACE_PROVIDER` | `vercel-sandbox` |
| `PINECONE_INDEX` | `estimations` |
| `AGENCY_PROFILE_PATH` | Built-in starter agency profile |
| `NODE_ENV` | Vercel-provided runtime context |

Add optional, seeding, or branding variables later in the Vercel project settings only when needed: `BRAVE_SEARCH_API_KEY`, `FIGMA_API_KEY`, `SLACK_OPS_CHANNEL_ID`, `GDRIVE_OUTPUT_FOLDER_ID`, `GDRIVE_ESTIMATIONS_FOLDER_ID`, `GDRIVE_PROPOSALS_FOLDER_ID`, `AGENCY_PROFILE_PATH`, `AGENCY_NAME`, `AGENCY_ACCENT_COLOR`, and `CASE_STUDIES_BASE_URL`.

First launch can succeed with an empty Pinecone index, but retrieval quality improves only after seeding native Google Sheets estimations, Google Docs proposals, or public case studies. Before running `npm run seed`, set both `GDRIVE_ESTIMATIONS_FOLDER_ID` and `GDRIVE_PROPOSALS_FOLDER_ID` locally and run `npm run doctor:seed`.

## Post-Deploy Setup

After Vercel creates the project:

1. Open the deployed app's `/api/health` endpoint and verify it returns `{"status":"ok","runtime":"vercel","workflow":"enabled"}`.
2. Run `npm run build` and `npm run check:vercel-output` locally when diagnosing deployment output. The check must confirm both API functions and Workflow runtime functions are present in `.vercel/output`.
3. Set required provider environment variables in Vercel.
4. Redeploy after environment changes.
5. Run `npm run doctor:first-launch -- --health-url https://<your-vercel-domain>` from a local checkout. Use the same canonical domain you will paste into Slack.
6. In Slack, add bot scopes `app_mentions:read`, `channels:history`, `chat:write`, `commands`, and `files:read`; add `groups:history` only if private channels should work.
7. In Slack, set the Events API request URL to the exact tested ingress URL: `https://<your-vercel-domain>/api/slack/events`.
8. Subscribe to bot event `message.channels`. Do not subscribe `app_mention` or `message.im` for first launch unless matching handlers are added and tested.
9. In Slack, set the slash command request URL to `https://<your-vercel-domain>/api/slack/events`.
10. Install or reinstall the Slack app after changing scopes or request URLs.
11. Send a test RFP in Slack with at least 20 characters, such as `!estimate Build a customer portal with authentication`, and confirm a Workflow run starts in Vercel.

Use `docs/first-launch.md` for the guided first run and `docs/setup.md` for provider-specific setup details.

## Local Development

Use the Vercel CLI against the cloned project and environment. No separate database or local queue worker is required.

```bash
npm run dev:vercel
```

To smoke-test Sandbox credentials:

```bash
npm run check:vercel-sandbox
```
