# SPEC-013: AI Directory Setup

**Status:** Implemented
**Date:** 2026-02-28

---

# AI Directory Setup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a `.ai/` directory with lessons learned, architecture docs, numbered specs, MCP server skill, and code review skill — modeled after open-mercato's agentic development patterns, scaled for a single-service project.

**Architecture:** Three-tier context: always-on (`CLAUDE.md` + `lessons.md`), on-demand (skills), deep reference (specs + architecture). CLAUDE.md gets leaner and imperative-only; descriptive content moves to `.ai/architecture.md`.

**Tech Stack:** Markdown files only. No scripts or tooling needed for Phase 1-3.

**Design doc:** See proposal in conversation history (open-mercato analysis session, Feb 28 2026).

---

### Task 1: Create `.ai/` directory structure

**Files:**
- Create: `.ai/lessons.md`
- Create: `.ai/architecture.md`
- Create: `.ai/specs/README.md`
- Create: `.ai/skills/README.md`

**Step 1: Create directories**

```bash
mkdir -p .ai/specs .ai/skills
```

**Step 2: Create `lessons.md`**

Create `.ai/lessons.md` with known pitfalls extracted from project history. Each entry follows the format: **Context → Problem → Rule → Applies to**.

```markdown
# Lessons Learned

Review this file at session start. Add new entries when you discover recurring issues.

Format: Context → Problem → Rule → Applies to.

---

### MCP servers must never import from `src/`

**Context:** MCP servers run as standalone stdio child processes spawned by the orchestrator.
**Problem:** Importing shared modules from `src/` breaks the stdio transport and causes silent failures.
**Rule:** Every MCP server loads its own `dotenv/config` and duplicates any helpers it needs. No cross-imports.
**Applies to:** All files in `src/mcp-servers/`.

---

### Pinecone index is locked to voyage-3

**Context:** The knowledge base uses Voyage AI `voyage-3` embeddings (1024-dim, cosine metric).
**Problem:** Changing the embedding model produces incompatible vectors. Old vectors become useless.
**Rule:** If you change the embedding model, you must recreate the Pinecone index and re-seed all data.
**Applies to:** `src/mcp-servers/knowledge-base.ts`, `scripts/seed-knowledge-base.ts`.

---

### Google Workspace MCP requires network at runtime

**Context:** The Google Workspace MCP server is fetched via `npx -y @googleapis/mcp-server-google-workspace@latest`.
**Problem:** In network-restricted environments (some Railway plans, air-gapped CI), this fetch fails silently.
**Rule:** Ensure production environment has outbound internet access, or pre-install the package.
**Applies to:** `src/agents/orchestrator.ts` (MCP server config).

---

### GOOGLE_REFRESH_TOKEN leading whitespace

**Context:** The `.env` file's `GOOGLE_REFRESH_TOKEN` value sometimes has a leading space after `=`.
**Problem:** Google OAuth rejects tokens with leading/trailing whitespace, returning a 400 error.
**Rule:** Trim the refresh token value. If auth fails, check for whitespace first.
**Applies to:** All Google API calls.

---

### Google Slides object IDs must be stable for template tools

**Context:** The template builder (`scripts/build-slides-template.ts`) creates elements with specific IDs like `gantt_area`.
**Problem:** If the template is rebuilt with different IDs, MCP tools that look up elements by ID break.
**Rule:** Template element IDs referenced by MCP tools must use hardcoded stable strings, not auto-generated IDs.
**Applies to:** `scripts/build-slides-template.ts`, `src/mcp-servers/google-slides.ts`.

---

### PPTX uploaded to Google Slides gets rasterized

**Context:** Uploading a `.pptx` file to Google Slides via Drive converts it.
**Problem:** All text, shapes, and backgrounds are flattened into images. No editable elements survive.
**Rule:** Build Slides templates programmatically via the API, or design them natively in Google Slides.
**Applies to:** `scripts/build-slides-template.ts`.

---

### wait_for_reply blocks agent turns

**Context:** The `wait_for_reply` tool polls Slack for human responses for up to 30 minutes.
**Problem:** With worker concurrency 3 and 4 child processes per job, that's up to 12 simultaneous MCP processes.
**Rule:** Monitor memory on small Railway plans. Consider reducing concurrency if OOM occurs.
**Applies to:** `src/mcp-servers/slack-interaction.ts`, `src/agents/orchestrator.ts`.

---

### Google Doc template placeholder tokens

**Context:** The offer template uses `{{PLACEHOLDER}}` tokens that the orchestrator fills.
**Problem:** Adding or renaming tokens requires updating both the template document AND the orchestrator prompt.
**Rule:** Keep the token list in CLAUDE.md and update both sides when changing tokens.
**Applies to:** `src/mcp-servers/google-workspace.ts`, `src/agents/orchestrator.ts`.
```

