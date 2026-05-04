# Skills

On-demand instruction sets for recurring project tasks. Skills are loaded only when the task matches.

Always-loaded repo facts belong in `AGENTS.md` and `CLAUDE.md`. Architecture, guardrails, MCP inventory, eval expectations, and lessons live one level up in `.ai/`.

## Structure

Each skill directory contains:

- `SKILL.md` — required workflow instructions.
- `references/` — deeper references loaded only when needed.

## Available Skills

| Skill | Use When |
|---|---|
| `add-mcp-server` | Adding a new MCP server or adding tools to an existing MCP server. |
| `code-review` | Reviewing completed work before commit, push, PR, or merge. |
| `first-launch` | Guiding a fresh OSS deployment to the first successful Slack-driven estimation. |

Run `npm run check:ai-docs` after changing skills that mention repo facts, tools, gates, or runtime architecture.
