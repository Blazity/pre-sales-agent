---
name: first-launch
description: Use when guiding a user from a fresh OSS deployment to the first successful Slack-driven estimation run
---

# First Launch

Guide the operator from a fresh Vercel deployment to the first successful Slack-driven estimation run. Keep a visible checklist and advance one concrete step at a time.

## Principles

- Use deploy-first onboarding: get the Vercel shell online, then configure providers and redeploy.
- Default runtime is Vercel Functions for ingress, Vercel Workflow for durable execution, and Vercel Sandbox for agent workspace isolation.
- Do not assume every step can be automated. Tell the operator when a dashboard action is required.
- Never ask the user to paste secrets into chat. Tell them where to set values locally or in Vercel.
- Prefer verification commands when they exist.
- Stop on blockers and give concrete diagnosis steps.

## Entry Point

Start by identifying the user's state:

- Path A: no Vercel deployment yet.
- Path B: Vercel project already exists.

If Path A:

1. Have them deploy the shell with the README Deploy Button.
2. Ask for or infer the Vercel domain only after deploy.
3. Verify `/api/health`.
4. Continue with Path B.

If Path B:

1. Verify health:

```bash
curl -s https://<vercel-domain>/api/health
```

Expected:

```json
{"status":"ok","runtime":"vercel","workflow":"enabled"}
```

## Checklist

- [ ] Vercel shell deployed
- [ ] `/api/health` returns expected payload
- [ ] Local checkout installed with `npm install`
- [ ] Project skills discoverable through `.claude/skills`, `.agents/skills`, or `.cursor/skills`
- [ ] `npm run build` emits API and Workflow runtime functions
- [ ] `npm run check:vercel-output` passes
- [ ] Google OAuth client created
- [ ] `GOOGLE_REFRESH_TOKEN` generated
- [ ] Drive root folder chosen
- [ ] `npm run setup:google-templates` completed or existing templates selected
- [ ] Required Vercel env vars set
- [ ] Vercel redeployed after env changes
- [ ] Slack bot scopes configured exactly
- [ ] Slack Events subscriptions match supported triggers
- [ ] Slack Events URL configured
- [ ] `/estimate` command configured
- [ ] Slack app reinstalled
- [ ] Bot invited to channel
- [ ] `npm run doctor:first-launch -- --health-url <url>` passes
- [ ] First `!estimate` or `/estimate` starts a Vercel Workflow run
- [ ] Google Docs and Sheets outputs are created

## Required Environment Variables

- `ANTHROPIC_API_KEY`: Anthropic console.
- `SLACK_BOT_TOKEN`: Slack app OAuth page.
- `SLACK_SIGNING_SECRET`: Slack app basic information.
- `GOOGLE_CLIENT_ID`: Google Cloud OAuth client.
- `GOOGLE_CLIENT_SECRET`: Google Cloud OAuth client.
- `GOOGLE_REFRESH_TOKEN`: `npx tsx scripts/get-google-token.ts`.
- `GDRIVE_ROOT_FOLDER_ID`: Google Drive folder URL.
- `GDRIVE_TEMPLATE_ID`: `npm run setup:google-templates` or existing Doc ID.
- `GSHEETS_TEMPLATE_ID`: `npm run setup:google-templates` or existing Sheet ID.
- `PINECONE_API_KEY`: Pinecone console.
- `VOYAGE_API_KEY`: Voyage console.

## Verification Commands

```bash
npm run typecheck
npm test
npm run build
npm run check:vercel-output
npm run doctor:first-launch -- --health-url https://<vercel-domain>
```

Use offline doctor mode when provider credentials are not available locally:

```bash
npm run doctor:first-launch -- --offline
```

## Common Blockers

| Symptom | Likely Cause | Next Step |
|---|---|---|
| `/api/health` is unreachable | Vercel deployment failed or wrong domain | Check Vercel deployment logs and verify the domain |
| Slack URL verification fails | Wrong request URL, missing signing secret, or env not redeployed | Use `/api/slack/events`, set env, redeploy |
| Slash command works but channel messages do not | Missing event subscription or bot not in channel | Subscribe to `message.channels` and invite the bot |
| Slack posts "workflow started" but no thread updates happen | Workflow runtime functions are missing from deployment | Run `npm run build` and `npm run check:vercel-output`; redeploy only after both API and Workflow functions are emitted |
| Google OAuth fails | Refresh token generated with the wrong OAuth client | Regenerate `GOOGLE_REFRESH_TOKEN` with the same client |
| Google Drive returns 403 | Root folder or templates are not accessible to the OAuth account | Share folders/templates or regenerate templates |
| Pinecone dimension mismatch | Index was created with a model other than Voyage `voyage-3` | Recreate and seed the index with 1024 dimensions and cosine metric |
| Workflow does not start | Vercel env or Workflow deployment issue | Check Vercel Workflow and Function logs, then run `npm run build` locally |
| Sandbox workspace fails on Vercel | Vercel Sandbox credentials or runtime setting missing | Run `npm run check:vercel-sandbox` and inspect Vercel env vars |