**Step 3: Create `architecture.md`**

Create `.ai/architecture.md` — the deep architecture reference moved out of CLAUDE.md:

```markdown
# Architecture

## System Overview

```
Slack (!estimate or /estimate) → Express/Bolt → BullMQ job → Orchestrator → MCP servers (stdio)
```

The orchestrator (`src/agents/orchestrator.ts`) drives a multi-stage agent pipeline through a single `query()` call to the Claude Agent SDK. Each stage maps to specific MCP tools via `TOOL_TO_STEP`.

## Pipeline Stages

| Stage | MCP Server | Tools | Purpose |
|-------|-----------|-------|---------|
| 1. Analysis | knowledge-base | `search_similar_projects`, `search_case_studies` | RAG search over past projects via Pinecone |
| 2. Clarification | slack-interaction | `wait_for_reply` | Posts questions to Slack, polls for human response (up to 30 min) |
| 3. Offer | google-workspace | `docs_create_document`, `docs_write_sections` | Clones Google Doc template, fills `{{PLACEHOLDER}}` tokens |
| 4. Presentation | google-slides | `create_presentation`, `add_slide`, `set_client_logo`, `add_timeline_data`, `add_pricing_block` | Clones Google Slides template, builds branded deck |
| 5. Knowledge Base | knowledge-base | `store_estimation` | Stores completed estimation for future RAG |

## MCP Server Pattern

Every MCP server follows this structure:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "dotenv";
config();

const server = new McpServer({ name: "server-name", version: "1.0.0" });
server.tool("tool_name", "description", { /* Zod schema */ }, async (params) => {
  return { content: [{ type: "text", text: "result" }] };
});
server.connect(new StdioServerTransport());
```

Rules:
- Standalone stdio processes — NEVER import from `src/`
- Each loads its own `dotenv/config`
- Google services use token caching with `expiresAt` check
- Tool params validated with Zod schemas

## Orchestrator MCP Config

Each server is registered in the orchestrator with:
- `command: "node"`, `args: [path.join(ROOT, "dist/mcp-servers/[name].js")]`
- `env:` — only the env vars that specific server needs
- Tools whitelisted in `allowedTools` array with prefix `mcp__[server]__[tool]`

## Key Files

| File | Purpose |
|------|---------|
| `src/agents/orchestrator.ts` | Agent pipeline driver, MCP configs, system prompt |
| `src/mcp-servers/*.ts` | MCP tool servers (stdio, standalone) |
| `src/lib/queue.ts` | BullMQ job queue setup |
| `src/slack/app.ts` | Slack Bolt app mounted at `/slack` on Express |
| `scripts/seed-knowledge-base.ts` | Seeds Pinecone from PDFs, Google Docs, JSON |
| `scripts/build-slides-template.ts` | Builds branded Google Slides template via API |
| `scripts/get-google-token.ts` | One-time OAuth flow for `GOOGLE_REFRESH_TOKEN` |

## Brand Style Profile

- **Colors:** Coal `#181B20`, Mariner `#3C43E7`, Burnt Orange `#FD6027`, Off-White `#F9FAFB`, Vibe Yellow `#FFC800`
- **Fonts:** Space Mono (titles), Inter (body), JetBrains Mono (code)
- **Placeholder pattern:** `{{TOKEN_NAME}}` in both Docs and Slides templates
- **Template IDs:** `GDRIVE_TEMPLATE_ID` (Docs), `GSLIDES_TEMPLATE_ID` (Slides)
```

**Step 4: Create specs README**

Create `.ai/specs/README.md`:

```markdown
# Specifications

Numbered specs drive implementation. Each spec has a design (requirements/architecture) and an implementation plan (step-by-step tasks with `- [ ]` markers).

## Naming

- `SPEC-NNN-short-name.md` — OSS specs
- Design and plan live in the same file (this is a single-service project, not a monorepo)

## Spec Index

| # | Name | Status | Date |
|---|------|--------|------|
| SPEC-001 | Offer Styling & Content Quality | Implemented | 2026-02-27 |
| SPEC-002 | Google Slides Presentation | Implemented | 2026-02-28 |

