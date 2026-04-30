# Contributing

This project is pre-1.0.

Before opening a pull request:

```bash
npm install
npm run typecheck
npm test
npm run audit:high
npm run check:mcp-isolation
```

MCP servers in `src/mcp-servers/` must remain standalone stdio processes. Do not import from `src/` application internals.

Do not include secrets, real customer documents, private proposal text, or real Google Drive folder IDs in examples.
