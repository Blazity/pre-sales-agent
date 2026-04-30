---
name: code-review
description: Use when reviewing completed work before committing or creating PRs
---

# Code Review

Project-specific code review workflow for estimation-agent.

## Workflow

1. **Scope** — identify all changed files via `git diff --name-only`
2. **MCP isolation gate** — verify no MCP server imports from `src/`
3. **Checklist** — run through `references/checklist.md`
4. **TypeScript gate** — `npx tsc --noEmit` must pass
5. **Test gate** — `npm test` must pass
6. **Lessons check** — does this change risk any pitfall in `.ai/lessons.md`?
7. **Output** — list findings by severity (Critical / High / Medium / Low)

## Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| Critical | Security issue, data loss risk, MCP isolation violation | Must fix before merge |
| High | Architecture violation, broken pipeline stage | Must fix before merge |
| Medium | Convention violation, missing test | Should fix |
| Low | Style suggestion, naming nit | Optional |

## MCP Isolation Gate

For every file in `src/mcp-servers/`:
- MUST NOT have any import from `../` or `../../` or any relative path outside `src/mcp-servers/`
- MUST have `import { config } from "dotenv"; config();` at the top
- MUST use `{ content: [{ type: "text", text: "..." }] }` return format

```bash
# Quick check — should return nothing
grep -rn "from ['\"]\.\./" src/mcp-servers/
```

## Output Format

```markdown
## Code Review: [scope]

### Critical
- [ ] Finding description (file:line)

### High
- [ ] Finding description (file:line)

### Medium
- [ ] Finding description (file:line)

### Low
- [ ] Finding description (file:line)

### Gates
- [ ] MCP isolation: PASS/FAIL
- [ ] TypeScript: PASS/FAIL
- [ ] Tests: PASS/FAIL
- [ ] Lessons check: PASS/FAIL
```