## Workflow

1. **Before coding** — write or read the spec
2. **During coding** — update `- [ ]` / `- [x]` markers as tasks complete
3. **After coding** — update spec status in this index
```

**Step 5: Create skills README**

Create `.ai/skills/README.md`:

```markdown
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
```

**Step 6: Commit**

```bash
git add .ai/
git commit -m "feat(ai-setup): create .ai directory with lessons, architecture, specs index, skills index"
```

- [ ] Done

---

### Task 2: Restructure CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

The current CLAUDE.md mixes imperative rules with descriptive architecture docs. Make it lean and prescriptive — architecture detail moves to `.ai/architecture.md`.

**Step 1: Rewrite CLAUDE.md**

Replace the entire contents of `CLAUDE.md` with:

```markdown
# Estimation Agent

Slack bot → BullMQ → Claude Agent SDK orchestrator → MCP servers (stdio). See `.ai/architecture.md` for full architecture.

## Rules

- MCP servers are standalone stdio processes. NEVER import from `src/`. Each loads its own `dotenv/config`.
- After any code change, run `npx tsc --noEmit`.
- Read `.ai/lessons.md` at session start for known pitfalls.
- Use `{{PLACEHOLDER}}` tokens in document/slide templates. Update both the template AND the orchestrator prompt when changing tokens.
- Google Doc tokens: `{{EXECUTIVE_SUMMARY}}`, `{{SCOPE}}`, `{{TECH_STACK}}`, `{{TEAM}}`, `{{TIMELINE}}`, `{{PRICING}}`, `{{TERMS}}`.
- Google Slides template element IDs referenced by MCP tools must be stable hardcoded strings (e.g. `gantt_area`).
- Slack Bolt is mounted at `/slack` on Express — all webhook URLs use `https://<host>/slack/*`.
- `GOOGLE_REFRESH_TOKEN` is obtained once via `scripts/get-google-token.ts`. If it expires, re-run the script.

## Commands

```bash
npm run dev       # tsx watch
npm run seed      # seed Pinecone from past-estimates/
```

## References

- `.ai/architecture.md` — full architecture, MCP patterns, pipeline stages
- `.ai/lessons.md` — known pitfalls and recurring issues
- `.ai/specs/` — numbered specifications and implementation plans
- `.ai/skills/` — on-demand skill guides for common tasks
- `.env.example` — all required environment variables
```

**Step 2: Verify no broken references**

The old CLAUDE.md referenced `@.env.example` and `@scripts/seed-knowledge-base.ts`. The new version still references `.env.example`. The seed script reference is covered by the `npm run seed` command. Verify no other files reference CLAUDE.md sections by title.

```bash
grep -r "## Gotchas\|## Architecture\|## Verification" --include="*.md" --include="*.ts" .
```

If any files reference removed sections, update those references to point to `.ai/architecture.md` or `.ai/lessons.md`.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "feat(ai-setup): restructure CLAUDE.md to lean imperative format"
```

- [ ] Done

---

### Task 3: Migrate existing plans to numbered specs

**Files:**
- Create: `.ai/specs/SPEC-001-offer-styling-content-quality.md`
- Create: `.ai/specs/SPEC-002-presentation-google-slides.md`
- Modify: `.ai/specs/README.md` (update status if needed)

All plans and designs now live in `.ai/specs/` as consolidated `SPEC-NNN-short-name.md` files.

**Step 1: Create SPEC-001**

Create `.ai/specs/SPEC-001-offer-styling-content-quality.md`:

```markdown
# SPEC-001: Offer Styling & Content Quality

**Status:** Implemented
**Date:** 2026-02-27
**Branch:** `feat/offer-styling-content-quality`

## Summary

Brand-matched Google Docs offers with Blazity typography, colors, table formatting, and content structure rules baked into the orchestrator prompt.

## Design

See `.ai/specs/SPEC-001-offer-styling-content-quality.md`

## Implementation Plan

See `.ai/specs/SPEC-001-offer-styling-content-quality.md`

## Key Decisions

- Template-first approach: clone a branded Google Doc template, fill placeholders
- Styling applied via Google Docs API (updateTextStyle, updateTableCellProperties)
- Orchestrator prompt rewritten with explicit brand rules and content structure
- JetBrains Mono for headings, Inter for body, Burnt Orange for emphasis
```

**Step 2: Create SPEC-002**

