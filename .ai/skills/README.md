# Skills

On-demand instruction sets that turn a general-purpose agent into a specialist. Skills are loaded when the task matches — they are NOT always-on context.

## Structure

Each skill is a directory with:
- `SKILL.md` — the main instruction file (required)
- `references/` — deeper reference docs loaded on demand (optional)

## Available Skills

| Skill | Purpose |
|-------|---------|
| `add-mcp-server` | Guide for creating new MCP tool servers |
| `code-review` | Project-specific code review checklist |

## When to Use

- Use `add-mcp-server` when adding a new MCP server or tools to an existing one
- Use `code-review` when reviewing completed work before committing
