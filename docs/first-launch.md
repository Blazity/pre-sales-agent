# First Launch

This guide gets a fresh OSS deployment from "project created" to the first successful Slack estimation run.

The intended flow is **deploy first, configure immediately after**. Vercel gives you the public URL that Slack needs, so do not try to finish every provider setup before creating the Vercel project.

## Path A: You Have Not Deployed Yet

1. Click the Deploy with Vercel button in `README.md`.
2. Create the Vercel project from your fork or cloned repository.
3. Let the shell deploy first.
4. Open:

```text
https://<your-vercel-domain>/api/health
```

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

In Vercel Project Settings -> Environment Variables, set:

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

Redeploy after changing environment variables.

## 6. Run the Setup Doctor

From the local checkout:

```bash
npm run doctor:first-launch -- --health-url https://<your-vercel-domain>
```

The doctor checks local env presence, Vercel health, Google OAuth/template access, Slack auth, and Pinecone access. It does not print secret values.

## 7. Configure Slack

In your Slack app:

1. Add bot scopes: `chat:write`, `commands`, `files:read`, `channels:history`.
2. Add `groups:history` only if private channels should work.
3. Set Events API request URL:

```text
https://<your-vercel-domain>/api/slack/events
```

4. Subscribe to `message.channels`.
5. Create `/estimate` with the same request URL.
6. Reinstall the Slack app.
7. Invite the bot to the target channel.

## 8. Optional: Seed Knowledge Base

First launch can work without curated historical data. Seed after the first successful run unless you already have past estimates/proposals ready.

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

First launch is complete when:

- Slack acknowledges the request.
- A Vercel Workflow run starts.
- The Slack thread gets progress or final output.
- Google Docs and Sheets outputs appear in the configured Drive folder.

## Common Failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `/api/health` is not reachable | Vercel deployment failed or wrong URL | Check Vercel deployment logs and domain |
| Slack URL verification fails | Wrong request URL or signing secret missing | Use `/api/slack/events`, set env, redeploy |
| Slack command works but messages do not | Event subscription or bot channel invite missing | Subscribe to `message.channels` and invite the bot |
| Google token refresh fails | OAuth client or refresh token mismatch | Re-run `scripts/get-google-token.ts` |
| Google template copy fails | Template not shared with OAuth account | Share templates or regenerate them with the OAuth account |
| Drive output fails with 403 | Root folder not writable | Share the folder or use a folder owned by the OAuth account |
| Pinecone returns dimension errors | Index was created with the wrong embedding model | Recreate and seed the index with `voyage-3` settings |
| Workflow does not start | Vercel env or Workflow deployment issue | Check Vercel logs and rerun `npm run build` locally |