Create `.ai/specs/SPEC-002-presentation-google-slides.md`:

```markdown
# SPEC-002: Google Slides Presentation

**Status:** Implemented
**Date:** 2026-02-28
**Branch:** `feat/offer-styling-content-quality`

## Summary

Replace Gamma MCP server with Google Slides API-based presentation builder using a branded template with 6 master layouts.

## Design

See `.ai/specs/SPEC-002-presentation-google-slides.md`

## Implementation Plan

See `.ai/specs/SPEC-002-presentation-google-slides.md`

## Key Decisions

- Template-first: 6 master slides (COVER, SECTION_DIVIDER, DARK_CONTENT, LIGHT_CONTENT, PRICING, TIMELINE)
- Gamma deleted entirely (not wrapped)
- Template built programmatically via `scripts/build-slides-template.ts`
- Gantt timeline uses stable `gantt_area` element ID for dynamic bar positioning
- MCP tools: `create_presentation`, `add_slide`, `set_client_logo`, `add_timeline_data`, `add_pricing_block`
```

**Step 3: Commit**

```bash
git add .ai/specs/
git commit -m "feat(ai-setup): add SPEC-001 and SPEC-002 for existing implemented features"
```

- [ ] Done

---

### Task 4: Create `add-mcp-server` skill

**Files:**
- Create: `.ai/skills/add-mcp-server/SKILL.md`

This is the project's most common development task — adding new MCP tool servers or extending existing ones.

**Step 1: Create the skill**

Create `.ai/skills/add-mcp-server/SKILL.md`:

````markdown
---
name: add-mcp-server
description: Use when creating a new MCP tool server or adding tools to an existing one
---

# Add MCP Server

Guide for creating or extending MCP tool servers in this project.

## Rules

- MCP servers are standalone stdio processes in `src/mcp-servers/`.
- NEVER import from `src/`. Each server loads its own `dotenv/config`.
- All tool params use Zod schemas.
- Return format: `{ content: [{ type: "text", text: "..." }] }`.
- Google services use token caching pattern (see `google-workspace.ts`).

## Creating a New MCP Server

### 1. Create the server file

Create `src/mcp-servers/{name}.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "dotenv";
config();

const server = new McpServer({ name: "{name}", version: "1.0.0" });

server.tool(
  "tool_name",
  "What this tool does — one sentence",
  {
    param: z.string().describe("What this param is"),
  },
  async ({ param }) => {
    // implementation
    return { content: [{ type: "text", text: `Result: ${param}` }] };
  }
);

server.connect(new StdioServerTransport());
```

### 2. Register in orchestrator

In `src/agents/orchestrator.ts`, add three things:

**a) TOOL_TO_STEP mapping** (around line 17):
```typescript
const TOOL_TO_STEP: Record<string, number> = {
  // ... existing entries ...
  tool_name: N,  // N = pipeline stage number
};
```

**b) MCP server config** (in the `mcpServers` object, around line 420):
```typescript
"{name}": {
  command: "node",
  args: [path.join(ROOT, "dist/mcp-servers/{name}.js")],
  env: {
    ONLY_VARS_THIS_SERVER_NEEDS: process.env.ONLY_VARS_THIS_SERVER_NEEDS ?? "",
  },
},
```

**c) Allowed tools** (in the `allowedTools` array, around line 470):
```typescript
"mcp__{name}__tool_name",
```

### 3. Update system prompt

Add a line describing the new server in the orchestrator's system prompt (the `content` string, around line 60):

```
- {name} MCP: what this server does
```

Add instructions in the relevant Step section of the prompt telling the agent when and how to use the new tools.

### 4. Update .env.example

Add any new environment variables with comments.

### 5. Check OAuth scopes

If the server uses Google APIs, check whether `scripts/get-google-token.ts` includes the required scope. If not, add it to the SCOPES array and re-run the script.

### 6. Create test file

Create `src/mcp-servers/{name}.test.ts` with at least one unit test per tool.

### 7. Verify

```bash
npx tsc --noEmit
npm test
```

## Adding Tools to an Existing Server

Same steps 2-7 above, but modify the existing server file instead of creating a new one.

## Checklist

- [ ] Server file created with dotenv, Zod schemas, stdio transport
- [ ] No imports from `src/`
- [ ] TOOL_TO_STEP mapping added
- [ ] MCP config added with correct env vars
- [ ] Tools added to allowedTools array
- [ ] System prompt updated
- [ ] .env.example updated if new vars
- [ ] OAuth scopes checked
- [ ] Test file created
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
````

