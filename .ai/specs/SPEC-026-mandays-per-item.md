# SPEC-026: Man-Days Per Action Item Estimation

**Status**: Implemented
**Date**: 2026-03-11

## Problem

The estimation sheet currently rolls up effort at the Major Area level (weeks), with only the first row of each area showing a number. Individual action items have no effort value. The team wants per-item granularity in man-days (MD).

## Design

### Input Schema Change

Move `effort_hours` from area level to item level:

```typescript
// Before
areas: [{
  name: string,
  effort_hours: number,      // area-level total
  items: [{ name: string, assumptions: string }]
}]

// After
areas: [{
  name: string,
  items: [{
    name: string,
    effort_hours: number,    // per-item hours
    assumptions: string
  }]
}]
```

### Row Layout

Every row gets a man-days value (hours ÷ 8). First row of each area has the area name in column A.

```
Major Area        | Action items             | Effort (MD) | Assumptions
Discovery & Audit | Lighthouse audit          | 5           | Mobile + desktop
                  | Asset dependency mapping  | 3           | All templates
Core Platform     | CMS setup                | 10          | Contentful
                  | Component library         | 15          | Design system exists
```

### Header Row

Write `["Major Area", "Action items", "Effort (MD)", "Assumptions"]` at A1:D1 before data rows, overwriting template header.

### Summary Rows

Bottom rows use MD labels:
- `Total required (MD)` — SUM formula
- `Total optional (MD)` — 0
- `Total (MD)` — SUM formula

### Orchestrator Prompt

- Step 4a: estimate effort in hours per action item (not per area)
- Estimation Rules: each item has its own effort estimate
- Tool converts hours → MD (÷8) automatically

## Files Changed

| File | Change |
|------|--------|
| `src/mcp-servers/google-workspace.ts` | Schema, `buildEstimationRows`, header write, summary labels, tool description |
| `src/agents/orchestrator.ts` | Step 4a prompt, Estimation Rules section |
| `src/mcp-servers/google-workspace.test.ts` | Update tests for new schema and row layout |

## Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Change estimation sheet from area-level weeks to per-item man-days.

**Architecture:** Move `effort_hours` from `EstimationArea` to each item. `buildEstimationRows` divides by 8 (not 40) and writes MD on every row. Header row overwritten. Summary labels say "MD". Orchestrator prompt tells agent to estimate per-item.

**Tech Stack:** TypeScript, Google Sheets API v4, Node test runner

---

### Task 1: Update tests for new schema (TDD — write failing tests first)

**Files:**
- Modify: `src/mcp-servers/google-workspace.test.ts:478-557`

**Step 1: Replace the entire `buildEstimationRows()` describe block with new tests**

Replace lines 478-557 in `src/mcp-servers/google-workspace.test.ts` with:

```typescript
describe("buildEstimationRows()", () => {
  it("builds rows with per-item MD for a single area", () => {
    const rows = buildEstimationRows([
      {
        name: "Discovery",
        items: [
          { name: "Technical discovery", effort_hours: 40, assumptions: "Full-stack audit" },
          { name: "Architecture design", effort_hours: 24, assumptions: "Cloud-native approach" },
        ],
      },
    ]);

    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], ["Discovery", "Technical discovery", 5, "Full-stack audit"]);
    assert.deepEqual(rows[1], ["", "Architecture design", 3, "Cloud-native approach"]);
  });

  it("converts hours to man-days (÷8)", () => {
    const rows = buildEstimationRows([
      {
        name: "Dev",
        items: [{ name: "Build it", effort_hours: 200, assumptions: "" }],
      },
    ]);

    assert.equal(rows[0][2], 25);
  });

  it("rounds man-days to one decimal place", () => {
    const rows = buildEstimationRows([
      {
        name: "Dev",
        items: [{ name: "Build it", effort_hours: 100, assumptions: "" }],
      },
    ]);

    assert.equal(rows[0][2], 12.5);
  });

  it("writes MD on every row (not just first)", () => {
    const rows = buildEstimationRows([
      {
        name: "Development",
        items: [
          { name: "Core platform", effort_hours: 80, assumptions: "Next.js" },
          { name: "Integrations", effort_hours: 24, assumptions: "3 APIs" },
        ],
      },
    ]);

    assert.equal(rows.length, 2);
    assert.equal(rows[0][0], "Development");
    assert.equal(rows[0][2], 10);
    assert.equal(rows[1][0], "");
    assert.equal(rows[1][2], 3);
  });

  it("handles multiple areas", () => {
    const rows = buildEstimationRows([
      {
        name: "Discovery",
        items: [{ name: "Audit", effort_hours: 16, assumptions: "Existing codebase" }],
      },
      {
        name: "Development",
        items: [
          { name: "Core platform", effort_hours: 80, assumptions: "Next.js" },
          { name: "Integrations", effort_hours: 24, assumptions: "3 APIs" },
        ],
      },
    ]);

    assert.equal(rows.length, 3);
    assert.equal(rows[0][0], "Discovery");
    assert.equal(rows[0][2], 2);
    assert.equal(rows[1][0], "Development");
    assert.equal(rows[1][2], 10);
    assert.equal(rows[2][0], "");
    assert.equal(rows[2][2], 3);
  });

  it("handles item with zero hours", () => {
    const rows = buildEstimationRows([
      {
        name: "Optional",
        items: [{ name: "Nice to have", effort_hours: 0, assumptions: "" }],
      },
    ]);

    assert.equal(rows[0][2], 0);
  });
});
```

