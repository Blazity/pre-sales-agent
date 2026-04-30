# First Launch Onboarding Design

## Goal

Make the OSS first-run path explicit and guided so a new adopter can get from Deploy Button to the first successful Slack-driven estimation without guessing the order of provider setup.

## Deployment Philosophy

The starter should optimize for **deploy first, configure immediately after**.

This is the most logical OSS path because Vercel gives the public app URL early, and Slack configuration depends on that URL. Requiring users to fully configure Google, Slack, Pinecone, Voyage, templates, and environment variables before seeing a deployed app creates too much setup pressure.

The intended mental model:

1. Deploy the shell on Vercel.
2. Verify `/api/health`.
3. Complete provider setup locally and in Vercel.
4. Redeploy after environment changes.
5. Configure Slack with the Vercel URL.
6. Run the first estimate.

## Entry Points

The first-launch flow should support two user states:

- **Path A: Not deployed yet**
  - User starts from the repo.
  - Guide them to click Deploy with Vercel first.
  - Then continue from the deployed health check.

- **Path B: Already deployed**
  - User starts from an existing Vercel project.
  - Guide them through health check, provider setup, env completion, redeploy, Slack configuration, and first run.

## Components

### Human Checklist

Add `docs/first-launch.md` as the canonical checklist. It should be concise, ordered, and action-oriented:

1. Deploy shell on Vercel.
2. Confirm health endpoint.
3. Prepare provider credentials.
4. Configure Google OAuth.
5. Create Drive root folder.
6. Run `npm run setup:google-templates`.
7. Add required Vercel env vars.
8. Redeploy.
9. Configure Slack app URLs and scopes.
10. Optional: seed knowledge base.
11. Send first `!estimate` request.
12. Verify Vercel Workflow, Slack thread, and Google outputs.

### Superpowers Skill

Add `.ai/skills/first-launch/SKILL.md`.

This skill should guide an agent or human operator through the checklist step by step. It should not assume everything can be automated. It should:

- Ask which entry point applies: not deployed yet or already deployed.
- Keep a running checklist.
- Explain where each value comes from.
- Run local verification commands when possible.
- Tell the user when a dashboard action is required.
- Stop at blockers with concrete diagnosis steps.

### Doctor Script

Add `scripts/doctor-first-launch.ts` and `npm run doctor:first-launch`.

The script should verify what can be verified from a local checkout:

- Node version.
- Required env presence.
- Google OAuth token refresh.
- Drive root folder is writable.
- Google Docs and Sheets templates are readable/copyable.
- Anthropic key presence.
- Voyage key basic reachability if safe and cheap.
- Pinecone key/index access.
- Slack bot token auth test.
- Vercel health endpoint if `VERCEL_PROJECT_URL` or a CLI flag is provided.

The doctor script should report grouped PASS/WARN/FAIL results and never print secrets.

## First-Run Defaults

Knowledge-base seeding should be positioned as optional for first launch. Empty or sparse retrieval should not block a first successful estimate. The first-launch flow should recommend seeding after the first successful run unless the user already has past estimates/proposals ready.

Template generation is part of first launch for users without existing templates. The generated template IDs should be pasted into Vercel env vars before redeploying.

## Failure Triage

The skill and docs should include common first-run failures:

- Health endpoint not reachable.
- Vercel env vars missing after deploy.
- Slack request URL verification fails.
- Slack bot not invited to channel.
- Google OAuth refresh fails.
- Google Drive 403 on template copy or output folder.
- Google template ID points to an inaccessible file.
- Pinecone index dimension mismatch.
- Workflow run does not start.
- Workflow starts but fails inside MCP tool execution.

## Success Criteria

First launch is complete when:

- `/api/health` returns `{"status":"ok","runtime":"vercel","workflow":"enabled"}`.
- Slack accepts `!estimate` or `/estimate`.
- A Vercel Workflow run starts.
- The agent posts progress or final output to the Slack thread.
- Google Docs and Sheets outputs are created in the configured Drive folder.

## Documentation Updates

Update:

- `README.md` to point users to `docs/first-launch.md` after Deploy Button.
- `docs/setup.md` to become the provider reference, not the primary linear first-run guide.
- `docs/deployment/vercel.md` to reflect deploy-first onboarding and redeploy-after-env guidance.
- `docs/configuration.md` to mention `doctor:first-launch`.

## Out of Scope

- A web onboarding wizard.
- Automatic creation of third-party provider accounts.
- Runtime auto-creation of missing Google templates.
- Storing secrets outside Vercel/local env.
