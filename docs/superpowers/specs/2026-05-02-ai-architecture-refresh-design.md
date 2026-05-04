# AI Architecture Refresh Design

## Goal

Prepare the repository for open source release by making its AI operating layer a clear, current, and credible example of agent architecture.

The work should make `AGENTS.md`, `CLAUDE.md`, and `.ai/` demonstrate strong agent-building practice without changing the production estimation agent's output behavior.

## Context

The repo already has a strong runtime foundation:

- Claude Agent SDK orchestrator with a multi-stage estimation workflow.
- Standalone stdio MCP servers for knowledge base, Google Workspace, web research, Slack interaction, and optional Figma access.
- Prompt-injection boundaries around untrusted user inputs.
- Google Docs and Sheets output with configurable agency profile.
- CI gates for typecheck, tests, dependency audit, secret scan, and MCP isolation.

The current AI instruction surface has drift:

- `CLAUDE.md` and `.ai/architecture.md` still describe older Express/BullMQ architecture while public docs describe Vercel Functions, Vercel Workflow, and Vercel Sandbox.
- Branch facts conflict between `AGENTS.md`, `CLAUDE.md`, and `.ai/lessons.md`.
- `.ai/mcp-tools.md` and `.ai/architecture.md` omit or misstate current tool details.
- Code review guidance does not fully match CI and PR-template gates.
- `CLAUDE.md` and `AGENTS.md` duplicate instruction content instead of using a clear shared source of truth.

## Best-Practice Basis

The design follows current official guidance from Anthropic and OpenAI:

- Keep project memory concise, specific, structured, and periodically reviewed.
- Avoid duplicating shared instructions across `CLAUDE.md` and `AGENTS.md`; use a thin Claude-specific wrapper when both files exist.
- Use explicit security and permission boundaries for agent tooling and sensitive files.
- Structure complex agent instructions with clear sections and stable tags.
- Evaluate agent systems for instruction following, tool selection, tool argument precision, and prompt-injection resilience.

References:

- Anthropic Claude Code memory: https://docs.anthropic.com/en/docs/claude-code/memory
- Anthropic Claude Code settings: https://docs.anthropic.com/en/docs/claude-code/settings
- Anthropic prompt structure guidance: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags
- OpenAI agent safety: https://platform.openai.com/docs/guides/agent-builder-safety
- OpenAI evaluation best practices: https://platform.openai.com/docs/guides/evaluation-best-practices

## Scope

In scope:

- Refactor `AGENTS.md` into the shared cross-agent entrypoint.
- Refactor `CLAUDE.md` into a lean Claude-specific wrapper.
- Reorganize and update `.ai/` documentation.
- Align code-review guidance with CI and PR-template gates.
- Add lightweight AI architecture docs for guardrails and eval-style expectations.
- Add a static drift check that validates core AI docs against repo facts.
- Add tests for the drift check.

Out of scope:

- Rewriting `src/agents/orchestrator.ts` prompt wording.
- Changing estimation, pricing, research, or document-generation behavior.
- Changing MCP tool implementations except where a check needs exported pure helpers.
- Adding a heavyweight eval platform integration.
- Changing deployment architecture.

## Target Structure

```text
.ai/
  README.md
  architecture.md
  guardrails.md
  mcp-tools.md
  lessons.md
  evals/
    README.md
    prompt-boundaries.md
    tool-routing.md
    review-rubric.md
  checks/
    README.md
    check-ai-docs-drift.ts
  skills/
    README.md
    add-mcp-server/
    code-review/
    first-launch/
```

## Instruction Architecture

### `AGENTS.md`

`AGENTS.md` becomes the shared, always-loaded agent entrypoint. It should contain only stable, high-signal information:

- Repository purpose.
- Current runtime architecture.
- Package manager, runtime, module system, default branch.
- Required gates.
- Critical invariants.
- Pointers to deeper `.ai/` docs and skills.
- Review severity policy.
- Explicit instruction to consult `.ai/` instead of guessing runtime facts.

