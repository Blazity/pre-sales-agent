# SPEC-006: Offer Quality & Formatting

**Status:** Implemented
**Date:** 2026-02-27

---

# Offer Quality & Formatting — Design

## Problem

The Google Doc offers produced by the agent suffer from two compounding issues:

1. **No formatting capability** — `docs_create_document` inserts plain text only. No headings, bold, tables, bullet lists, or page breaks. The result is a wall of undifferentiated text.
2. **No content quality guidance** — the orchestrator prompt gives minimal instruction ("Executive Summary (2-3 sentences)"). The knowledge base has zero seeded examples. The agent has no reference for tone, depth, or structure.
3. **Broken template approach** — `GDRIVE_TEMPLATE_ID` points to a real past offer, not a placeholder-based template. The agent copies it but has no way to replace content surgically. It either leaves old content or falls back to a plain-text new doc.

## Solution Overview

Four coordinated changes:

| Change | Purpose |
|--------|---------|
| New `docs_write_sections` MCP tool | Rich Google Docs formatting via structured section data |
| Chart support via Google Sheets | Embedded Sheets charts in Google Docs for timeline/budget visuals |
| Knowledge base seeding with real offers | Agent can find and read full past offers at runtime |
| Enhanced orchestrator prompt | Content quality guidance, study-before-writing, self-review |
| New offer creation flow | Deprecate template copy, use create + write sections + verify |

---

## 1. New MCP Tool: `docs_write_sections`

**File:** `src/mcp-servers/google-workspace.ts`

A high-level tool that takes structured section data and translates it to Google Docs `batchUpdate` API requests. The agent describes WHAT to write; the tool handles HOW (character offsets, paragraph styles, text formatting).

### Tool Signature

```
docs_write_sections(document_id: string, sections: Section[])
```

### Section Types

```typescript
type Section =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }           // supports **bold** and *italic* markers
  | { type: "bullet_list"; items: string[] }
  | { type: "numbered_list"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "divider" }
  | { type: "page_break" }
  | { type: "image"; drive_file_id: string; width?: number; height?: number }
  | { type: "chart"; chart_type: "bar" | "line" | "pie" | "column"; title: string; labels: string[]; datasets: { label: string; data: number[] }[] }
```

### Implementation Approach

The tool processes sections sequentially, tracking a running `insertIndex`:

1. For each section, build the appropriate `batchUpdate` requests:
   - `heading` → `insertText` + `updateParagraphStyle` (HEADING_1/2/3) + `updateTextStyle` (bold for H1)
   - `paragraph` → `insertText` + parse `**bold**`/`*italic*` markers → `updateTextStyle` for marked ranges
   - `bullet_list` → `insertText` for each item + `createParagraphBullets` (BULLET_DISC_CIRCLE_SQUARE)
   - `numbered_list` → `insertText` for each item + `createParagraphBullets` (NUMBERED_DECIMAL_NESTED)
   - `table` → `insertTable` (rows × cols) + per-cell `insertText` + header row bold styling
   - `divider` → `insertText("\n")` + `updateParagraphStyle` with bottom border
   - `page_break` → `insertPageBreak`
   - `image` → build Drive download URL for file, `insertInlineImage` with optional dimensions
   - `chart` → creates a temporary Google Sheet, populates data, creates chart via Sheets API `addChart`, then embeds in the Doc via Docs API `insertInlineSheetsChart`

2. All requests collected into a single `batchUpdate` call for atomicity (except `chart` which requires a separate Sheets API flow before the Docs embed).

3. Requests are ordered in **reverse** (last section first) so that insertions don't shift the indices of subsequent operations. This is the standard pattern for Docs API batch writes.

### Error Handling

- If the batchUpdate partially fails, return which sections succeeded and which failed
- If the document doesn't exist, return a clear error
- If an image Drive file ID is invalid, skip the image and note it in the response

---

## 1b. Chart Support via Google Sheets

**File:** `src/mcp-servers/google-workspace.ts`

The `chart` section type in `docs_write_sections` handles all Sheets plumbing internally. The agent only provides chart data — the tool creates the Sheet, chart, and embeds it.

### Agent Interface

```json
{
  "type": "chart",
  "chart_type": "bar",
  "title": "Project Budget by Phase",
  "labels": ["Discovery", "MVP", "Polish", "Launch"],
  "datasets": [{
    "label": "Cost (EUR)",
    "data": [5000, 25000, 15000, 8000]
  }]
}
```

### Internal Flow

