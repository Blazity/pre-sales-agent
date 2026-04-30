# SPEC-015: Performance & AI-Readiness

**Status:** Planning
**Date:** 2026-03-01

## Design

**Goal:** Optimize the repository for fast execution and AI-driven development without changing runtime behavior.

**Approach:** Config improvements + documentation enrichment + light code fixes. No architectural changes.

### 1. Incremental TypeScript Compilation

Add `incremental: true` and `tsBuildInfoFile` to `tsconfig.json`. Add `.tsbuildinfo` to `.gitignore`. Cuts rebuild time from ~3s to <1s for single-file changes.

### 2. Husky Pre-Commit Hook

Install `husky`, add a `prepare` script, create a pre-commit hook that runs `npx tsc --noEmit`. Catches type errors before they reach CI.

### 3. CLAUDE.md Enrichment

Add sections: typical workflow (ingest → analyze → offer → slides → KB), test patterns (`tsx --test`, naming conventions), quick reference to `.ai/` directory contents.

### 4. Lessons Recovery Steps

Add a `Recovery:` field to each lesson in `.ai/lessons.md` — actionable steps an agent can take when hitting the problem.

### 5. JSDoc on Key Exported Functions

Add JSDoc to the 5 most important exported functions: `runEstimationWorkflow`, `ingestEstimationFiles`, `createJobLogger`, `enqueueEstimation`, `startWorker`. One-liner descriptions, no param docs (types are self-documenting).

### 6. MCP Tool Reference

Create `.ai/mcp-tools.md` listing every MCP tool name, which server provides it, and a one-line description. Agents can consult this to understand available tools.

### 7. Env Pre-Validation in Orchestrator

Add an early check in `runEstimationWorkflow` that validates all MCP-required env vars are set before spawning child processes. Fail fast with a clear error instead of a cryptic ENOENT.

### 8. Section Markers in google-workspace.ts

Add `// ── Section ──` comments to break the 1,144-line file into navigable regions: Token Cache, Auth, Drive Tools, Docs Tools, Formatting Helpers, Chart Tools.

### 9. Fix `any` at orchestrator.ts:676

Replace `(b: any)` with the proper inline type.

---

## Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply all 9 performance and AI-readiness improvements.

**Architecture:** Config changes + documentation + light code fixes. No runtime behavior changes.

**Tech Stack:** TypeScript, husky, existing project tooling.

---

### Task 1: Incremental TypeScript Compilation

**Files:**
- Modify: `tsconfig.json`
- Modify: `.gitignore`

**Step 1: Add incremental config to tsconfig.json**

In `tsconfig.json`, add two fields to `compilerOptions` after `"sourceMap": true` (line 13):

```json
"incremental": true,
"tsBuildInfoFile": "./dist/.tsbuildinfo"
```

**Step 2: Add .tsbuildinfo to .gitignore**

Append `*.tsbuildinfo` to `.gitignore`.

**Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: Clean pass.

**Step 4: Commit**

```bash
git add tsconfig.json .gitignore
git commit -m "feat(perf-ai): enable incremental TypeScript compilation"
```

- [ ] Done

---

### Task 2: Husky Pre-Commit Hook

**Files:**
- Modify: `package.json`
- Create: `.husky/pre-commit`

**Step 1: Install husky**

```bash
npm install -D husky
```

**Step 2: Add prepare script to package.json**

Add `"prepare": "husky"` to the `scripts` section.

**Step 3: Initialize husky**

```bash
npx husky init
```

**Step 4: Create pre-commit hook**

Write `.husky/pre-commit`:

```bash
npx tsc --noEmit
```

**Step 5: Verify**

```bash
npx tsc --noEmit
```

Expected: Clean pass.

**Step 6: Commit**

```bash
git add package.json package-lock.json .husky/
git commit -m "feat(perf-ai): add husky pre-commit hook with tsc check"
```

- [ ] Done

---

### Task 3: CLAUDE.md Enrichment

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add workflow, test patterns, and .ai/ reference sections**

After the existing `## References` section, add:

