# Pre-Sales Agent — Claude Code Notes

@AGENTS.md

## Claude Code Workflow

- Read `.ai/lessons.md` at session start for known pitfalls.
- Use `.ai/skills/` only when the task matches a skill. Skills are on-demand workflows, not always-loaded project memory.
- For implementation tasks, preserve the production estimation agent's output quality. Do not rewrite `src/agents/orchestrator.ts` prompt text unless the task explicitly asks for prompt work and includes eval-backed acceptance criteria.
- For AI docs changes, run `npm run check:ai-docs` in addition to the standard gates.
- For first-launch or OSS onboarding work, use `.ai/skills/first-launch/SKILL.md`.
- For MCP tool additions, use `.ai/skills/add-mcp-server/SKILL.md`.
- For review, use `.ai/skills/code-review/SKILL.md`.
