# Vercel Deployment

Vercel is the target default deployment platform for this starter.

Default service mapping:

- Slack ingress: Vercel Functions.
- Long-running jobs: Vercel Queues, topic `estimations`.
- Agent workspace isolation: Vercel Sandbox, selected by `AGENT_WORKSPACE_PROVIDER=vercel-sandbox`.
- Redis-style state: Vercel Marketplace Redis, such as Upstash Redis.
- Generated documents: Google Workspace by default.

## Routes

- `api/health.ts` exposes a Vercel health endpoint.
- `api/slack/events.ts` mounts the Slack Bolt receiver for Slack Events API traffic.
- `api/queues/estimations.ts` consumes Vercel Queue messages and runs the estimation workflow.

## Local Fallback

BullMQ remains available for local development or self-hosted runs. Set `JOB_QUEUE_PROVIDER=bullmq` and run `npm run dev` with Redis.

For Vercel-style local development, install the Vercel CLI, link the project, pull env vars, and run:

```bash
npm run dev:vercel
```

To smoke-test Sandbox credentials:

```bash
npm run check:vercel-sandbox
```