It should avoid duplicating long checklists that live in `.ai/skills/code-review/`.

### `CLAUDE.md`

`CLAUDE.md` becomes a thin Claude Code layer:

- Import or reference `AGENTS.md` as the shared source of truth.
- Add only Claude-specific workflow notes that do not belong in cross-agent instructions.
- Point to `.ai/skills/` for task-specific workflows.
- Avoid duplicating branch names, runtime architecture, review gates, or MCP tool inventories.

### `.ai/`

`.ai/` becomes the deeper agent-ops layer:

- `README.md` explains the purpose and loading model of each file.
- `architecture.md` documents the current Vercel-first architecture and MCP boundaries.
- `guardrails.md` documents prompt-injection, secret-handling, Drive allowlist, Slack thread, and external-content rules.
- `mcp-tools.md` lists tools by server and pipeline stage, matching code.
- `lessons.md` stays as known pitfalls, but stale branch/runtime entries are removed or corrected.
- `skills/` remains on-demand workflows, not always-loaded memory.

## Eval And Drift Layer

The first pass uses lightweight eval-style documents plus one static check script.

### Eval Documents

`.ai/evals/prompt-boundaries.md` defines examples of untrusted RFP, Slack, Drive, and file-manifest content and the expected safe handling.

`.ai/evals/tool-routing.md` defines expected tool usage by pipeline stage:

- Analysis: knowledge-base search, optional Figma, web discovery when required.
- Clarification: Slack thread interaction only when not skipped.
- Value Discovery: web search and page fetch for client/business research.
- Offer: Google Docs and Sheets output tools.

`.ai/evals/review-rubric.md` gives concrete examples for Critical, High, Medium, and Low findings.

These files are not a runtime eval framework. They create inspectable expectations that can later become automated trace graders.

### Static Drift Check

Add `.ai/checks/check-ai-docs-drift.ts` and an npm script such as `check:ai-docs`.

The check should fail on:

- Branch name conflicts across `AGENTS.md`, `CLAUDE.md`, `.ai/lessons.md`, and Git metadata.
- Stale runtime claims in always-loaded files, especially Express/BullMQ references when not explicitly historical.
- `wait_for_reply` timeout mismatches between docs and `src/mcp-servers/slack-interaction.ts`.
- MCP tools registered in source but missing from `.ai/mcp-tools.md`.
- MCP tools in `allowedTools` but missing from `TOOL_TO_STEP`, unless explicitly exempted.
- CI gates missing from `.ai/skills/code-review` or its checklist.

The drift check should be pure and testable. It should read files, parse simple patterns, and return structured findings so tests can cover positive and negative fixtures.

## Quality Preservation

This change must not reduce estimation output quality.

Rules:

- Do not edit the production orchestrator prompt in this pass.
- Do not edit MCP tool behavior in this pass.
- Do not edit Google Docs or Sheets formatting behavior in this pass.
- Treat runtime prompt improvements as a later eval-backed project.

The intended effect is better agent and maintainer behavior around the repo, not different generated offers.

## Testing

Run the full existing gates:

```bash
npm run typecheck
npm test
npm run audit:high
npm run scan:secrets
npm run check:mcp-isolation
```

Add and run:

```bash
npm run check:ai-docs
```

If a dedicated test file is added for the drift checker, it should run under the existing `npm test` command.

## Success Criteria

- A new OSS reader can understand the agent architecture from `AGENTS.md`, `CLAUDE.md`, and `.ai/README.md` without encountering stale architecture claims.
- Claude Code and Codex receive the same shared repo facts without duplicated, conflicting instructions.
- `.ai/architecture.md` matches the public Vercel-first docs and current code.
- `.ai/mcp-tools.md` matches MCP server source and orchestrator tool allowlists.
- Code review guidance matches CI and the PR template.
- The repo contains explicit AI guardrail and eval-style documentation.
- The new drift check prevents the specific documentation conflicts found during audit from recurring.
- Existing runtime behavior and generated offer quality are unchanged.
