# Pre-Sales Agent — Codex Review Guidelines

## Review Process

Follow the code review workflow defined in `.ai/skills/code-review/SKILL.md`.
Use the checklist at `.ai/skills/code-review/references/checklist.md`.

Run every check in the workflow:
1. Scope — identify all changed files
2. MCP isolation gate — verify no MCP server imports from `src/`
3. Checklist — run through every item in `references/checklist.md`
4. TypeScript gate — `npx tsc --noEmit` must pass
5. Test gate — `npm test` must pass
6. Lessons check — does this change risk any pitfall in `.ai/lessons.md`?
7. Output — list findings by severity

## Severity Levels

- **Critical** — Security vulnerabilities, data loss risks, MCP isolation violations. Must fix before merge.
- **High** — Architecture violations, broken orchestrator pipeline, wrong Pinecone config. Must fix before merge.
- **Medium** — Convention violations, missing error handling. Should fix.
- **Low** — Style, naming. Optional.

**Request changes** for Critical and High findings only. Medium and Low are comments.

## Repository Facts

- Default branch: `main`
- Package manager: `npm`
- Runtime: Node.js with TypeScript (ESM)

## Key Rules

- MCP servers in `src/mcp-servers/` must NEVER import from `src/`. Each is a standalone stdio process with its own `dotenv/config`.
- The orchestrator `TOOL_TO_STEP` map and `allowedTools` array must stay in sync with MCP tool names.
- Google Doc template `{{PLACEHOLDER}}` tokens must match between the template and orchestrator prompt.
- Agency identity and proof points must remain configurable through `AGENCY_PROFILE_PATH` or the default starter profile.
- Pinecone is locked to `voyage-3` (1024-dim, cosine). Changing the model requires full re-index.
- Never commit secrets (.env, credentials, API keys).