1. **Create temporary Sheet** — `POST https://sheets.googleapis.com/v4/spreadsheets` with title `"Chart - {chart_title}"` in the same Output folder (pass `parent_folder_id` or use the doc's parent)
2. **Populate data** — `PUT https://sheets.googleapis.com/v4/spreadsheets/{id}/values/Sheet1!A1?valueInputOption=RAW` with a 2D array: header row (labels) + data rows (one per dataset)
3. **Create chart** — `POST https://sheets.googleapis.com/v4/spreadsheets/{id}:batchUpdate` with `addChart` request:
   - `chartType`: BAR_CHART / LINE_CHART / PIE / COLUMN (mapped from agent's `chart_type`)
   - `basicChart.domains`: column A (labels)
   - `basicChart.series`: columns B+ (one per dataset)
   - `title`: from agent input
4. **Get chart ID** — response from `addChart` returns the `chartId`
5. **Embed in Doc** — Docs API `batchUpdate` with `insertInlineSheetsChart`:
   ```json
   {
     "insertInlineSheetsChart": {
       "spreadsheetId": "<sheet_id>",
       "chartId": <chart_id>,
       "location": { "index": <current_insert_index> },
       "objectSize": {
         "width": { "magnitude": 450, "unit": "PT" },
         "height": { "magnitude": 280, "unit": "PT" }
       }
     }
   }
   ```

### Supported Chart Types

| Agent value | Sheets API type | Best for |
|-------------|----------------|----------|
| `"bar"` | BAR_CHART | Budget comparison, effort by phase |
| `"column"` | COLUMN | Timeline, phase durations |
| `"line"` | LINE | Progress over time, burn-down |
| `"pie"` | PIE | Budget allocation, team distribution |

### OAuth Scope Requirement

Requires `https://www.googleapis.com/auth/spreadsheets` scope. Re-run `scripts/get-google-token.ts` with the additional scope added.

**File:** `scripts/get-google-token.ts` — add `spreadsheets` to the scopes array.

---

## 2. Knowledge Base Seeding with Real Offers

### Seeding Script Changes

**File:** `scripts/seed-knowledge-base.ts`

When processing Google Docs entries:
- Store `doc_id` in Pinecone metadata (already has `source: "gdoc:<id>"`, extract and store `doc_id` explicitly)
- Increase `chunk_text` metadata from 500 to 2000 chars
- Add `doc_url` field: `https://docs.google.com/document/d/<id>/edit`

### Runtime Retrieval Flow

No new tools needed. The agent uses existing tools in sequence:

```
1. search_similar_projects("SaaS platform MVP")
   → Returns matches with doc_id/doc_url in metadata

2. drive_export_file(doc_id, "text/html")
   → Returns the full past offer with HTML formatting preserved
   → Agent sees headings, tables, bold text, structure

3. Agent studies the format, tone, depth
4. Writes new offer matching that quality level
```

### Action Required (Manual)

Add 2-3 real past offer Google Doc IDs to `past-estimates/google-docs.json`:
```json
[
  { "url": "https://docs.google.com/document/d/<REAL_DOC_ID>/edit", "title": "Project X Offer", "type": "estimation" },
  { "url": "https://docs.google.com/document/d/<REAL_DOC_ID>/edit", "title": "Project Y Offer", "type": "estimation" }
]
```

Then run: `npx tsx scripts/seed-knowledge-base.ts`

---

## 3. Enhanced Orchestrator Prompt

**File:** `src/agents/orchestrator.ts`

### 3a. Offer Writing Guide (added to system prompt)

```
OFFER WRITING STANDARDS:

Tone: Professional but approachable. Confident without overselling. Write as a
senior solutions architect addressing a potential client's decision-makers.

Section depth requirements:
- Executive Summary: 3-4 sentences. Restate the client's challenge in our terms,
  preview our solution approach, and state the headline budget range.
- Scope: Exhaustive bullet list grouped by deliverable area (e.g., "Frontend",
  "Backend", "Infrastructure"). Each bullet has a 1-line description.
- Tech Stack: Justified choices — not just a list. Explain WHY each technology
  fits this specific project's requirements.
- Team: Table with columns: Role, Seniority, Allocation %, Active Weeks.
  Example: "Senior Backend Engineer | Senior | 80% | Weeks 1-8"
- Timeline: Phase-based table with columns: Phase, Deliverables, Duration, Milestone.
  Include buffer time. Show dependencies between phases.
- Pricing: Table with per-phase breakdown. Columns: Phase, Effort (person-days),
  Rate, Subtotal. Show total at bottom. All amounts in EUR.
- Terms: Payment schedule (e.g., 30% upfront, 40% mid-project, 30% on delivery),
  IP ownership, warranty period, change request process, next steps with dates.

Formatting: Use headings, bold for emphasis, tables for structured data, bullet
lists for deliverables. The document must look professional when opened in Google Docs.
```

### 3b. Study-Before-Writing Instruction (added to Step 3)

Replace the current Step 3 with:

```
## Step 3: Create the Google Doc Offer

PREPARATION — study past offers first:
1. From the similar projects found in Step 1, identify the most relevant past offer
2. If a Google Doc URL/ID is available in the search results, read the full offer
   using drive_export_file(doc_id, "text/html") to study its format, tone, and depth
3. Note the section structure, level of detail, and how pricing/timeline are presented

CREATION:
1. Create a new Google Doc using docs_create_document in the Output folder
   (folder ID: {outputFolderId}) with title "Offer - [Project Name] - [Date]"
2. Write the full offer using docs_write_sections with rich formatting:
   - Use heading level 1 for the document title
   - Use heading level 2 for each major section
   - Use tables for pricing, timeline, and team composition
   - Use bullet_list for scope deliverables
   - Use page_break before the Pricing section
   - Use chart sections for budget breakdown (bar/pie) and timeline visualization (column)
3. Post the Google Doc URL to Slack with a 2-line summary
```

### 3c. Self-Review Step (added after creation)

```
REVIEW:
1. Read back the document using docs_get_document to verify completeness
2. Check against this checklist:
   - [ ] Executive Summary present and specific (not generic)
   - [ ] Scope has grouped deliverables with descriptions
   - [ ] Tech Stack has justifications
   - [ ] Team table has roles, seniority, allocation
   - [ ] Timeline table has phases, durations, milestones
   - [ ] Pricing table has per-phase breakdown with total
   - [ ] Terms section has payment schedule and next steps
3. If any section is missing or shallow, update the document before posting to Slack
```

---

## 4. Offer Creation Flow Change

### Current Flow (broken)
```
docs_copy_template(real_offer_id) → Can't replace content → Falls back to plain text doc
```

### New Flow
```
search_similar_projects → drive_export_file (study reference) →
docs_create_document (empty doc) → docs_write_sections (rich formatted content) →
docs_get_document (self-review) → post to Slack
```

### Template Deprecation

- Remove `docs_copy_template` from the orchestrator prompt's Step 3
- Keep the tool in the MCP server (might be useful for other purposes)
- Remove `GDRIVE_TEMPLATE_ID` from the orchestrator prompt references
- Keep the env var (still referenced elsewhere)

---

## Implementation Order

- [x] **Task 1:** Implement `docs_write_sections` tool in google-workspace.ts — heading, paragraph, bold/italic parsing
- [x] **Task 2:** Add bullet_list and numbered_list support to docs_write_sections
- [x] **Task 3:** Add table support to docs_write_sections (insertTable + cell content + header styling)
- [x] **Task 4:** Add page_break, divider, and image support to docs_write_sections
- [x] **Task 5:** Add chart section type — Sheets API integration (create sheet, populate, addChart, insertInlineSheetsChart)
- [x] **Task 6:** Add spreadsheets scope to scripts/get-google-token.ts
- [x] **Task 7:** Update seed script — store doc_id in metadata, increase chunk_text to 2000 chars
- [x] **Task 8:** Update orchestrator system prompt with offer writing guide
- [x] **Task 9:** Update orchestrator Step 3 — study-before-writing + new creation flow + self-review + charts
- [x] **Task 10:** Add docs_write_sections to allowedTools in orchestrator
- [x] **Task 11:** Write unit tests for docs_write_sections (section rendering, index math, bold/italic parsing, chart data shaping)
- [x] **Task 12:** Full build verification (npx tsc --noEmit + node --test)

## Files Modified

| File | Changes |
|------|---------|
| `src/mcp-servers/google-workspace.ts` | New `docs_write_sections` tool with all section types |
| `src/agents/orchestrator.ts` | Enhanced system prompt, new Step 3, self-review step, updated allowedTools |
| `scripts/seed-knowledge-base.ts` | Store doc_id, increase chunk_text to 2000 |
| `src/mcp-servers/google-workspace.test.ts` | Tests for section rendering and index math |
| `past-estimates/google-docs.json` | Manual: add real offer Doc IDs |

## Dependencies

- No new npm packages needed — Google Docs batchUpdate and Sheets API are REST
- Requires `docs.googleapis.com` scope (already granted via existing OAuth token)
- Requires `spreadsheets` scope for chart support — re-run `scripts/get-google-token.ts`
- Real offer Doc IDs must be added manually before seeding
