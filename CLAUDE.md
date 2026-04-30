# Pre-Sales Agent

Slack bot → BullMQ → Claude Agent SDK orchestrator → MCP servers (stdio). See `.ai/architecture.md` for full architecture.

## Rules

- MCP servers are standalone stdio processes. NEVER import from `src/`. Each loads its own `dotenv/config`.
- After any code change, run `npx tsc --noEmit`.
- Read `.ai/lessons.md` at session start for known pitfalls.
- Use `{{PLACEHOLDER}}` tokens in document templates. Update both the template AND the orchestrator prompt when changing tokens.
- Google Doc tokens: `{{EXECUTIVE_SUMMARY}}`, `{{SCOPE}}`, `{{TECH_STACK}}`, `{{TEAM}}`, `{{TIMELINE}}`, `{{PRICING}}`, `{{TERMS}}`.
- Slack Bolt is mounted at `/slack` on Express — all webhook URLs use `https://<host>/slack/*`.
- `GOOGLE_REFRESH_TOKEN` is obtained once via `scripts/get-google-token.ts`. If it expires, re-run the script.
- `GSHEETS_TEMPLATE_ID` is the estimation template spreadsheet ID. Template format: Module | Action items | Estimation (MD) | Estimation (Risk buffer) | Type | Optional? | Risk | Assumptions | Figma Link.
- Agency identity, proof points, voice, links, and brand colors come from `AGENCY_PROFILE_PATH` or the default starter profile in `src/config/agency-profile.ts`.
- Follow the Development Workflow for every implementation task. Do not skip steps.

## Commands

```bash
npm run dev       # tsx watch
npm run seed      # seed Pinecone from Google Drive (Sheets + Docs)
```

## References

- `.ai/architecture.md` — full architecture, MCP patterns, pipeline stages
- `.ai/lessons.md` — known pitfalls and recurring issues
- `.ai/skills/` — on-demand skill guides for common tasks
- `.env.example` — all required environment variables

## Workflow

Typical pipeline: Slack message → BullMQ job → orchestrator runs 4 steps:
1. **Analysis** — KB search + web research on the RFP
2. **Clarification** — ask follow-up questions via Slack (skippable)
3. **Value Discovery** — research client business for value-based pricing
4. **Offer** — create Google Doc from template, fill sections

## Development Workflow

Every implementation task follows this sequence:

1. **Start** — read `.ai/lessons.md` (see Rules)
2. **Branch** — create a feature branch from main (e.g. `feat/<scope>`, `fix/<scope>`)
3. **Implement** — execute the plan; if a public design note exists, update its checkboxes
4. **Verify** — type-check and tests must pass (see Rules)
5. **Self-review** — before pushing, review every changed file against this checklist:
   - **Error propagation**: every `catch` block — does the error need to re-throw so upstream handlers (Slack, queue) can react?
   - **Prompt safety**: any data interpolated into orchestrator/agent prompts — is it wrapped in boundary tags? Is that tag declared in the system prompt's `SECURITY — INPUT BOUNDARY RULES`?
   - **Accounting**: every counter, total, or summary — does it cover ALL code paths that contribute? Trace every `.push()` and `+=`.
   - **Regex completeness**: URL stripping, parsing — does it handle query strings, fragments, edge cases?
6. **Lessons** — if new pitfalls were discovered, append to `.ai/lessons.md`
7. **PR** — push branch, create PR with summary and test plan
8. **Review** — Codex reviews automatically using `.ai/skills/code-review` checklist. Read the review via `gh api repos/{owner}/{repo}/pulls/{n}/comments`. Fix all P1/P2 findings and push. Repeat until Codex has no findings (reacts with 👍 instead of posting comments).
9. **Merge** — Once Codex review is clean, merge PR, delete feature branch, pull master.

## Testing

```bash
npm test                           # run all tests
npx tsx --test src/lib/*.test.ts   # run specific test files
```

Tests use Node's built-in test runner (`node:test`). Test files live next to source: `foo.ts` → `foo.test.ts`.

## .ai/ Directory

- `architecture.md` — system architecture, MCP patterns, data flow
- `lessons.md` — known pitfalls with recovery steps
- `skills/` — on-demand guides for common tasks
- `mcp-tools.md` — all MCP tools with descriptions
