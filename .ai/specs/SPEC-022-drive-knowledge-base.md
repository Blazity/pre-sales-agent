# SPEC-022: Google Drive Knowledge Base Migration

**Status:** Planning
**Date:** 2026-03-04

## Summary

Replace repo-based `past-estimates/` with two Google Drive folders as the knowledge base source. Past estimations (Google Sheets) provide structured effort/cost data for calibration. Past proposals (Google Docs) provide writing reference material. The KB becomes a read-only, manually-curated reference library — the agent never writes to it.

## Goals

- **Primary:** Improve estimation accuracy via structured data from Google Sheets (exact hours, roles, costs per feature)
- **Secondary:** Improve proposal quality via clean reference docs from Google Drive
- Enable feature-level queries ("how many hours did auth take in past React projects?")
- Clean separation: KB folders are read-only reference, agent output goes to per-job folders

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approach | Pinecone dual-namespace + structured metadata | Best balance of structured queries and semantic search |
| Sheet format | Consistent template: Feature \| Role \| Hours \| Rate \| Cost | All sheets follow same structure |
| Data usage | Structured extraction + RAG | Both structured fields and text embeddings |
| Population | Manual by team (~1-2x/month) | Curated quality over automated quantity |
| Sync | On-demand `npm run seed`, full re-index default + `--incremental` flag | Simple, explicit |
| Query strategy | Separate searches for Sheets vs Docs | Sheets for effort calibration, Docs for writing reference |
| Sheet-Doc linking | ~50% paired, filename-based matching | Normalize filenames, match across folders |
| Legacy | Remove `past-estimates/`, keep case studies | Clean break from repo storage |
| MCP architecture | Replace existing KB server (clean slate) | Old tools don't fit new data model |
| Metadata | Core fields + feature-level detail | Enables granular feature queries |
| Scale | 20-100 files, seeding < 5 min | Medium scale, performance matters |
| Step 6 | Removed entirely | KB is read-only; no auto-store |
| Re-seed wipe | Wipe estimations + proposals namespaces only | Case studies untouched |

## Drive Folder IDs

```
GDRIVE_ESTIMATIONS_FOLDER_ID=1EZtqhgiv5iWimdvvFr6cnh7kHIlh-97Q
GDRIVE_PROPOSALS_FOLDER_ID=1kz5QsErVaYp4Q7rf2LP0t-RizL-e_VcQ
```

---

## Design

### 1. Data Model — Pinecone Schema

Two Pinecone namespaces within the existing `estimations` index:

#### Namespace: `estimations`

**Project summary record** (1 per Sheet):
```
ID: sheet_{sheetId}_summary
Vector: embedding of full Sheet text (all rows concatenated)
Metadata:
  type: "estimation_summary"
  project_name: string
  total_hours: number
  total_cost_eur: number
  duration_weeks: number
  tech_stack: string (comma-separated)
  team_roles: string (comma-separated unique roles)
  feature_count: number
  sheet_id: string
  sheet_url: string
  linked_proposal_id: string | ""
  source: "gsheet:{sheetId}"
  chunk_text: string (first 2000 chars)
```

**Feature-level records** (1 per row):
```
ID: sheet_{sheetId}_feat_{index}
Vector: embedding of "Project: {name}. Feature: {feature}, {role}, {hours}h, €{cost}"
Metadata:
  type: "estimation_feature"
  project_name: string
  feature_name: string
  role: string
  hours: number
  cost_eur: number
  sheet_id: string
  source: "gsheet:{sheetId}"
```

#### Namespace: `proposals`

```
ID: proposal_{docId}_chunk{i}
Vector: embedding of text chunk
Metadata:
  type: "proposal"
  project_name: string
  doc_id: string
  doc_url: string
  linked_sheet_id: string | ""
  chunk_index: number
  chunk_text: string (first 2000 chars)
  source: "gdoc:{docId}"
```

#### Default namespace (unchanged)

Case studies from blazity.com stay with `type: "case_study"`.

### 2. MCP Tools — Rewritten Knowledge Base Server

3 tools total (replacing current 3):

**`search_past_estimations`** — Searches `estimations` namespace for similar past projects. Returns structured data.
- Params: `query`, `top_k` (1-10, default 5), `filter_tech?`, `filter_role?`
- Searches both `estimation_summary` and `estimation_feature` records
- Deduplicates: groups multiple feature matches from same project
- Returns structured output: project name, hours, cost, team, features, sheet URL, linked proposal

**`search_past_proposals`** — Searches `proposals` namespace. Returns text chunks for writing reference.
- Params: `query`, `top_k` (1-10, default 3)
- Returns: project name, score, chunk text preview, doc URL, linked sheet URL

**`search_case_studies`** — Unchanged from current implementation.

### 3. Seeding Script

Rewritten `seed-knowledge-base.ts` sources from Google Drive:

1. List files in `GDRIVE_ESTIMATIONS_FOLDER_ID` (Sheets)
2. List files in `GDRIVE_PROPOSALS_FOLDER_ID` (Docs)
3. Build filename map → link paired Sheets/Docs
4. Wipe `estimations` + `proposals` namespaces (case studies untouched)
5. Process Sheets → Google Sheets API v4 structured cell extraction → `estimations` namespace
6. Process Docs → text chunking (paragraphs + tables, 800 words, 80 overlap) → `proposals` namespace