**Step 2: Commit**

```bash
git add .ai/skills/add-mcp-server/
git commit -m "feat(ai-setup): add add-mcp-server skill"
```

- [ ] Done

---

### Task 5: Create `code-review` skill

**Files:**
- Create: `.ai/skills/code-review/SKILL.md`
- Create: `.ai/skills/code-review/references/checklist.md`

**Step 1: Create the skill**

Create `.ai/skills/code-review/SKILL.md`:

````markdown
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
````

**Step 2: Create the checklist**

Create `.ai/skills/code-review/references/checklist.md`:

```markdown
# Code Review Checklist

## Architecture
- [ ] MCP servers do not import from `src/`
- [ ] New MCP tools registered in TOOL_TO_STEP mapping
- [ ] New MCP tools added to allowedTools array
- [ ] System prompt updated for new tools
- [ ] MCP server env config includes only required vars

## Orchestrator
- [ ] Prompt sections match pipeline stages
- [ ] Step numbers in TOOL_TO_STEP match prompt structure
- [ ] No hardcoded API keys or secrets in prompt text
- [ ] Placeholder tokens (`{{TOKEN}}`) consistent between template and prompt

## Google APIs
- [ ] OAuth scopes include required permissions
- [ ] Token caching uses expiresAt check (not per-request refresh)
- [ ] API error responses handled with meaningful messages
- [ ] Template element IDs are stable hardcoded strings when referenced by tools

## Data Integrity
- [ ] Pinecone operations use correct embedding model (voyage-3, 1024-dim)
- [ ] Chunking parameters match seed script (800 words, 80 overlap)
- [ ] Metadata fields consistent with existing index schema

## Slack Integration
- [ ] Bolt routes use `/slack` prefix
- [ ] wait_for_reply has reasonable timeout
- [ ] Thread context (channel + ts) passed correctly

## Code Quality
- [ ] Zod schemas for all MCP tool parameters
- [ ] No `any` types (use explicit type assertions)
- [ ] Error handling returns structured content, not thrown exceptions
- [ ] No unused imports or variables
- [ ] Conventional commit messages with scope

## Environment
- [ ] New env vars added to `.env.example` with comments
- [ ] No secrets committed to source control
- [ ] dotenv loaded at entry point of each MCP server

## Testing
- [ ] At least one test per new MCP tool
- [ ] Tests use mocks for external API calls
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
```

**Step 3: Commit**

```bash
git add .ai/skills/code-review/
git commit -m "feat(ai-setup): add code-review skill with checklist"
```

- [ ] Done

---

### Task 6: Update .ai references across the project

**Files:**
- Modify: `.ai/specs/README.md` (if needed after previous tasks)

**Step 1: Verify cross-references**

Check that all references between files are consistent:

```bash
# Verify CLAUDE.md references exist
grep -oP '`[^`]+`' CLAUDE.md | sort -u

# Verify .ai/architecture.md references real files
grep -oP '`[^`]+\.(ts|md|json)`' .ai/architecture.md | sort -u

# Verify no broken spec references
grep -rn "SPEC-" .ai/specs/ --include="*.md"
```

Fix any broken paths or references.

**Step 2: Verify TypeScript compilation still passes**

```bash
npx tsc --noEmit
```

**Step 3: Final commit**

If any fixes were needed:

```bash
git add -A
git commit -m "feat(ai-setup): fix cross-references across .ai directory"
```

- [ ] Done

---

### Task 7: Verify the full setup

**Step 1: Verify directory structure**

```bash
find .ai -type f | sort
```

Expected output:
```
.ai/architecture.md
.ai/lessons.md
.ai/skills/README.md
.ai/skills/add-mcp-server/SKILL.md
.ai/skills/code-review/SKILL.md
.ai/skills/code-review/references/checklist.md
.ai/specs/README.md
.ai/specs/SPEC-001-offer-styling-content-quality.md
.ai/specs/SPEC-002-presentation-google-slides.md
```

**Step 2: Verify CLAUDE.md is lean**

```bash
wc -l CLAUDE.md
```

Should be under 30 lines (was 44 before).

**Step 3: Verify lessons.md has entries**

```bash
grep -c "^### " .ai/lessons.md
```

Should be 8 entries.

**Step 4: Verify git status is clean**

```bash
git status
git log --oneline -8
```

Should show commits with `feat(ai-setup):` scope.

- [ ] Done
