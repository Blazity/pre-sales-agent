# SPEC-007: Docs Formatting Repair

**Status:** Implemented
**Date:** 2026-02-27

---

## Design

# Google Doc Formatting Repair — Design

## Problem

The Google Doc offers created by the agent are unusable: "everything is a bullet point, no breaks, unstructured, completely unreadable." The document does not resemble the reference offers at all.

## Root Causes

Five bugs in `src/mcp-servers/google-workspace.ts` (`buildBatchUpdateRequests` and the `docs_write_sections` tool handler):

### Bug 1: Zero spacing between sections

Every section ends with `\n` but there is no blank paragraph between sections. A heading runs directly into the next paragraph, a list runs directly into the next heading. The result is a wall of content with no visual breathing room.

### Bug 2: Table header bold styling uses wrong indices

Cells are filled in reverse order (last cell first), which correctly avoids shifting earlier cell positions. But the bold header styling (lines 546-558) uses the **original empty-table indices**, which are now wrong because cell text insertions have shifted them.

Example with headers `["Name", "Age"]`:
1. "Age" inserted at index 5, then "Name" inserted at index 3
2. "Name" insertion shifts "Age" from position 5 to position 9
3. Bold style for "Age" still targets `[5, 8]` — pointing inside "Name\n", not "Age"

### Bug 3: Table cell index formula is unverified

The formula `tableContentStart + r * (cols * 2 + 1) + c * 2 + 1` assumes a specific Google Docs internal table structure. If the actual structure differs (additional structural elements per cell), every cell insertion goes to the wrong position and the entire batchUpdate fails with an API error.

### Bug 4: No error resilience

All sections (headings, paragraphs, tables, charts) are bundled into a single batchUpdate. If one table's index math is wrong, **every section fails**. The agent gets zero content written and falls back to the simplest possible output (all bullet lists via `docs_create_document`).

### Bug 5: Always inserts at index 1 (overwrites on multi-call)

`buildBatchUpdateRequests` always uses `idx = 1`. If the agent calls `docs_write_sections` twice (which the current prompt encourages — main body + expertise sections separately), the second call inserts at the beginning, scrambling the first call's content.

---

## Solution: Hybrid Forward Cursor

Replace the reverse-insert-at-1 approach with forward processing:

| Component | Approach |
|-----------|----------|
| Simple sections (heading, paragraph, list, divider, page_break, image, chart) | Forward cursor in a single batchUpdate per batch |
| Tables | Separate workflow: insert structure → read back document → fill cells with real indices |
| Spacing | `\n` between sections (empty paragraph) |
| Multi-call safety | Read document end index before writing (append mode) |
| Error handling | Per-group try/catch, partial success reporting |

---

## 1. Section Processing Architecture

### Entry Point

The `docs_write_sections` tool handler replaces the single `buildBatchUpdateRequests` + one `batchUpdate` call with `executeSections()`:

```typescript
async function executeSections(
  documentId: string,
  sections: Section[],
  chartEmbeds: Map<number, ChartEmbed>,
  token: string,
): Promise<{ written: number; errors: string[] }>
```

### Flow

```
1. Read document → get end index → set cursor
2. Group sections into batches:
   - consecutive simple sections → one "simple" batch
   - each table → one "table" batch
3. For each batch:
   a. simple → buildSimpleBatch(sections, cursor) → single batchUpdate → advance cursor
   b. table  → insertTable → read doc → fill cells with real indices → advance cursor
   c. Add \n spacing between batches
4. Return { written, errors }
```

### Section Grouping

```typescript
type SectionGroup =
  | { type: "simple"; sections: Section[]; originalIndices: number[] }
  | { type: "table"; table: TableSection; originalIndex: number };

function groupSections(sections: Section[]): SectionGroup[]
```

Consecutive non-table sections are grouped together. Each table breaks the sequence.

Example: `[heading, paragraph, table, heading, paragraph, table, paragraph]`
→ `[simple([heading, paragraph]), table, simple([heading, paragraph]), table, simple([paragraph])]`

---

## 2. Simple Section Batch

### Function

```typescript
function buildSimpleBatch(
  sections: Section[],
  startCursor: number,
  sectionIndices: number[],
  chartEmbeds: Map<number, ChartEmbed>,
): { requests: DocRequest[]; charsInserted: number }
```

### Cursor Advancement by Type

| Type | Characters inserted | Formula |
|------|-------------------|---------|
| heading | `text.length + 1` | text + `\n` |
| paragraph | `plainText.length + 1` | stripped text + `\n` |
| bullet_list | `items.join("\n").length + 1` | items joined by `\n` + trailing `\n` |
| numbered_list | same as bullet_list | |
| divider | `1` | `\n` |
| page_break | `2` | page break char + `\n` |
| image | `2` | inline image + `\n` |
| chart | `2` | inline chart + `\n` |
| spacing | `1` | `\n` between sections |

