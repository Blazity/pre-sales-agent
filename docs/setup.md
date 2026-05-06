# Setup Guide

This guide is the provider setup reference. For the guided implementation path from Vercel deployment to the first successful run, start with `docs/first-launch.md` and return here only when you need provider-specific detail.

## Prerequisites

- Node.js 20 or newer.
- A Slack workspace where you can create and install apps.
- A Google Cloud project with OAuth credentials.
- Anthropic, Pinecone, and Voyage API keys.
- A Vercel project with Workflow enabled by the deployment.

The supported deployment target for this starter is Vercel. The setup steps assume Vercel Functions, Vercel Workflow, and Vercel Sandbox.

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
| `app_mentions:read` | Reserved for app-mention support; keep configured so the app can be extended without reinstalling scopes |
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

Use the stable Vercel production/project domain, such as `https://<project>.vercel.app` or your custom production domain. Do not use an immutable URL from a single Vercel deployment page unless you also intend to keep Slack pinned to that exact deployment.

The first-launch runtime handles `!estimate` channel messages and `/estimate` slash commands. Do not subscribe `app_mention` or `message.im` for first launch unless matching handlers are added and tested.

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

## 4. Create Google Templates

If you do not already have templates, generate starter templates in your Google Drive:

```bash
npm run setup:google-templates -- --folder-id <GDRIVE_ROOT_FOLDER_ID>
```

The command creates:

- A Google Docs offer template with a styled cover page and body space for generated proposal sections.
- A Google Sheets estimation template with the expected columns, frozen header rows, widths, dropdowns, checkbox validation, and starter formatting.

It prints:

```text
GDRIVE_TEMPLATE_ID=<created-doc-id>
GSHEETS_TEMPLATE_ID=<created-sheet-id>
```

Set those values locally and in Vercel. The templates are owned by the Google account that granted OAuth access, so adopters can edit them after creation.

The Docs template uses these cover placeholders:

| Placeholder | Filled with |
|---|---|
| `{{CLIENT_NAME}}` | Estimated client name |
| `{{PROJECT_NAME}}` | Estimated project name |
| `{{DATE}}` | Generation date |

The Sheets template uses row 1 for headers, row 2 for descriptions, and writable rows from row 3 onward:

| Column | Header |
|---|---|
| A | Module |
| B | Action Item |
| C | Effort (MD) |
| D | Risk-adjusted Effort (MD) |
| E | Type |
| F | Optional |
| G | Risk |
| H | Assumptions |
| I | Figma Link |

The sheet generator copies the template, clears rows from `A3:Z`, writes raw user-derived values to prevent formula injection, and inserts subtotal formulas itself.

To use an existing branded template instead, keep the same Doc placeholders and Sheet columns, then set `GDRIVE_TEMPLATE_ID` and `GSHEETS_TEMPLATE_ID` to your file IDs.

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
| `GDRIVE_ESTIMATIONS_FOLDER_ID` | Required when running `npm run seed`; source folder of native Google Sheets |
| `GDRIVE_PROPOSALS_FOLDER_ID` | Required when running `npm run seed`; source folder of native Google Docs |

`GDRIVE_ESTIMATIONS_FOLDER_ID` and `GDRIVE_PROPOSALS_FOLDER_ID` are optional for first launch, but they are required for knowledge-base seeding. The seed script does not read local folders. It indexes manually curated Google Drive source folders that the OAuth account can read.

Validate the seed setup before indexing:

```bash
npm run doctor:seed
```

Seed from Google Drive folders only after the doctor passes or reports only acceptable empty-folder warnings:

```bash
npm run seed
```

First launch can succeed with an empty Pinecone index, but retrieval quality improves only after seeding native Google Sheets estimations, Google Docs proposals, or public case studies from `CASE_STUDIES_BASE_URL`. Uploaded `.xlsx` files and `.docx` files in Drive are skipped by knowledge-base seeding until converted to native Google Sheets or Google Docs.

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

```bash
npm run build
npm run check:vercel-output
```

The output check must confirm both API functions and Workflow runtime functions are present in `.vercel/output`.
It also confirms the bundled MCP server entrypoints are present under the Workflow runtime output. Without those bundles, Slack can acknowledge a request but the agent workflow cannot start its tools.

```text
https://<your-vercel-domain>/api/health
```

Use the stable production/project domain for first launch. Vercel also shows deployment-specific preview URLs; those are useful for inspection, but Slack should use the canonical domain that receives later redeploys.

Expected response:

```json
{"status":"ok","runtime":"vercel","workflow":"enabled"}
```

Vercel defaults:

| Variable | Default |
|---|---|
| `AGENT_WORKSPACE_PROVIDER` | `vercel-sandbox` |
| `NODE_ENV` | `production` |

The Deploy Button does not ask for these defaults.

### Sandbox template snapshot (recommended)

Each estimation runs in its own Vercel Sandbox. By default the sandbox is built per-job by cloning your repo and running `npm ci` + `npm run build` inside it, which adds ~60–120s to every run and only works if the runtime can reach your Git source. To skip both costs, set up the build-time snapshot:

In your Vercel project settings → Environment Variables, scope these to the **Build** environment (not Runtime):

| Variable | Where to get it |
|---|---|
| `VERCEL_TOKEN` | Account Settings → Tokens → Create. Scope to the team. |
| `VERCEL_TEAM_ID` | Team Settings (top of the page). |
| `VERCEL_PROJECT_ID` | Project Settings → General. |

After redeploying, `npm run build` will create a sandbox, install + build inside it, snapshot the result, and bundle the snapshot id into the runtime function. Per-job sandboxes then start in ~5–10s with no network access required to your source repo. If the build script can't find these vars it logs a warning and the runtime falls back to git-clone.

### Private repos (only if you don't set up the snapshot)

If you skip the snapshot above and your repo is private, the runtime sandbox needs Git credentials to clone it:

| Variable | Notes |
|---|---|
| `AGENT_REPO_TOKEN` | A GitHub personal-access token (classic or fine-grained) with `repo` scope. Set in the **Runtime** environment. |
| `GITHUB_TOKEN` | Alternative name; either works. |
| `AGENT_REPO_USERNAME` | Optional — set this only if you're using a GitHub App installation token (then pass `x-access-token` here). |

Public-repo deployments don't need these.

Symptom of missing this when needed: workflow run fails with `Sandbox.create failed (400 Bad Request): {"error":...,"message":"git clone failed"}`. The recommended fix is the build-time snapshot above; the token is the workaround.

## 8. Test the Workflow

Before changing Slack, verify the exact ingress URL with:

```bash
npm run doctor:first-launch -- --health-url https://<your-vercel-domain>
```

Invite the Slack bot to the target channel, then send either:

```text
!estimate Build a customer portal with authentication, admin reporting, Stripe billing, and CRM sync.
```

or:

```text
/estimate Build a customer portal with authentication, admin reporting, Stripe billing, and CRM sync.
```

`/estimate` requires at least 20 characters of project description. Shorter input returns an ephemeral Slack rejection and does not start a workflow.

A healthy run should acknowledge the request in Slack, start a Vercel Workflow run, create Google Docs and Sheets outputs, and post final links back to the Slack thread.