**Step 2: Run tests to confirm they fail**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: FAIL — `EstimationArea` still has area-level `effort_hours`, items don't have it.

**Step 3: Commit**

```bash
git add src/mcp-servers/google-workspace.test.ts
git commit -m "test(mandays): update buildEstimationRows tests for per-item MD schema"
```

---

### Task 2: Update `EstimationArea` interface and `buildEstimationRows`

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:1154-1178`

**Step 1: Replace the interface and function**

Replace lines 1154-1178 with:

```typescript
interface EstimationArea {
  name: string;
  items: Array<{ name: string; effort_hours: number; assumptions: string }>;
}

export function buildEstimationRows(areas: EstimationArea[]): (string | number)[][] {
  const rows: (string | number)[][] = [];

  for (const area of areas) {
    for (let i = 0; i < area.items.length; i++) {
      const item = area.items[i];
      const md = item.effort_hours / 8;
      const mdNum = Number.isInteger(md) ? md : Number(md.toFixed(1));
      rows.push([i === 0 ? area.name : "", item.name, mdNum, item.assumptions]);
    }
  }

  return rows;
}
```

**Step 2: Run tests to confirm they pass**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: PASS — all `buildEstimationRows` tests green.

**Step 3: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "feat(mandays): per-item effort_hours and MD conversion in buildEstimationRows"
```

---

### Task 3: Update `sheets_create_estimation` tool

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:1182-1313`

**Step 1: Update tool description (line 1184)**

Replace:
```typescript
  "Create an estimation spreadsheet from the template. Copies the template, clears example data, writes estimation breakdown by Major Area → Action Items. Effort is provided in hours and auto-converted to weeks.",
```
With:
```typescript
  "Create an estimation spreadsheet from the template. Copies the template, clears example data, writes estimation breakdown by Major Area → Action Items. Effort is provided in hours per item and auto-converted to man-days (÷8).",
```

**Step 2: Update input schema (lines 1188-1195)**

Replace:
```typescript
    areas: z.array(z.object({
      name: z.string().describe("Major Area name, e.g. 'Discovery & Architecture'"),
      effort_hours: z.number().describe("Total effort for this area in hours (converted to weeks ÷40)"),
      items: z.array(z.object({
        name: z.string().describe("Action item name"),
        assumptions: z.string().describe("Assumptions for this item"),
      })).min(1).describe("Action items within this Major Area (at least one required)"),
    })).min(1).describe("Estimation breakdown by Major Area (at least one required)"),
```
With:
```typescript
    areas: z.array(z.object({
      name: z.string().describe("Major Area name, e.g. 'Discovery & Architecture'"),
      items: z.array(z.object({
        name: z.string().describe("Action item name"),
        effort_hours: z.number().describe("Effort for this item in hours (auto-converted to man-days ÷8)"),
        assumptions: z.string().describe("Assumptions for this item"),
      })).min(1).describe("Action items within this Major Area (at least one required)"),
    })).min(1).describe("Estimation breakdown by Major Area (at least one required)"),
```

**Step 3: Add header row write after the clear step (after line 1253)**

Insert after the clear block (after `// 3. Clear all data cells` block ends):

```typescript
      // 4. Write header row at A1
      const headerRange = `${quotedTitleForClear}!A1:D1`;
      const headerRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(headerRange)}?valueInputOption=RAW`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ range: headerRange, values: [["Major Area", "Action items", "Effort (MD)", "Assumptions"]] }),
        },
      );
      if (!headerRes.ok) {
        const text = await headerRes.text();
        return { content: [{ type: "text" as const, text: `Write header error: ${text}` }] };
      }
```

**Step 4: Update total calculation (line 1257-1258)**

Replace:
```typescript
      const totalWeeks = areas.reduce((sum, a) => sum + a.effort_hours / 40, 0);
      const totalWeeksStr = Number.isInteger(totalWeeks) ? String(totalWeeks) : totalWeeks.toFixed(1);
```
With:
```typescript
      const totalHours = areas.reduce((sum, a) => a.items.reduce((s, item) => s + item.effort_hours, s), 0);
      const totalMD = totalHours / 8;
      const totalMDStr = Number.isInteger(totalMD) ? String(totalMD) : totalMD.toFixed(1);
