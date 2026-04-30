# Setup Guide

This guide starts from a fresh clone or a Deploy Button install and gets the starter to a working Slack-to-Google-Workspace estimation flow.

## Prerequisites

- Node.js 20 or newer.
- A Slack workspace where you can create and install apps.
- A Google Cloud project with OAuth credentials.
- Anthropic, Pinecone, and Voyage API keys.
- A Vercel project with Workflow enabled by the deployment.

## 1. Verify the Clone

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
```

Do not commit `.env`. For deployed projects, set production values in Vercel Environment Variables.

## 2. Create the Slack App

Create a Slack app for the workspace and configure it for HTTP request URLs.

Required bot token scopes:

| Scope | Why it is needed |
|---|---|
| `chat:write` | Post status updates, clarification questions, and final links |
| `commands` | Receive the `/estimate` slash command |
| `files:read` | Download files attached to estimation requests |
| `channels:history` | Receive `!estimate` messages and read public-channel threads |
| `groups:history` | Optional, only if the bot should work in private channels |

After the Vercel deployment has a public URL:

1. Set the Events API request URL to `https://<your-vercel-domain>/api/slack/events`.
2. Subscribe the bot to `message.channels`.
3. Subscribe the bot to `message.groups` if private-channel support is needed.
4. Create the `/estimate` slash command with the same request URL.
5. Install or reinstall the app into the workspace.

Set these environment variables:

| Variable | Source |
|---|---|
| `SLACK_BOT_TOKEN` | OAuth and Permissions -> Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | Basic Information -> Signing Secret |
| `SLACK_OPS_CHANNEL_ID` | Optional channel for operational alerts |

`SLACK_APP_TOKEN` is only needed if you add Socket Mode support. The Vercel path uses Slack HTTP Events API and does not require it.

## 3. Configure Google Workspace

Enable these APIs in the Google Cloud project:

- Google Drive API.
- Google Docs API.
- Google Sheets API.
- Google Slides API.

Create an OAuth client and add this local redirect URI:

```text
http://localhost:3333/callback
```

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then generate a refresh token:

```bash
npx tsx scripts/get-google-token.ts
```

Set the returned `GOOGLE_REFRESH_TOKEN`. The account that grants OAuth access must be able to read input folders and templates, and create output documents in the configured root folder.

Create or choose a root Drive folder and set:

| Variable | Value |
|---|---|
| `GDRIVE_ROOT_FOLDER_ID` | Folder where each estimation workspace is created |
| `GDRIVE_OUTPUT_FOLDER_ID` | Optional override for manual test runs |
| `GDRIVE_ESTIMATIONS_FOLDER_ID` | Optional source folder of past estimation spreadsheets for seeding |
| `GDRIVE_PROPOSALS_FOLDER_ID` | Optional source folder of past proposal documents for seeding |

## 4. Create Document Templates

Create a Google Docs proposal template:

```bash
npx tsx scripts/create-template.ts --folder-id <GDRIVE_ROOT_FOLDER_ID>
```

Set `GDRIVE_TEMPLATE_ID` to the created document ID. The starter expects these placeholders to exist on the cover page:

| Placeholder | Filled with |
|---|---|
| `{{CLIENT_NAME}}` | Estimated client name |
| `{{PROJECT_NAME}}` | Estimated project name |
| `{{DATE}}` | Generation date |

Create a Google Sheets estimation template manually and set `GSHEETS_TEMPLATE_ID` to its spreadsheet ID. The first sheet should have headers in row 1, optional descriptions in row 2, and writable rows starting at row 3.

Expected columns:

| Column | Header |
|---|---|
| A | Module |
| B | Action item |
| C | Effort MD |
| D | Effort MD with risk |
| E | Type |
| F | Optional |
| G | Risk |
| H | Assumptions |
| I | Figma link |

The sheet generator copies the template, clears rows from `A3:Z`, writes raw user-derived values to prevent formula injection, and inserts subtotal formulas itself.

## 5. Configure Retrieval

The knowledge base uses Pinecone with Voyage embeddings. The code is locked to:

| Setting | Value |
|---|---|
| Embedding model | `voyage-3` |
| Dimension | `1024` |
| Metric | `cosine` |
| Default Pinecone index | `estimations` |

Set:

| Variable | Purpose |
|---|---|
| `PINECONE_API_KEY` | Pinecone API access |
| `PINECONE_INDEX` | Defaults to `estimations` |
| `VOYAGE_API_KEY` | Embedding API access |
| `VOYAGE_RPM` | Optional local seeding rate limit, defaults to `3` |

Seed from Google Drive folders:

```bash
npm run seed
```

For later updates:

```bash
npx tsx scripts/seed-knowledge-base.ts --incremental
```

The seeding script creates the Pinecone index if it does not exist and the API key has permission.

## 6. Configure Agency Profile

The app uses the public starter profile if no profile environment variables are set. These values are useful only when customizing templates, seed scripts, or a real agency profile:

```text
AGENCY_PROFILE_PATH=config/agency.example.json
AGENCY_NAME=Example Digital Studio
AGENCY_ACCENT_COLOR=#F97316
CASE_STUDIES_BASE_URL=https://example.com
```

For a real implementation, copy `config/agency.example.json` to an untracked file, replace claims and proof points with verified public information, and set `AGENCY_PROFILE_PATH` to that file.

## 7. Deploy on Vercel

Use the Deploy Button in the README, then confirm:

```text
https://<your-vercel-domain>/api/health
```

Expected response:

```json
{"status":"ok","runtime":"vercel"}
```

Vercel defaults:

| Variable | Default |
|---|---|
| `AGENT_WORKSPACE_PROVIDER` | `vercel-sandbox` |
| `NODE_ENV` | `production` |

The Deploy Button does not ask for these defaults.

## 8. Test the Workflow

Invite the Slack bot to the target channel, then send either:

```text
!estimate Build a customer portal with authentication, admin reporting, Stripe billing, and CRM sync.
```

or:

```text
/estimate Build a customer portal with authentication, admin reporting, Stripe billing, and CRM sync.
```

A healthy run should acknowledge the request in Slack, start a Vercel Workflow run, create Google Docs and Sheets outputs, and post final links back to the Slack thread.