```markdown

## Workflow

Typical pipeline: Slack message → BullMQ job → orchestrator runs 7 steps:
1. **Analysis** — KB search + web research on the RFP
2. **Clarification** — ask follow-up questions via Slack (skippable)
3. **Value Discovery** — research client business for value-based pricing
4. **Offer** — create Google Doc from template, fill sections
5. **Presentation** — create Google Slides deck
6. **Knowledge Base** — store estimation summary in Pinecone

## Testing

\`\`\`bash
npm test                           # run all tests
npx tsx --test src/lib/*.test.ts   # run specific test files
\`\`\`

Tests use Node's built-in test runner (`node:test`). Test files live next to source: `foo.ts` → `foo.test.ts`.

## .ai/ Directory

- `architecture.md` — system architecture, MCP patterns, data flow
- `lessons.md` — known pitfalls with recovery steps
- `specs/` — numbered specs (design + plan in same file)
- `skills/` — on-demand guides for common tasks
- `mcp-tools.md` — all MCP tools with descriptions
```

**Step 2: Verify no syntax issues**

Read back the file to confirm formatting.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "feat(perf-ai): enrich CLAUDE.md with workflow, testing, and .ai/ reference"
```

- [ ] Done

---

### Task 4: Lessons Recovery Steps

**Files:**
- Modify: `.ai/lessons.md`

**Step 1: Update format description**

Change line 5 from `Format: Context → Problem → Rule → Applies to.` to `Format: Context → Problem → Rule → Recovery → Applies to.`

**Step 2: Add Recovery field to each lesson**

After each `**Rule:**` line, add a `**Recovery:**` line:

1. **MCP servers must never import from src/**
   `**Recovery:** If you see import errors in MCP server logs, check for cross-imports. Move the needed code inline into the MCP server file.`

2. **Pinecone index is locked to voyage-3**
   `**Recovery:** If vectors return garbage, verify the embedding model. If changed, run npm run seed to re-index everything.`

3. **Google Workspace MCP requires network at runtime**
   `**Recovery:** If MCP spawn fails with ENOENT or fetch errors, check outbound internet. As a workaround, pre-install: npm install @googleapis/mcp-server-google-workspace.`

4. **GOOGLE_REFRESH_TOKEN leading whitespace**
   `**Recovery:** Run echo -n "$GOOGLE_REFRESH_TOKEN" | cat -A to check for whitespace. Trim in .env and restart.`

5. **Google Slides object IDs must be stable**
   `**Recovery:** If slide tools fail with "element not found", compare template element IDs with the hardcoded IDs in google-slides.ts. Rebuild the template with matching IDs.`

6. **PPTX uploaded to Google Slides gets rasterized**
   `**Recovery:** Delete the rasterized file. Rebuild the template using scripts/build-slides-template.ts which uses the Slides API directly.`

7. **wait_for_reply blocks agent turns**
   `**Recovery:** If OOM occurs, reduce BullMQ concurrency in src/queue/worker.ts (default: 3). Monitor with docker stats or Railway metrics.`

8. **Google Doc template placeholder tokens**
   `**Recovery:** Diff the template document's {{TOKENS}} against the orchestrator prompt's section list. They must match exactly.`

**Step 3: Commit**

```bash
git add .ai/lessons.md
git commit -m "feat(perf-ai): add recovery steps to all lessons"
```

- [ ] Done

---

### Task 5: JSDoc on Key Exported Functions

**Files:**
- Modify: `src/agents/orchestrator.ts` (line 63)
- Modify: `src/lib/file-ingestion.ts` (line 268)
- Modify: `src/lib/job-logger.ts` (line 22)
- Modify: `src/queue/producer.ts` (line 14)
- Modify: `src/queue/worker.ts` (line 7)

**Step 1: Add JSDoc comments**

Add a one-line JSDoc above each function:

```typescript
// orchestrator.ts, before line 63
/** Run the full estimation pipeline: analysis → clarification → offer → presentation → KB. */
export async function runEstimationWorkflow(job: EstimationJob): Promise<void> {

// file-ingestion.ts, before line 268
/** Download, extract, and organize Slack-uploaded files into a Drive folder. */
export async function ingestEstimationFiles(opts: {

// job-logger.ts, before line 22
/** Create a structured logger that writes job events to a Redis stream. */
export function createJobLogger(jobId: string, redis: IORedis) {

// producer.ts, before line 14
/** Enqueue an estimation job in BullMQ and return the generated job ID. */
export async function enqueueEstimation(job: Omit<EstimationJob, "jobId">): Promise<string> {

// worker.ts, before line 7
/** Start the BullMQ worker that processes estimation jobs. */
export function startWorker() {
```

**Step 2: Verify**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts src/lib/file-ingestion.ts src/lib/job-logger.ts src/queue/producer.ts src/queue/worker.ts
git commit -m "feat(perf-ai): add JSDoc to key exported functions"
```

- [ ] Done

---

### Task 6: MCP Tool Reference

**Files:**
- Create: `.ai/mcp-tools.md`

**Step 1: Create the file**

Derive the tool list from `allowedTools` in `src/agents/orchestrator.ts` (lines 641-662) and the MCP server source files.

```markdown
# MCP Tools Reference

Tools available to the orchestrator agent via MCP servers.

## knowledge-base

| Tool | Description |
|------|-------------|
| `search_similar_projects` | Search Pinecone for past estimates matching a query |
| `search_case_studies` | Search for case studies with optional tech/industry filters |
| `store_estimation` | Store a completed estimation summary in Pinecone |

## google-workspace

| Tool | Description |
|------|-------------|
| `drive_list_files` | List files in a Google Drive folder |
| `drive_get_file` | Get metadata for a Drive file |
| `drive_search_files` | Search Drive by name query |
| `drive_export_file` | Export a Google Doc/Sheet as plain text or PDF |
| `docs_create_document` | Create a new Google Doc in a folder |
| `docs_get_document` | Read the full content of a Google Doc |
| `docs_copy_template` | Copy the offer template doc into the output folder |
| `docs_find_and_replace` | Replace `{{PLACEHOLDER}}` tokens in a doc |
| `docs_write_sections` | Write formatted sections with headings, tables, and bold text |

## google-slides

| Tool | Description |
|------|-------------|
| `create_presentation` | Copy the slides template into the output folder |
| `add_slide` | Add a slide with title, body bullets, and layout |
| `set_client_logo` | Set the client logo image on the cover slide |
| `add_timeline_data` | Add Gantt chart data to the timeline slide |
| `add_pricing_block` | Add pricing comparison block to a slide |

## web-research

| Tool | Description |
|------|-------------|
| `fetch_web_page` | Fetch and extract text from a URL (allowed domains only) |

## slack-interaction

| Tool | Description |
|------|-------------|
| `post_message` | Post a message to a Slack channel/thread |
| `wait_for_reply` | Wait for a human reply in a Slack thread (up to 30 min) |
```

**Step 2: Verify tool names match orchestrator allowedTools**

Cross-reference with `src/agents/orchestrator.ts` lines 641-662.

**Step 3: Commit**

```bash
git add .ai/mcp-tools.md
git commit -m "feat(perf-ai): add MCP tools reference doc"
```

- [ ] Done

---

### Task 7: Env Pre-Validation in Orchestrator

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Add env validation at the start of runEstimationWorkflow**

After the destructuring on line 64, before the `log` variable on line 66, add:

```typescript
const requiredEnv = [
  "PINECONE_API_KEY", "VOYAGE_API_KEY",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN",
  "ANTHROPIC_API_KEY", "SLACK_BOT_TOKEN",
];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(`Missing env vars required by MCP servers: ${missing.join(", ")}`);
}
```

**Step 2: Verify**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(perf-ai): add env pre-validation before MCP server spawn"
```

- [ ] Done

---

### Task 8: Section Markers in google-workspace.ts

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts`

**Step 1: Add section separator comments**

Insert `// ── Section Name ──` markers before key regions. Use the existing `// ── Token cache ──` style (line 11) for consistency. Add markers before:

- Drive tools (first `server.tool("drive_...`)
- Docs tools (first `server.tool("docs_...`)
- Formatting helpers (`parseFormattedText`)
- Table helpers (`extractCellPositions`)
- Chart tools (`buildChartSheetData`)
- Server startup (transport/connect at the end)

**Step 2: Verify**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "feat(perf-ai): add section markers to google-workspace.ts"
```

- [ ] Done

---

### Task 9: Fix `any` at orchestrator.ts:676

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Replace the any type**

At line 676, change:

```typescript
blocks.map((b: any) => b.type === "text" ? b.text?.slice(0, 100) : `[${b.type}:${b.name ?? ""}]`)
```

to:

```typescript
blocks.map((b: { type: string; text?: string; name?: string }) => b.type === "text" ? b.text?.slice(0, 100) : `[${b.type}:${b.name ?? ""}]`)
```

**Step 2: Verify**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(perf-ai): replace any with inline type at orchestrator.ts:676"
```

- [ ] Done

---

## Verification

After all tasks complete:

1. `npx tsc --noEmit` passes
2. `npm test` passes
3. `git log --oneline -9` shows 9 scoped commits
4. No runtime behavior changes — only config, docs, and type fixes
