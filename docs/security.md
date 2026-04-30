# Security

Security priorities:

- Do not commit secrets.
- Keep user-provided RFP content inside explicit prompt boundary tags.
- Verify Slack request signatures before accepting events.
- Acknowledge Slack quickly and move long work to durable background processing.
- Keep MCP servers isolated from application internals.
- Allowlist Google Drive folders used by agent tools.
- Avoid logging raw RFPs, full document contents, tokens, or refresh tokens.
- Run typecheck, tests, dependency audit, secret scanning, and MCP isolation checks before release.

Baseline commands:

```bash
npm run typecheck
npm test
npm run audit:high
npm run scan:secrets
npm run check:mcp-isolation
```
