---
name: first-launch
description: Use when guiding a user from a fresh OSS deployment to the first successful Slack-driven estimation run
---

# First Launch

Guide the operator from Deploy Button to first successful agent run. Keep a visible checklist and advance one concrete step at a time.

## Principles

- Use deploy-first onboarding: get the Vercel shell online, then configure providers and redeploy.
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

Track these items:

- [ ] Vercel shell deployed
- [ ] `/api/health` returns expected payload
- [ ] Local checkout installed with `npm install`
- [ ] Google OAuth client created
- [ ] `GOOGLE_REFRESH_TOKEN` generated
- [ ] Drive root folder chosen
- [ ] `npm run setup:google-templates` completed or existing templates selected
- [ ] Required Vercel env vars set
- [ ] Vercel redeployed after env changes
- [ ] Slack scopes configured
- [ ] Slack Events URL configured
- [ ] `/estimate` command configured
- [ ] Slack app reinstalled
- [ ] Bot invited to channel
- [ ] `npm run doctor:first-launch -- --health-url <url>` passes
- [ ] First `!estimate` or `/estimate` starts a Vercel Workflow run
- [ ] Google Docs and Sheets outputs are created

## Required Environment Variables

Explain where values come from:

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

Use:

```bash
npm run typecheck
npm test
npm run doctor:first-launch -- --health-url https://<vercel-domain>
```

Use offline doctor mode when provider credentials are not available locally:

```bash
npm run doctor:first-launch -- --offline
```

## Common Blockers

- Health endpoint unreachable: check Vercel deployment logs and the domain.
- Slack verification fails: confirm `/api/slack/events`, signing secret, env redeploy.
- Bot sees slash command but not channel messages: subscribe to `message.channels` and invite bot.
- Google OAuth fails: regenerate refresh token with the same OAuth client.
- Google Drive 403: root folder/templates are not accessible to the OAuth account.
- Pinecone dimension mismatch: recreate index for `voyage-3`, 1024 dimensions, cosine.
- Workflow does not start: check Vercel envs and Workflow deployment logs.