```

**Step 5: Update step comment numbers (renumber after header write)**

- Change `// 4. Build data rows` → `// 5. Build data rows`
- Change `// 5. Write data rows` → `// 6. Write data rows`
- Change `// 6. Write summary rows` → `// 7. Write summary rows`

**Step 6: Update summary row labels (lines 1284-1287)**

Replace:
```typescript
      const summaryRows = [
        ["Total required (weeks)", "", sumFormula, ""],
        ["Total optional (weeks)", "", "0", ""],
        ["Total (weeks)", "", sumFormula, ""],
      ];
```
With:
```typescript
      const summaryRows = [
        ["Total required (MD)", "", sumFormula, ""],
        ["Total optional (MD)", "", "0", ""],
        ["Total (MD)", "", sumFormula, ""],
      ];
```

**Step 7: Update success message (line 1307)**

Replace:
```typescript
          text: `Estimation spreadsheet created!\nTitle: ${title}\nID: ${sheetId}\nURL: ${sheetUrl}\nTotal: ${totalWeeksStr} weeks (${areas.reduce((s, a) => s + a.effort_hours, 0)} hours)\nAreas: ${areas.length}, Action items: ${dataRows.length}`,
```
With:
```typescript
          text: `Estimation spreadsheet created!\nTitle: ${title}\nID: ${sheetId}\nURL: ${sheetUrl}\nTotal: ${totalMDStr} MD (${totalHours} hours)\nAreas: ${areas.length}, Action items: ${dataRows.length}`,
```

**Step 8: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "feat(mandays): update sheets_create_estimation for per-item MD schema"
```

---

### Task 4: Update orchestrator prompt

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Update Estimation Breakdown section (lines 219-224)**

Replace:
```
Estimation Breakdown:
Structure the estimation by Major Area → Action Items (matching the Sheet template).
Major Areas are project phases/modules. Each has a total effort in hours and 3-8 action items.
Example: "Core Platform | CMS setup & content models, Shared component library, Auth & SSO, ..."
Calculate the fixed price internally: total hours × blended rate + 10% PM overhead.
The estimation spreadsheet is internal — the Doc shows only the total fixed price.
```
With:
```
Estimation Breakdown:
Structure the estimation by Major Area → Action Items (matching the Sheet template).
Major Areas are project phases/modules, each with 3-8 action items.
Every action item has its own effort estimate in hours. The tool converts hours to man-days (÷8) automatically.
Example: "Core Platform | CMS setup & content models (80h), Shared component library (120h), Auth & SSO (40h), ..."
Calculate the fixed price internally: total hours × blended rate + 10% PM overhead.
The estimation spreadsheet is internal — the Doc shows only the total fixed price.
```

**Step 2: Update Step 4a instructions (lines 471-478)**

Replace:
```
1. Structure your estimation by Major Area → Action Items.
   Major Areas are high-level project phases/modules (e.g., "Discovery & Architecture",
   "Core Platform", "Integrations", "QA & Launch").
   Each Major Area should have 3-8 specific action items with brief assumptions.

2. Estimate effort in hours per Major Area using the ESTIMATION RULES rate card.
   Apply the AI productivity factor (30-40% reduction on development tasks).
   The tool converts hours → weeks automatically (÷40).
```
With:
```
1. Structure your estimation by Major Area → Action Items.
   Major Areas are high-level project phases/modules (e.g., "Discovery & Architecture",
   "Core Platform", "Integrations", "QA & Launch").
   Each Major Area should have 3-8 specific action items with brief assumptions.

2. Estimate effort in hours per action item using the ESTIMATION RULES rate card.
   Apply the AI productivity factor (30-40% reduction on development tasks).
   The tool converts hours → man-days automatically (÷8).
```

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(mandays): update orchestrator prompt for per-item hours and MD"
```

---

### Task 5: Type-check and run tests

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: If any failures, fix and re-run. Then commit any fixes.**

---

### Task 6: Self-review and lessons

**Step 1: Review all changed files against CLAUDE.md self-review checklist**

- **Error propagation**: No new catch blocks.
- **Prompt safety**: No new data interpolation in prompts (only static text changes).
- **Accounting**: `totalHours` sums `item.effort_hours` across all items in all areas — covers all paths.
- **Regex completeness**: No regex changes.

**Step 2: Update spec status**

In `.ai/specs/SPEC-026-mandays-per-item.md`, mark completed tasks with `[x]`.
In `.ai/specs/README.md`, change SPEC-026 status from "Planning" to "Implemented".

**Step 3: Check `.ai/lessons.md` for anything to add**

If the frozen-row + header-overwrite pattern caused issues, document it.

**Step 4: Final commit**

```bash
git add .ai/specs/SPEC-026-mandays-per-item.md .ai/specs/README.md
git commit -m "docs(mandays): mark SPEC-026 as implemented"
```