### Spacing Logic

Before each section (except when cursor equals 1, i.e., start of empty document), insert `\n` at cursor and advance by 1. This creates a blank paragraph between sections.

### Bold/Italic in Paragraphs

Same `parseFormattedText()` logic, but style ranges now reference `cursor + offset` (always correct because we're processing forward).

---

## 3. Table Workflow

### Step 1: Insert Table Structure

```typescript
await sendBatchUpdate(documentId, [
  { insertTable: { rows, columns, location: { index: cursor } } },
], token);
```

### Step 2: Read Document Structure

```typescript
const doc = await getDocumentStructure(documentId, token);
```

Uses `GET https://docs.googleapis.com/v1/documents/{id}` to get the full document body with element indices. Find the table element starting at `cursor` and extract exact cell paragraph start indices:

```typescript
function extractCellPositions(doc: DocStructure, tableStartIdx: number): number[][] {
  const table = doc.body.content.find(
    (el: any) => el.table && el.startIndex === tableStartIdx
  );
  return table.table.tableRows.map((row: any) =>
    row.tableCells.map((cell: any) => cell.content[0].startIndex)
  );
}
```

No index math — we use the **actual** positions from the API.

### Step 3: Fill Cells + Bold Headers

Process cells in **forward order** with cumulative shift tracking:

```typescript
function buildTableFillRequests(
  headers: string[],
  rows: string[][],
  cellPositions: number[][],
): { requests: DocRequest[]; totalTextInserted: number } {
  const requests: DocRequest[] = [];
  let shift = 0;
  const allData = [headers, ...rows];

  for (let r = 0; r < allData.length; r++) {
    for (let c = 0; c < allData[r].length; c++) {
      const text = allData[r][c];
      if (!text) continue;

      const actualIdx = cellPositions[r][c] + shift;
      requests.push({ insertText: { location: { index: actualIdx }, text } });

      // Bold header row — applied immediately after insert (correct position)
      if (r === 0) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: actualIdx, endIndex: actualIdx + text.length },
            textStyle: { bold: true },
            fields: "bold",
          },
        });
      }

      shift += text.length;
    }
  }

  return { requests, totalTextInserted: shift };
}
```

Forward fill + immediate bold after each header cell = correct indices always.

### Step 4: Advance Cursor

```typescript
function getTableEndIndex(doc: DocStructure, tableStartIdx: number): number {
  const table = doc.body.content.find(
    (el: any) => el.table && el.startIndex === tableStartIdx
  );
  return table.endIndex; // End of table element (before trailing paragraph)
}

cursor = getTableEndIndex(doc, cursor) + totalTextInserted;
```

---

## 4. Append Mode

Read the document at the start of `executeSections` to find the current end index:

```typescript
function getDocumentEndIndex(doc: DocStructure): number {
  const body = doc.body.content;
  const lastElement = body[body.length - 1];
  return lastElement.endIndex - 1; // -1 for trailing newline
}
```

This fixes Bug 5: multiple `docs_write_sections` calls append correctly instead of overwriting.

---

## 5. Error Resilience

Each batch group (simple or table) is wrapped in try/catch:

```typescript
for (const group of groups) {
  try {
    // ... process group
    written += group.sectionCount;
  } catch (err) {
    errors.push(`Sections ${group.range}: ${String(err)}`);
    // Re-read document to recalibrate cursor for next group
    const doc = await getDocumentStructure(documentId, token);
    cursor = getDocumentEndIndex(doc);
  }
}
```

If a table fails, simple sections before and after it are still written. The response tells the agent exactly what failed:

```
Written 15/18 sections. Errors:
- Section 8 (table): Table cell positions could not be read
```

---

## 6. Orchestrator Prompt Consolidation

Merge the split docs_write_sections instructions into one clear call.

### Current (ambiguous, encourages multiple calls)

Step 3 CREATION says "Write the full offer using docs_write_sections" but EXPERTISE POSITIONING later says "Write a 'Why Blazity' section using docs_write_sections" — suggesting separate calls.

### New (single call, explicit section order)

Replace Step 3 CREATION + EXPERTISE POSITIONING with:

```
CREATION:
1. Create a new Google Doc using docs_create_document in the Output folder
   (folder ID: {outputFolderId}) with title: "Offer - [Project Name] - [Date]"
2. Write the ENTIRE offer in a SINGLE docs_write_sections call with all sections
   in this exact order:

   a. heading level 1: document title
   b. heading level 2: "Executive Summary" + paragraph
   c. heading level 2: "Scope" + bullet_list (grouped by area: Frontend, Backend, Infrastructure)
   d. heading level 2: "Tech Stack" + paragraph (with justified choices)
   e. heading level 2: "Why Blazity" + paragraph (cite specific past client + metric,
      Vercel partner, Deloitte Fast 50, ecosystem adoption from web fetch)
   f. heading level 2: "Relevant Case Study: [Client Name]" + paragraphs
      (client + problem, approach, **bold metrics**, relevance to current RFP)
   g. heading level 2: "Team" + table (Role | Seniority | Allocation % | Active Weeks)
   h. heading level 2: "Timeline" + table (Phase | Deliverables | Duration | Milestone)
   i. page_break
   j. heading level 2: "Pricing" + table (Phase | Effort | Rate | Subtotal, total row)
   k. chart: budget breakdown by phase (bar or pie)
   l. heading level 2: "Terms" + paragraph (payment schedule, IP, warranty, next steps)

   IMPORTANT: Send ALL sections in ONE docs_write_sections call. Do not split into
   multiple calls — the tool appends content, so splitting would break section ordering
   relative to the structure above.
```

---

## 7. API Call Budget

| Scenario | API Calls | Time Estimate |
|----------|-----------|---------------|
| 15 simple sections, 0 tables | 1 read + 1 batch = 2 | ~0.5s |
| 15 simple sections, 3 tables | 1 read + 3 batches + 3×(insert+read+fill) = 13 | ~2-3s |
| Worst case: 20 sections, 5 tables | 1 + 4 + 15 = 20 | ~4s |

Well within acceptable range for offer generation.

---

## Implementation Order

- [x] **Task 1:** Create `groupSections()` — split sections into simple batches and individual tables
- [x] **Task 2:** Create `buildSimpleBatch()` — forward cursor processing for heading, paragraph, list, divider, page_break, image, chart sections with spacing
- [x] **Task 3:** Create `getDocumentStructure()` and `getDocumentEndIndex()` — read document body and find end index
- [x] **Task 4:** Create `extractCellPositions()` — parse table element from document structure, return actual cell paragraph indices
- [x] **Task 5:** Create `buildTableFillRequests()` — forward fill with shift tracking, bold headers with correct indices
- [x] **Task 6:** Create `executeSections()` — orchestrate multi-call flow with error resilience
- [x] **Task 7:** Update `docs_write_sections` tool handler to use `executeSections()` instead of `buildBatchUpdateRequests()`
- [x] **Task 8:** Remove old `buildBatchUpdateRequests()` function
- [x] **Task 9:** Consolidate orchestrator prompt — single docs_write_sections call with explicit section order
- [x] **Task 10:** Update tests — new functions (groupSections, buildSimpleBatch, buildTableFillRequests, extractCellPositions), remove old buildBatchUpdateRequests tests
- [x] **Task 11:** Full build verification (npx tsc --noEmit + node --test)

## Files Modified

| File | Changes |
|------|---------|
| `src/mcp-servers/google-workspace.ts` | Replace `buildBatchUpdateRequests` with `executeSections` + helper functions, update tool handler |
| `src/agents/orchestrator.ts` | Consolidate Step 3 into single docs_write_sections call with explicit section order |
| `src/mcp-servers/google-workspace.test.ts` | Replace old tests with new function tests |

## Dependencies

- No new npm packages
- No new env vars
- No new OAuth scopes (documents.get already covered by existing scope)

---

## Agent Prompt

# Coding Agent Prompt — Google Doc Formatting Repair

## Context

The `docs_write_sections` tool in `src/mcp-servers/google-workspace.ts` produces broken Google Doc output. The design document is at `.ai/specs/SPEC-007-docs-formatting-repair.md (Design section)`. Read it fully before starting.

## Branch

Create branch `fix/docs-formatting-repair` from current HEAD.

## Scope

You are modifying:
- `src/mcp-servers/google-workspace.ts` — replace `buildBatchUpdateRequests` with new multi-call architecture
- `src/agents/orchestrator.ts` — consolidate Step 3 prompt (single docs_write_sections call)
- `src/mcp-servers/google-workspace.test.ts` — replace old tests with new function tests

## Tasks

Execute the tasks in the design document's Implementation Order. Mark each `[ ]` as `[x]` when done.

### Task 1: `groupSections()`

Create and export:

```typescript
type SectionGroup =
  | { type: "simple"; sections: Section[]; originalIndices: number[] }
  | { type: "table"; table: Extract<Section, { type: "table" }>; originalIndex: number };

export function groupSections(sections: Section[]): SectionGroup[]
```

Group consecutive non-table sections into "simple" groups. Each table becomes its own "table" group.

### Task 2: `buildSimpleBatch()`

Create and export:

```typescript
export function buildSimpleBatch(
  sections: Section[],
  startCursor: number,
  sectionIndices: number[],
  chartEmbeds?: Map<number, ChartEmbed>,
): { requests: DocRequest[]; charsInserted: number }
```

Process sections forward with a running cursor:
- Before each section (when cursor > 1), insert `\n` for spacing and advance cursor by 1
- For each section type, build requests at cursor and advance by character count:
  - heading: `text + "\n"` → text.length + 1
  - paragraph: parse `**bold**`/`*italic*`, insert plainText + `"\n"` → plainText.length + 1, add updateTextStyle for marked ranges
  - bullet_list/numbered_list: `items.join("\n") + "\n"` → that length, add createParagraphBullets
  - divider: `"\n"` → 1, add updateParagraphStyle with borderBottom
  - page_break: insertPageBreak + `"\n"` → 2
  - image: insertInlineImage + `"\n"` → 2
  - chart: insertInlineSheetsChart (if embed exists) + `"\n"` → 2

Re-use existing `parseFormattedText()` for bold/italic parsing.

### Task 3: Document structure helpers

Create (not exported, internal):

```typescript
async function getDocumentStructure(documentId: string, token: string): Promise<any>
// GET https://docs.googleapis.com/v1/documents/{documentId}
// Returns full document JSON

function getDocumentEndIndex(doc: any): number
// Find last element in doc.body.content, return endIndex - 1
```

### Task 4: `extractCellPositions()`

Create and export:

```typescript
export function extractCellPositions(doc: any, tableStartIdx: number): number[][]
```

Find the table element in `doc.body.content` where `startIndex === tableStartIdx`. For each row → for each cell → return `cell.content[0].startIndex` (the paragraph where text should be inserted).

Throw if table not found at expected position.

### Task 5: `buildTableFillRequests()`

Create and export:

```typescript
export function buildTableFillRequests(
  headers: string[],
  rows: string[][],
  cellPositions: number[][],
): { requests: DocRequest[]; totalTextInserted: number }
```

Forward fill with shift tracking:
- Iterate `[headers, ...rows]` in forward order (row 0 first, col 0 first)
- For each non-empty cell: `insertText` at `cellPositions[r][c] + shift`, advance shift by text.length
- For header row (r === 0): `updateTextStyle` with bold immediately after the insertText (uses same `actualIdx`)
- Return total shift for cursor advancement

### Task 6: `executeSections()`

Create (internal, used by tool handler):

```typescript
async function executeSections(
  documentId: string,
  sections: Section[],
  chartEmbeds: Map<number, ChartEmbed>,
  token: string,
): Promise<{ written: number; errors: string[] }>
```

Flow:
1. `getDocumentStructure()` → `getDocumentEndIndex()` → set cursor
2. `groupSections(sections)` → get groups
3. For each group:
   - If simple: `buildSimpleBatch()` → `sendBatchUpdate()` → advance cursor
   - If table:
     a. Send `insertTable` batchUpdate at cursor
     b. `getDocumentStructure()` → `extractCellPositions()` at cursor
     c. `buildTableFillRequests()` → `sendBatchUpdate()`
     d. Get table end from doc structure + totalTextInserted → advance cursor
   - Add `\n` spacing between groups (insert at cursor, advance by 1) — except after the last group
   - Wrap each group in try/catch. On error: push to errors array, re-read document to recalibrate cursor
4. Return { written, errors }

Create a helper `sendBatchUpdate()`:

```typescript
async function sendBatchUpdate(documentId: string, requests: DocRequest[], token: string): Promise<void> {
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`batchUpdate failed: ${text}`);
  }
}
```

### Task 7: Update tool handler

Replace the current `docs_write_sections` tool handler body. The chart creation phase (Sheets API) stays the same. Replace:

```typescript
const requests = buildBatchUpdateRequests(sections, chartEmbeds);
// ... single batchUpdate
```

With:

```typescript
const result = await executeSections(document_id, sections, chartEmbeds, token);
const errMsg = result.errors.length > 0
  ? `\nErrors:\n${result.errors.map(e => `- ${e}`).join("\n")}`
  : "";
return {
  content: [{
    type: "text" as const,
    text: `Written ${result.written}/${sections.length} sections.${chartCount > 0 ? ` Embedded ${chartCount} chart(s).` : ""}${errMsg}\nURL: https://docs.google.com/document/d/${document_id}/edit`,
  }],
};
```

### Task 8: Remove old function

Delete the `buildBatchUpdateRequests()` function entirely. It is replaced by `buildSimpleBatch()` + `buildTableFillRequests()` + `executeSections()`.

### Task 9: Orchestrator prompt consolidation

In `src/agents/orchestrator.ts`, replace the Step 3 section (CREATION + EXPERTISE POSITIONING) with a single consolidated instruction. The new text should be:

```
CREATION:
1. Create a new Google Doc using docs_create_document in the Output folder
   (folder ID: ${job.outputFolderId ?? "root"}) with title: "Offer - [Project Name] - [Date]"
