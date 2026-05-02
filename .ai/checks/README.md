# AI Checks

`check-ai-docs-drift.ts` verifies that the always-loaded AI guidance stays aligned with the implementation.

It checks default branch references, stale runtime claims, `wait_for_reply` timeout docs, MCP tool documentation, orchestrator tool mappings, code review gate docs, and the `check:ai-docs` package script.

Run it with:

```bash
npm run check:ai-docs
```

The command exits with status 1 and prints findings when documentation or scripts drift from source.
