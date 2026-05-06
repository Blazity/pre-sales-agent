# First Launch

This guide gets a fresh OSS deployment from "project created" to the first successful Slack estimation run.

This guide covers the supported runtime for the starter today: Vercel Functions, Vercel Workflow, and Vercel Sandbox. It uses Slack as the default request channel and Google Workspace as the default output system.

The intended flow is **deploy first, configure immediately after**. Vercel gives you the public URL that Slack needs, so do not try to finish every provider setup before creating the Vercel project.

Slack and Google Workspace are defaults for first launch. Other ingress channels or output systems should be treated as extension work after this guide succeeds.

## Guided Onboarding Skill

If you are using an AI coding assistant in this repository, use the registered `first-launch` skill. The canonical skill lives in `.ai/skills/first-launch/SKILL.md` and is discovered through `.claude/skills`, `.agents/skills`, and `.cursor/skills`.

## Path A: You Have Not Deployed Yet

1. Click the Deploy with Vercel button in `README.md`.
2. Create the Vercel project from your fork or cloned repository.
3. Let the shell deploy first.
4. Open the stable production/project domain, not a one-off deployment preview URL:

```text
https://<your-vercel-domain>/api/health
```

Use the domain that will keep pointing at the latest production deployment, such as `https://<project>.vercel.app` or your custom production domain. Do not paste an immutable deployment URL from a single Vercel deployment page into Slack, because later redeploys with environment variables will not update that old URL.

Expected response:

```json
{"status":"ok","runtime":"vercel","workflow":"enabled"}
```

Then continue with Path B.

## Path B: You Already Have a Vercel Project

Use this checklist after the Vercel project exists.

## 1. Install Locally

```bash
npm install
cp .env.example .env
```

## 2. Prepare Provider Credentials

Collect these values:

| Provider | Required values |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| Voyage | `VOYAGE_API_KEY` |
| Pinecone | `PINECONE_API_KEY` |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` |
| Google Workspace | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, Drive folder and template IDs |
| Vercel Sandbox | `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` recommended for fast snapshots; `AGENT_REPO_TOKEN` or `GITHUB_TOKEN` required for private repo clone access |

## 3. Configure Google Workspace

Enable these Google Cloud APIs:

- Google Drive API
- Google Docs API
- Google Sheets API
- Google Slides API

Create an OAuth client with this local redirect URI:

```text
http://localhost:3333/callback
```

Generate a refresh token:

```bash
npx tsx scripts/get-google-token.ts
```

Set `GOOGLE_REFRESH_TOKEN` in `.env`.

Create a Google Drive root folder for generated estimation assets and set:

```text
GDRIVE_ROOT_FOLDER_ID=<folder-id>
```

## 4. Create Google Templates

If you do not already have templates:

```bash
npm run setup:google-templates -- --folder-id <GDRIVE_ROOT_FOLDER_ID>
```

Copy the printed values into `.env` and Vercel:

```text
GDRIVE_TEMPLATE_ID=<created-doc-id>
GSHEETS_TEMPLATE_ID=<created-sheet-id>
```

## 5. Add Vercel Environment Variables

In Vercel Project Settings -> Environment Variables, set these values for the Production environment. If you are intentionally testing a Preview deployment, set the same values for Preview too and use that preview URL consistently.

```text
ANTHROPIC_API_KEY
SLACK_BOT_TOKEN
SLACK_SIGNING_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GDRIVE_ROOT_FOLDER_ID
GDRIVE_TEMPLATE_ID
GSHEETS_TEMPLATE_ID
PINECONE_API_KEY
VOYAGE_API_KEY
```

Recommended for faster Vercel Sandbox startup, set these in the Build environment:

```text
VERCEL_TOKEN
VERCEL_TEAM_ID
VERCEL_PROJECT_ID
```

If the deployed source repository is private, also set one of these wherever the sandbox must clone the repo:

```text
AGENT_REPO_TOKEN
GITHUB_TOKEN
```

The snapshot build needs the token in the Build environment. If no snapshot is created and the runtime falls back to per-job git clone, the runtime also needs the token.

Redeploy after changing environment variables.

## 6. Run the Setup Doctor

From the local checkout:

```bash
npm run doctor:first-launch -- --health-url https://<your-vercel-domain>
```

The doctor checks local env presence, Vercel health, the deployed Slack ingress URL, Google OAuth/template access, Slack auth, and Pinecone access. It sends a signed Slack URL verification probe to `https://<your-vercel-domain>/api/slack/events`, so use the same canonical domain here that you plan to paste into Slack. It does not print secret values.