2. Write the ENTIRE offer in a SINGLE docs_write_sections call with all sections
   in this exact order:

   a. heading level 1: document title
   b. heading level 2: "Executive Summary" + paragraph (3-4 sentences: client challenge, solution preview, budget range)
   c. heading level 2: "Scope" + bullet_list (grouped by area: Frontend, Backend, Infrastructure — each item has 1-line description)
   d. heading level 2: "Tech Stack" + paragraph (justified choices — explain WHY each technology fits)
   e. heading level 2: "Why Blazity" + paragraph (cite specific past client + metric from search_case_studies,
      mention Vercel partner + Deloitte Fast 50 + open source, add 1 sentence ecosystem context from web fetch.
      Be SPECIFIC: "we delivered X for Y, achieving Z" — never "we have extensive experience")
   f. heading level 2: "Relevant Case Study: [Client Name]" + paragraphs
      (1. client + problem — 1 sentence, 2. approach — 2-3 sentences, 3. **bold metrics** — results,
      4. relevance to current RFP — 1 sentence. Use real metrics from search_case_studies, never fabricate.)
   g. heading level 2: "Team" + table (columns: Role | Seniority | Allocation % | Active Weeks)
   h. heading level 2: "Timeline" + table (columns: Phase | Deliverables | Duration | Milestone — include buffer)
   i. page_break
   j. heading level 2: "Pricing" + table (columns: Phase | Effort (person-days) | Rate | Subtotal — add total row. All EUR.)
   k. chart: budget breakdown by phase (bar or pie)
   l. heading level 2: "Terms" + paragraph (payment schedule, IP ownership, warranty, change request process, next steps)

   IMPORTANT: Send ALL sections in ONE docs_write_sections call.
   Do NOT split across multiple calls — the tool appends content sequentially.
