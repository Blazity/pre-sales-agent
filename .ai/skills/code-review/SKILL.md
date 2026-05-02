---
name: code-review
description: Use when reviewing completed work before committing, pushing, creating a PR, or merging
---

# Code Review

Project-specific review workflow for Pre-Sales Agent.

## Workflow

1. **Scope** — identify all changed files with `git diff --name-only` and `git status --short`.
2. **MCP isolation gate** — run `npm run check:mcp-isolation`.
3. **Checklist** — review every applicable item in `references/checklist.md`.
4. **TypeScript gate** — run `npm run typecheck`.
5. **Test gate** — run `npm test`.
6. **Dependency audit gate** — run `npm run audit:high`.
7. **Secret scan gate** — run `npm run scan:secrets`.
8. **AI docs drift gate** — run `npm run check:ai-docs`.
9. **Lessons check** — check whether the change risks any pitfall in `.ai/lessons.md`.
10. **Output** — list findings by severity.

## Severity Levels

| Level | Meaning | Action |
|---|---|---|
| Critical | Security issue, data loss risk, prompt-injection regression, MCP isolation violation | Must fix before merge |
| High | Architecture violation, broken pipeline stage, wrong Pinecone/Voyage config, generated-output regression | Must fix before merge |
| Medium | Convention violation, missing test, hidden error handling, stale AI docs | Should fix |
| Low | Style, naming, local clarity issue | Optional |

## Output Format

```markdown
## Code Review: [scope]

### Critical
- [ ] Finding description (`file:line`)

### High
- [ ] Finding description (`file:line`)

### Medium
- [ ] Finding description (`file:line`)

### Low
- [ ] Finding description (`file:line`)

### Gates
- [ ] MCP isolation: PASS/FAIL
- [ ] TypeScript: PASS/FAIL
- [ ] Tests: PASS/FAIL
- [ ] Dependency audit: PASS/FAIL
- [ ] Secret scan: PASS/FAIL
- [ ] AI docs drift: PASS/FAIL
- [ ] Lessons check: PASS/FAIL
```
