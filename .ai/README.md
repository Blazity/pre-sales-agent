# AI Operating Layer

This directory documents how agents should understand, operate, and review this repository.

Always-loaded context should stay small and stable in `AGENTS.md` and `CLAUDE.md`. Deeper context lives here so agents can load it only when relevant.

## Files

- `architecture.md` - current Vercel-first agent architecture, pipeline stages, and MCP boundaries.
- `guardrails.md` - prompt-injection, tool-use, data-handling, and output-quality guardrails.
- `mcp-tools.md` - MCP tool inventory by server and pipeline stage.
- `lessons.md` - known pitfalls and recovery steps discovered while building the project.
- `evals/` - lightweight eval-style expectations for prompt boundaries, tool routing, and code-review severity.
- `checks/` - static checks that keep AI docs aligned with code and CI.
- `skills/` - on-demand workflows for common tasks.

## Maintenance Rules

- Keep `AGENTS.md` and `CLAUDE.md` concise.
- Update `architecture.md` when runtime architecture changes.
- Update `mcp-tools.md` whenever MCP tools are added, removed, renamed, or exposed through `allowedTools`.
- Update `guardrails.md` when prompt-boundary, external-content, or data-handling policy changes.
- Update `lessons.md` only for recurring pitfalls with concrete recovery steps.
- Run `npm run check:ai-docs` after changing this directory.