**Sheet parsing:** Uses Sheets API `spreadsheets.get` with `includeGridData: true`. Detects header row (Feature/Task, Role, Hours, Rate, Cost columns). Parses each data row into structured records.

**Filename-based linking:** Normalize filenames (lowercase, strip punctuation/whitespace), match across folders.

**Incremental mode (`--incremental`):** Tracks `{ fileId: lastModifiedTime }` in `.seed-state.json`. Only re-indexes new/modified files. Default (no flag) wipes and rebuilds.

**Raw fetch for Google APIs** (consistent with existing google-workspace MCP patterns — no `googleapis` package).

### 4. Orchestrator Pipeline Changes

**Pipeline: 6 steps → 5 steps**
```
1. Analysis        (KB search + web research)
2. Clarification   (Slack Q&A loop)
3. Value Discovery (client business research)
4. Offer           (Google Doc creation)
5. Presentation    (Google Slides deck)
```

**Step 1 updated:**
1. `search_past_estimations` — structured data for effort/cost calibration
2. `search_past_proposals` — text chunks for writing style reference
3. `search_case_studies` — social proof (unchanged)

**System prompt updated** to instruct agent:
- Estimation results → calibrate effort against real historical data
- Proposal results → reference for tone, structure, detail level
- Case study results → social proof in the offer

**TOOL_TO_STEP map updated**, `store_estimation` removed, new tool names added.

**STEP_NAMES:** `["Initializing", "Analysis", "Clarification", "Value Discovery", "Offer", "Presentation"]`

### 5. Cleanup & Migration

**Delete:**
- `past-estimates/` directory entirely

**Rewrite:**
- `scripts/seed-knowledge-base.ts`
- `src/mcp-servers/knowledge-base.ts`
- `src/agents/orchestrator.ts` (Step 1 prompt, step names, tool map, remove Step 6)

**Update:**
- `.env.example` — add `GDRIVE_ESTIMATIONS_FOLDER_ID`, `GDRIVE_PROPOSALS_FOLDER_ID`
- `.ai/architecture.md` — 5-step pipeline, Drive-sourced KB
- `.ai/mcp-tools.md` — new KB tool descriptions
- `package.json` — remove `pdf-parse` dependency

**Unchanged:**
- `scripts/seed-case-studies.ts`
- `src/mcp-servers/google-workspace.ts`
- `src/lib/file-ingestion.ts`

**Tests:**
- Rewrite `knowledge-base.test.ts` for new tools
- New test coverage for Sheet parsing logic (structured extraction)

---

## Implementation Plan

- [ ] **Phase 1: Seeding script** — rewrite `seed-knowledge-base.ts` for Drive-sourced dual-namespace indexing
  - [ ] Add `GDRIVE_ESTIMATIONS_FOLDER_ID` and `GDRIVE_PROPOSALS_FOLDER_ID` to `.env.example`
  - [ ] Implement Google Sheets API structured extraction (cell parsing, header detection, row parsing)
  - [ ] Implement Google Docs text extraction (reuse existing paragraph + table parsing)
  - [ ] Implement filename-based Sheet↔Doc linking
  - [ ] Implement namespace wipe (estimations + proposals only)
  - [ ] Implement `--incremental` flag with `.seed-state.json` tracking
  - [ ] Test with real Drive folders — verify parsed data quality
- [ ] **Phase 2: Knowledge Base MCP server** — rewrite `knowledge-base.ts` with new tools
  - [ ] Implement `search_past_estimations` (dual-type search, deduplication, structured output)
  - [ ] Implement `search_past_proposals` (namespace-scoped chunk search)
  - [ ] Keep `search_case_studies` (unchanged, default namespace)
  - [ ] Remove `store_estimation` tool
  - [ ] Write tests for new tools
- [ ] **Phase 3: Orchestrator** — update pipeline from 6 to 5 steps
  - [ ] Update `STEP_NAMES` (remove "Knowledge Base")
  - [ ] Update `TOOL_TO_STEP` map (new tool names, remove `store_estimation`)
  - [ ] Rewrite Step 1 prompt to use `search_past_estimations` + `search_past_proposals`
  - [ ] Add calibration instructions to system prompt (how to use structured estimation data)
  - [ ] Remove Step 6 instructions and `store_estimation` from `requiredEnv`
- [ ] **Phase 4: Cleanup** — remove legacy, update docs
  - [ ] Delete `past-estimates/` directory
  - [ ] Remove `pdf-parse` from `package.json`
  - [ ] Update `.ai/architecture.md`
  - [ ] Update `.ai/mcp-tools.md`
  - [ ] Type-check: `npx tsc --noEmit`
  - [ ] Run all tests
- [ ] **Phase 5: Verification** — end-to-end test
  - [ ] Run `npm run seed` against real Drive folders
  - [ ] Verify Pinecone has correct namespaces and record counts
  - [ ] Run a test estimation and verify Step 1 uses new tools correctly