When diagnosing a stuck Workflow deployment, run:

```bash
npm run build
npm run check:vercel-output
```

The check must confirm both API functions and Workflow runtime functions are present in `.vercel/output`.
It also verifies the bundled MCP server entrypoints that the workflow spawns during the agent run. If those bundles are missing, Slack can acknowledge the request but the workflow will fail after startup.

## 7. Configure Slack

In your Slack app:

1. Add bot scopes: `app_mentions:read`, `channels:history`, `chat:write`, `commands`, `files:read`.
2. Add `groups:history` only if private channels should work.
3. Set Events API request URL to the exact Slack ingress URL tested by `doctor:first-launch`:

```text
https://<your-vercel-domain>/api/slack/events
```

4. Subscribe to bot event `message.channels`.
5. Create `/estimate` with the same request URL.
6. Reinstall the Slack app.
7. Invite the bot to the target channel.

The first-launch runtime handles `!estimate` channel messages and `/estimate` slash commands. Do not subscribe `app_mention` or `message.im` for first launch unless matching handlers are added and tested.

## 8. Optional: Seed Knowledge Base

First launch can work without curated historical data. Seed after the first successful run unless you already have past estimates/proposals ready.

Optional knowledge-base source variables:

- `GDRIVE_ESTIMATIONS_FOLDER_ID`
- `GDRIVE_PROPOSALS_FOLDER_ID`
- `CASE_STUDIES_BASE_URL`

These are optional only for first launch. If you run `npm run seed`, both Drive folder IDs must be set and readable by the Google OAuth account. The seed script reads curated Drive folders, not local folders.

Validate the seeding setup first:

```bash
npm run doctor:seed
```

First launch can succeed with an empty Pinecone index, but retrieval quality improves only after seeding native Google Sheets estimations, Google Docs proposals, or public case studies.

```bash
npm run seed
```

## 9. Run the First Estimate

In Slack:

```text
!estimate Build a customer portal with authentication, admin reporting, Stripe billing, and CRM sync.
```

Or:

```text
/estimate Build a customer portal with authentication, admin reporting, Stripe billing, and CRM sync.
```

`/estimate` requires at least 20 characters of project description. Shorter input returns an ephemeral Slack rejection and does not start a workflow.

First launch is complete when:

- Slack acknowledges the request.
- A Vercel Workflow run starts.
- The Slack thread gets progress or final output.
- Google Docs and Sheets outputs appear in the configured Drive folder.

## Common Failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `/api/health` is not reachable | Vercel deployment failed or wrong URL | Check Vercel deployment logs and domain |
| Slack URL verification fails | Wrong request URL, stale preview/deployment URL, missing signing secret, or env not redeployed | Use the stable production domain plus `/api/slack/events`, set Production env, redeploy, then rerun `doctor:first-launch` |
| Slack command works but messages do not | Event subscription or bot channel invite missing | Subscribe to `message.channels` and invite the bot |
| Google token refresh fails | OAuth client or refresh token mismatch | Re-run `scripts/get-google-token.ts` |
| Google template copy fails | Template not shared with OAuth account | Share templates or regenerate them with the OAuth account |
| Drive output fails with 403 | Root folder not writable | Share the folder or use a folder owned by the OAuth account |
| Pinecone returns dimension errors | Index was created with the wrong embedding model | Recreate and seed the index with `voyage-3` settings |
| Slack posts "workflow started" but no thread updates happen | Workflow runtime functions or bundled MCP server entrypoints are missing from deployment | Run `npm run build` and `npm run check:vercel-output`; redeploy only after API, Workflow, and MCP bundle checks pass |
| Slack thread reports workflow failure after startup | Provider env, template access, Pinecone/Voyage access, or MCP startup failed inside the workflow | Check the Vercel Workflow run logs, run `doctor:first-launch`, fix the reported setup issue, redeploy, and retry |
| Workflow does not start | Vercel env or Workflow deployment issue | Check Vercel logs and rerun `npm run build` locally |
