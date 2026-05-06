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
2. Ask for or infer the stable Vercel production/project domain only after deploy. Do not use an immutable deployment-specific preview URL for Slack.
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
- [ ] Stable production/project domain selected for Slack
- [ ] `/api/health` returns expected payload
- [ ] Local checkout installed with `npm install`
- [ ] Project skills discoverable through `.claude/skills`, `.agents/skills`, or `.cursor/skills`
- [ ] `npm run build` emits API, Workflow, and MCP server bundle output
- [ ] `npm run check:vercel-output` passes
- [ ] Vercel Sandbox snapshot env considered for faster runs
- [ ] Private repo clone token set when needed
- [ ] Google OAuth client created
- [ ] `GOOGLE_REFRESH_TOKEN` generated
- [ ] Drive root folder chosen
- [ ] `npm run setup:google-templates` completed or existing templates selected
- [ ] Required Vercel env vars set
- [ ] Vercel redeployed after env changes
- [ ] Slack bot scopes configured exactly
- [ ] Slack Events subscriptions match supported triggers
- [ ] Slack Events URL configured with the tested stable domain
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

## Vercel Sandbox Environment Variables

- `VERCEL_TOKEN`: Vercel account token, set in Build env to create the template sandbox snapshot.
- `VERCEL_TEAM_ID`: Vercel team id, set in Build env with `VERCEL_TOKEN`.
- `VERCEL_PROJECT_ID`: Vercel project id, set in Build env with `VERCEL_TOKEN`.
- `AGENT_REPO_TOKEN`: Preferred private Git repo token. Required when a private repo must be cloned for snapshot creation or runtime fallback.
- `GITHUB_TOKEN`: Alternative private Git repo token name. The runtime accepts either `AGENT_REPO_TOKEN` or `GITHUB_TOKEN`.
- `AGENT_REPO_URL`: Optional Git remote override. Otherwise Vercel Git metadata or the starter repo URL is used.
- `AGENT_REPO_REVISION`: Optional branch/SHA override. Otherwise Vercel Git metadata or `main` is used.
- `AGENT_REPO_USERNAME`: Optional Git username override. Usually leave unset for personal access tokens.

For public repos, the repo token is not needed. For private repos, use a fine-grained GitHub token with read access to the repository contents, or a classic token with repo access. Put the token in Vercel Build env if snapshot creation must clone a private repo; also put it in Runtime env if the project may fall back to per-job git clone.

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
| Slack URL verification fails | Wrong request URL, stale preview/deployment URL, missing signing secret, or env not redeployed | Use the stable production domain plus `/api/slack/events`, set Production env, redeploy, rerun doctor |
| Slash command works but channel messages do not | Missing event subscription or bot not in channel | Subscribe to `message.channels` and invite the bot |
| Slack posts "workflow started" but no thread updates happen | Workflow runtime functions or bundled MCP server entrypoints are missing from deployment | Run `npm run build` and `npm run check:vercel-output`; redeploy only after API, Workflow, and MCP bundle checks pass |
| Slack thread reports workflow failure after startup | Provider env, template access, Pinecone/Voyage access, or MCP startup failed inside the workflow | Check Vercel Workflow logs, run `doctor:first-launch`, fix the reported setup issue, redeploy, and retry |
| Google OAuth fails | Refresh token generated with the wrong OAuth client | Regenerate `GOOGLE_REFRESH_TOKEN` with the same client |
| Google Drive returns 403 | Root folder or templates are not accessible to the OAuth account | Share folders/templates or regenerate templates |
| Pinecone dimension mismatch | Index was created with a model other than Voyage `voyage-3` | Recreate and seed the index with 1024 dimensions and cosine metric |
| Workflow does not start | Vercel env or Workflow deployment issue | Check Vercel Workflow and Function logs, then run `npm run build` locally |
| Sandbox workspace fails on Vercel | Vercel Sandbox credentials or runtime setting missing | Run `npm run check:vercel-sandbox` and inspect Vercel env vars |
