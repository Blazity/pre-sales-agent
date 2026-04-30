# Vercel Deployment

Vercel is the target default deployment platform for this starter.

Planned service mapping:

- Slack ingress: Vercel Functions.
- Long-running jobs: Vercel Queues or Vercel Workflow.
- Agent workspace isolation: Vercel Sandbox.
- Redis-style state: Vercel Marketplace Redis, such as Upstash Redis.
- Generated documents: Google Workspace by default.

The current implementation still contains the original Express and BullMQ runtime. Use it locally while the Vercel-native runtime is implemented.