```

Remove the separate EXPERTISE POSITIONING block entirely (its content is now integrated into items e and f above).

Keep the PREPARATION and REVIEW blocks unchanged.

### Task 10: Update tests

Replace all `buildBatchUpdateRequests` tests with:

**`groupSections()` tests:**
- Empty array → empty groups
- All simple sections → one simple group
- Table at start → table group + simple group
- Table in middle → simple + table + simple
- Multiple tables → correct grouping

**`buildSimpleBatch()` tests:**
- Single heading → correct insert + style + charsInserted
- Heading + paragraph → spacing \n between them
- Paragraph with **bold** → correct style range relative to cursor
- Bullet list → correct text + createParagraphBullets range
- Starting cursor > 1 → spacing before first section
- Starting cursor = 1 → no spacing before first section

**`buildTableFillRequests()` tests:**
- 2×2 table with mock cellPositions → correct insert positions with shift
- Bold header styling → correct ranges (immediately after each header insert)
- Empty cells → skipped
- Single row (headers only) → bold applied

**`extractCellPositions()` tests:**
- Mock document structure with table → correct cell positions extracted
- Table not found → throws

Keep existing `parseFormattedText()` and `buildChartSheetData()` tests unchanged.

### Task 11: Build verification

```bash
npx tsc --noEmit && node --test dist/mcp-servers/google-workspace.test.js
```

Both must pass.

## Commit

Single commit with scope: `fix(docs-formatting): replace fragile index math with hybrid forward cursor`

## Verification Checklist

After implementation, verify:
- [ ] `npx tsc --noEmit` passes
- [ ] All tests pass
- [ ] `buildBatchUpdateRequests` is fully removed (no references)
- [ ] `docs_write_sections` tool handler uses `executeSections()`
- [ ] Orchestrator Step 3 has single consolidated docs_write_sections instruction
- [ ] No EXPERTISE POSITIONING block in orchestrator prompt (merged into CREATION)
- [ ] Exported functions: `parseFormattedText`, `buildChartSheetData`, `groupSections`, `buildSimpleBatch`, `buildTableFillRequests`, `extractCellPositions`
