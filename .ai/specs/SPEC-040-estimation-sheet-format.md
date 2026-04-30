# SPEC-040: Estimation Sheet Format — 9-Column Layout with Module Subtotals

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 4-column estimation sheet format with the correct 9-column format matching Blazity's internal template, add per-module subtotal rows, switch from hours to MD input with 0.25 granularity, and auto-calculate risk buffer from risk level.

**Architecture:** Rewrite the `sheets_create_estimation` MCP tool schema and row builder, update the orchestrator prompt to teach the agent the new columns, switch to the new template ID. All data writing stays RAW for security, subtotal formulas use USER_ENTERED.

**Tech Stack:** `src/mcp-servers/google-workspace.ts` (tool + helpers), `src/agents/orchestrator.ts` (prompt), tests.

**Status:** Implemented
**Date:** 2026-03-16
**Scope:** `src/mcp-servers/google-workspace.ts`, `src/agents/orchestrator.ts`, `src/mcp-servers/google-workspace.test.ts`

---

## Current vs Correct Format

**Current (4 columns):**
```
Major Area | Action items | Effort (MD) | Assumptions
```
- Input: `effort_hours`, tool converts ÷8, rounds to 0.5 MD
- Global summary at bottom (Total required/optional, Team size, Calendar days)
- No per-area subtotals

**Correct (9 columns):**
```
Module | Action items | Estimation (MD) | Estimation (Risk buffer) | Type | Optional? | Risk | Assumptions | Figma Link / Link to a page / Image
```
- Input: `effort_md` directly, 0.25 MD granularity
- Per-module subtotal rows (gray bg, bold, SUM formulas)
- Risk buffer auto-calculated: Low=1x, Medium=1.15x, High=1.3x
- Global summary rows kept at bottom
- Template: `1QIevGOH09XOXP223ZizZBt_gb2Wvx5Q7A7OYB11jS1w`

**Styling (from real template):**
- Header row: bg `#F3F3F3` (rgb 0.953), Montserrat 10pt bold, center-aligned
- Module name cells: Montserrat 10pt bold
- Subtotal rows: bg `#EFEFEF` (rgb 0.937), bold, SUM formulas in C and D
- Data cells: Montserrat 10pt, white bg
- Sheet name: "Technical estimation"

---

## Design

### A. New Tool Input Schema

```typescript
interface EstimationItem {
  name: string;          // "Code Repository & Next.js + TypeScript setup"
  effort_md: number;     // Man-days directly (0.25 granularity)
  type: string;          // "Frontend", "Backend", "Design", "QA", "DevOps"
  optional: boolean;     // true/false
  risk: "Low" | "Medium" | "High";
  assumptions: string;   // Notes, can be multiline
  figma_link: string;    // Optional reference URL (empty string if none)
}

interface EstimationArea {
  name: string;          // "Project Setup"
  items: EstimationItem[];
}
```

Tool parameters:
```typescript
{
  title: z.string(),
  parent_folder_id: z.string(),
  recommended_developers: z.number().int().min(1),
  areas: z.array(z.object({
    name: z.string(),
    items: z.array(z.object({
      name: z.string(),
      effort_md: z.number().min(0),
      type: z.string(),
      optional: z.boolean(),
      risk: z.enum(["Low", "Medium", "High"]),
      assumptions: z.string(),
      figma_link: z.string(),
    })).min(1),
  })).min(1),
}
```

### B. Risk Buffer Calculation

```typescript
function calculateRiskBuffer(baseMD: number, risk: "Low" | "Medium" | "High"): number {
  const multiplier = risk === "High" ? 1.3 : risk === "Medium" ? 1.15 : 1;
  return roundToQuarter(baseMD * multiplier);
}

function roundToQuarter(md: number): number {
  return Math.round(md * 4) / 4; // rounds to nearest 0.25
}
```

### C. Row Builder Output

`buildEstimationRows()` now returns 9-column rows + subtotal rows:

For each area:
1. **Item rows:** `[moduleName|"", itemName, effortMD, riskBufferMD, type, optional, risk, assumptions, figmaLink]`
2. **Subtotal row:** `["", "", "=SUM(C{first}:C{last})", "=SUM(D{first}:D{last})", "", "", "", "", ""]`

Module name appears on first item only (empty string on rest).
Subtotal rows are tracked separately so they can be written with USER_ENTERED (for formulas) while data rows use RAW (for security).

### D. Sheet Writing Strategy

Since subtotal rows contain SUM formulas mixed with data rows, we need a two-pass write:

1. **Write all data rows** (RAW mode) — prevents formula injection
2. **Write subtotal rows** (USER_ENTERED mode) — evaluates SUM formulas
3. **Write global summary rows** (USER_ENTERED mode) — as before but spanning 9 columns

Subtotal row positions are tracked during `buildEstimationRows()` as a separate return value.

### E. Formatting via batchUpdate

After writing data, apply formatting:
- **Subtotal rows:** Set bg `#EFEFEF`, bold, via `repeatCell` requests
- **Module name cells (col A):** Set bold via `repeatCell` requests
- **Header row:** Already styled in template — no action needed

### F. Global Summary Rows

Keep the 5 summary rows but expand to 9 columns:
```
Total required (MD) | "" | =SUM(subtotalCells) | =SUM(riskSubtotalCells) | "" | "" | "" | "" | ""
Total optional (MD) | "" | =SUMPRODUCT formula  | =SUMPRODUCT formula     | "" | "" | "" | "" | ""
Total (MD)          | "" | =required+optional   | =risk required+optional | "" | "" | "" | "" | ""
Recommended team    | "" | N                    | Senior Engineers        | "" | "" | "" | "" | ""
Calendar days (est) | "" | calculated           | Based on total MD ÷ team + 15% buffer | "" | "" | "" | "" | ""
```

"Total optional" now uses `SUMPRODUCT` referencing the Optional? column (F) to sum only optional items.

### G. Calendar Days Calculation

Replace the old parallel/sequential calculation with the simpler formula already used in the orchestrator prompt:
```
calendarDays = Math.ceil((totalMD / recommendedDevs) * 1.15)
```
This matches `total MD ÷ team size + 15% buffer`.

### H. Orchestrator Prompt Changes

**Estimation Breakdown section (lines 262-268):**
- Change "hours" references to "man-days"
- Remove "The tool converts hours to man-days (÷8) automatically"
- Add: "For each item, specify: effort_md, type (Frontend/Backend/Design/QA/DevOps), optional (true/false), risk (Low/Medium/High), assumptions, and figma_link (URL or empty string)"
- Example: `"Core Platform | CMS setup & content models (3 MD, Frontend, Low risk), ..."`

**Step 4a (lines 613-634):**
- Change "Estimate effort in hours" to "Estimate effort in man-days"
- Remove "The tool converts hours → man-days automatically (÷8)"
- Remove parallel flag instructions
- Add new column instructions

**Minimum granularity rule (line 287):**
- Change "0.5 MD steps" to "0.25 MD steps. Use: 0.25, 0.5, 0.75, 1, 1.25, etc."

**Template ID:**
- Update `GSHEETS_TEMPLATE_ID` in `.env.example` documentation

### I. Test Changes

Update `buildEstimationRows` tests:
- New input shape (effort_md instead of effort_hours, add type/optional/risk/figma_link)
- New output shape (9 columns instead of 4)
- Add subtotal row tests
- Add risk buffer calculation tests
- Update rounding tests (0.25 granularity instead of 0.5)

Update `calculateCalendarDays` tests:
- Simplified calculation (total MD ÷ devs × 1.15)
- Remove parallel/sequential tests

---

## Plan

### Task 1: Update types and helpers

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts` (lines 1152-1190)

**Step 1: Write failing tests for new helpers**

In `src/mcp-servers/google-workspace.test.ts`, replace the `buildEstimationRows()` describe block with tests for the new format:

```typescript
describe("buildEstimationRows()", () => {
  it("builds 9-column rows with module subtotals for a single area", () => {
    const { dataRows, subtotalPositions } = buildEstimationRows([
      {
        name: "Project Setup",
        items: [
          { name: "Next.js setup", effort_md: 1, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "Boilerplate", figma_link: "" },
          { name: "CI/CD", effort_md: 0.5, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
        ],
      },
    ]);
    assert.equal(dataRows.length, 2);
    assert.deepEqual(dataRows[0], ["Project Setup", "Next.js setup", 1, 1, "Frontend", false, "Low", "Boilerplate", ""]);
    assert.deepEqual(dataRows[1], ["", "CI/CD", 0.5, 0.5, "Frontend", false, "Low", "", ""]);
    assert.equal(subtotalPositions.length, 1);
    // Subtotal at sheet row 4 (1 header + 2 data + 1 subtotal = row index 4, 1-based)
    assert.equal(subtotalPositions[0].sheetRow, 4);
    assert.equal(subtotalPositions[0].firstDataRow, 2);
    assert.equal(subtotalPositions[0].lastDataRow, 3);
  });

  it("auto-calculates risk buffer from risk level", () => {
    const { dataRows } = buildEstimationRows([
      {
        name: "Dev",
        items: [
          { name: "Simple", effort_md: 2, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
          { name: "Risky", effort_md: 4, type: "Backend", optional: false, risk: "Medium" as const, assumptions: "", figma_link: "" },
          { name: "Very risky", effort_md: 4, type: "Backend", optional: false, risk: "High" as const, assumptions: "", figma_link: "" },
        ],
      },
    ]);
    assert.equal(dataRows[0][3], 2);     // Low: 2 × 1.0 = 2
    assert.equal(dataRows[1][3], 4.75);   // Medium: 4 × 1.15 = 4.6 → round to 4.75 (nearest 0.25)
    assert.equal(dataRows[2][3], 5.25);   // High: 4 × 1.3 = 5.2 → round to 5.25 (nearest 0.25)
  });

  it("rounds effort to nearest 0.25", () => {
    const { dataRows } = buildEstimationRows([
      {
        name: "Dev",
        items: [
          { name: "Task", effort_md: 0.3, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
        ],
      },
    ]);
    assert.equal(dataRows[0][2], 0.25); // 0.3 rounds to 0.25
    assert.equal(dataRows[0][3], 0.25); // Low risk: same as base
  });

  it("handles multiple areas with correct subtotal positions", () => {
    const { dataRows, subtotalPositions } = buildEstimationRows([
      {
        name: "Setup",
        items: [
          { name: "Init", effort_md: 1, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
        ],
      },
      {
        name: "Dev",
        items: [
          { name: "Build", effort_md: 10, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
          { name: "Test", effort_md: 2, type: "QA", optional: true, risk: "Low" as const, assumptions: "", figma_link: "" },
        ],
      },
    ]);
    assert.equal(dataRows.length, 3);
    assert.equal(subtotalPositions.length, 2);
    // Area 1: 1 item → subtotal at row 3 (header=1, item=2, subtotal=3)
    assert.equal(subtotalPositions[0].sheetRow, 3);
    // Area 2: 2 items → subtotal at row 6 (prev subtotal=3, items=4,5, subtotal=6)
    assert.equal(subtotalPositions[1].sheetRow, 6);
  });
});
```

Also replace `calculateCalendarDays()` tests:

```typescript
describe("calculateCalendarDays()", () => {
  it("calculates total MD ÷ devs with 15% buffer", () => {
    const days = calculateCalendarDays(30, 2);
    // 30 / 2 * 1.15 = 17.25 → ceil = 18
    assert.equal(days, 18);
  });

  it("rounds up to whole days", () => {
    const days = calculateCalendarDays(10, 3);
    // 10 / 3 * 1.15 = 3.83 → ceil = 4
    assert.equal(days, 4);
  });

  it("handles single developer", () => {
    const days = calculateCalendarDays(20, 1);
    // 20 / 1 * 1.15 = 23 → ceil = 23
    assert.equal(days, 23);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL (old function signatures don't match)

**Step 3: Update interface and helper functions**

Replace `EstimationArea` interface and helpers (lines 1156-1190):

```typescript
interface EstimationItem {
  name: string;
  effort_md: number;
  type: string;
  optional: boolean;
  risk: "Low" | "Medium" | "High";
  assumptions: string;
  figma_link: string;
}

interface EstimationArea {
  name: string;
  items: EstimationItem[];
}

interface SubtotalPosition {
  sheetRow: number;       // 1-based row in the sheet
  firstDataRow: number;   // 1-based first data row for this module
  lastDataRow: number;    // 1-based last data row for this module
}

function roundToQuarter(md: number): number {
  return Math.round(md * 4) / 4;
}

function calculateRiskBuffer(baseMD: number, risk: "Low" | "Medium" | "High"): number {
  const multiplier = risk === "High" ? 1.3 : risk === "Medium" ? 1.15 : 1;
  return roundToQuarter(baseMD * multiplier);
}

export function buildEstimationRows(areas: EstimationArea[]): {
  dataRows: (string | number | boolean)[][];
  subtotalPositions: SubtotalPosition[];
} {
  const dataRows: (string | number | boolean)[][] = [];
  const subtotalPositions: SubtotalPosition[] = [];
  let currentSheetRow = 2; // 1-based, starts after header

  for (const area of areas) {
    const firstDataRow = currentSheetRow;

    for (let i = 0; i < area.items.length; i++) {
      const item = area.items[i];
      const md = roundToQuarter(item.effort_md);
      const riskBuffer = calculateRiskBuffer(md, item.risk);
      dataRows.push([
        i === 0 ? area.name : "",
        item.name,
        md,
        riskBuffer,
        item.type,
        item.optional,
        item.risk,
        item.assumptions,
        item.figma_link,
      ]);
      currentSheetRow++;
    }

    const lastDataRow = currentSheetRow - 1;
    subtotalPositions.push({ sheetRow: currentSheetRow, firstDataRow, lastDataRow });
    currentSheetRow++; // subtotal row takes one row
  }

  return { dataRows, subtotalPositions };
}

export function calculateCalendarDays(totalMD: number, recommendedDevs: number): number {
  return Math.ceil((totalMD / recommendedDevs) * 1.15);
}
```

**Step 4: Run tests**

Run: `npm test`
Expected: PASS

**Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: may fail due to tool code still using old interface — that's OK, fixed in Task 2

**Step 6: Commit**

```bash
git add src/mcp-servers/google-workspace.ts src/mcp-servers/google-workspace.test.ts
git commit -m "feat(sheet-format): rewrite estimation helpers for 9-column format"
```

---

### Task 2: Rewrite the sheets_create_estimation tool

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts` (lines 1192-1391)

**Step 1: Replace the tool registration and implementation**

Replace the entire `server.tool("sheets_create_estimation", ...)` block with the new version that:

1. Uses new Zod schema (effort_md, type, optional, risk, figma_link — no effort_hours, no parallel)
2. Updates header row to 9 columns: `["Module", "Action items", "Estimation (MD)", "Estimation (Risk buffer)", "Type", "Optional?", "Risk", "Assumptions", "Figma Link / Link to a page / Image"]`
3. Writes data rows (RAW, range A2:I{lastDataRow})
4. Writes subtotal rows (USER_ENTERED, one at a time for each subtotal position)
5. Applies formatting via batchUpdate:
   - Subtotal rows: bg #EFEFEF, bold
   - Module name cells (col A where non-empty): bold
6. Writes global summary rows (USER_ENTERED)
7. Uses new `calculateCalendarDays(totalMD, recommended_developers)`

Key code for subtotal row writes:
```typescript
// Write subtotal rows one at a time (USER_ENTERED for SUM formulas)
for (const sub of subtotalPositions) {
  const subtotalRange = `${quotedTitle}!A${sub.sheetRow}:I${sub.sheetRow}`;
  const subtotalValues = [
    ["", "", `=SUM(C${sub.firstDataRow}:C${sub.lastDataRow})`,
     `=SUM(D${sub.firstDataRow}:D${sub.lastDataRow})`,
     "", "", "", "", ""]
  ];
  // ... fetch PUT with USER_ENTERED
}
```

Key code for formatting:
```typescript
// Format subtotal rows: bg #EFEFEF, bold
const formatRequests = subtotalPositions.map((sub) => ({
  repeatCell: {
    range: { sheetId: gid, startRowIndex: sub.sheetRow - 1, endRowIndex: sub.sheetRow, startColumnIndex: 0, endColumnIndex: 9 },
    cell: {
      userEnteredFormat: {
        backgroundColor: { red: 0.937, green: 0.937, blue: 0.937 },
        textFormat: { bold: true, fontFamily: "Montserrat", fontSize: 10 },
      },
    },
    fields: "userEnteredFormat(backgroundColor,textFormat)",
  },
}));

// Format module name cells: bold
const moduleRows = dataRows.reduce<number[]>((acc, row, i) => {
  if (row[0] !== "") acc.push(i + 2); // 1-based, offset by header
  return acc;
}, []);
const moduleBoldRequests = moduleRows.map((row) => ({
  repeatCell: {
    range: { sheetId: gid, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: 1 },
    cell: { userEnteredFormat: { textFormat: { bold: true, fontFamily: "Montserrat", fontSize: 10 } } },
    fields: "userEnteredFormat(textFormat)",
  },
}));
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit

**Step 3: Run tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "feat(sheet-format): rewrite sheets_create_estimation for 9-column layout"
```

---

### Task 3: Update orchestrator prompt

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Update Estimation Breakdown section (lines 262-268)**

Replace:
```
Estimation Breakdown:
Structure the estimation by Major Area → Action Items (matching the Sheet template).
Major Areas are project phases/modules. Items per area depend on your complexity tier (see Project Complexity Classification).
Every action item has its own effort estimate in hours. The tool converts hours to man-days (÷8) automatically.
Example: "Core Platform | CMS setup & content models (80h), Shared component library (120h), Auth & SSO (40h), ..."
Calculate the fixed price internally: total hours × blended rate + 10% PM overhead.
The estimation spreadsheet is internal — the Doc shows only the total fixed price.
```

With:
```
Estimation Breakdown:
Structure the estimation by Module → Action Items (matching the Sheet template).
Modules are project phases or functional areas. Items per module depend on your complexity tier (see Project Complexity Classification).
Every action item has its own effort estimate in man-days (MD).
For each item, also specify:
- type: "Frontend", "Backend", "Design", "QA", or "DevOps"
- optional: true if the item is a nice-to-have, false if required
- risk: "Low", "Medium", or "High" — affects the risk buffer column automatically
- assumptions: notes about what's assumed for this estimate
- figma_link: URL to relevant Figma frame/page, or empty string if none
Example: "Core Platform | CMS setup & content models (3 MD, Frontend, Low), Component library (5 MD, Frontend, Medium, ~15 components from Figma), ..."
Calculate the fixed price internally: total MD × 8 × blended rate + 10% PM overhead.
The estimation spreadsheet is internal — the Doc shows only the total fixed price.
```

**Step 2: Update minimum granularity rule (line 287)**

Replace:
```
3. MINIMUM GRANULARITY: Estimate in 0.5 MD steps minimum. Never use values like 0.6, 1.3, 2.7.
   Use: 0.5, 1, 1.5, 2, 2.5, etc. The tool rounds to nearest 0.5 automatically.
```

With:
```
3. MINIMUM GRANULARITY: Estimate in 0.25 MD steps minimum. Never use values like 0.3, 1.1, 2.6.
   Use: 0.25, 0.5, 0.75, 1, 1.25, 1.5, etc. The tool rounds to nearest 0.25 automatically.
```

**Step 3: Update Step 4a (lines 613-634)**

Replace:
```
## Step 4a: Create Estimation Breakdown

Before creating the offer document, build the detailed estimation spreadsheet:

1. Structure your estimation by Major Area → Action Items per the ESTIMATION RULES complexity
   tier guardrails above. Each action item should have brief assumptions.

2. Estimate effort in hours per action item per the ESTIMATION RULES rate card and AI factor.
   The tool converts hours → man-days automatically (÷8).
   Estimate effort without deadline constraints — timeline is derived after.

   For each item, set parallel: true if it can run concurrently with other items in the same area
   (e.g., independent feature development), or false if it must wait for other items to finish
   (e.g., discovery before dev, integration testing after features).

3. Determine the recommended number of senior engineers based on Team Sizing rules for your tier.

4. Call sheets_create_estimation:
   - title: "Estimation - [Client] - [Date]"
   - parent_folder_id: ${job.outputFolderId ?? "root"}
   - recommended_developers: your recommended senior engineer count
   - areas: your structured estimation breakdown (with parallel flags)
```

With:
```
## Step 4a: Create Estimation Breakdown

Before creating the offer document, build the detailed estimation spreadsheet:

1. Structure your estimation by Module → Action Items per the ESTIMATION RULES complexity
   tier guardrails above.

2. Estimate effort in man-days (MD) per action item per the ESTIMATION RULES rate card and AI factor.
   Estimate effort without deadline constraints — timeline is derived after.
   For each item also specify: type, optional, risk level, assumptions, and figma_link.

3. Determine the recommended number of senior engineers based on Team Sizing rules for your tier.

4. Call sheets_create_estimation:
   - title: "Estimation - [Client] - [Date]"
   - parent_folder_id: ${job.estimationFolderId ?? job.outputFolderId ?? "root"}
   - recommended_developers: your recommended senior engineer count
   - areas: your structured estimation breakdown with all item fields
```

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit

**Step 5: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(sheet-format): update orchestrator prompt for 9-column estimation"
```

---

### Task 4: Update .env.example and docs

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`

**Step 1: Update GSHEETS_TEMPLATE_ID comment in .env.example**

Add a note that the template ID should point to the 9-column format template.

**Step 2: Update CLAUDE.md**

Change `GSHEETS_TEMPLATE_ID` description:
```
- `GSHEETS_TEMPLATE_ID` is the estimation template spreadsheet ID. Template format: Module | Action items | Estimation (MD) | Estimation (Risk buffer) | Type | Optional? | Risk | Assumptions | Figma Link.
```

**Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "feat(sheet-format): update template ID docs for 9-column format"
```

---

### Task 5: Final verification

**Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit

**Step 2: Run all tests**

Run: `npm test`
Expected: all pass

**Step 3: Self-review greps**

```bash
# Old schema references should be gone
grep -c "effort_hours" src/mcp-servers/google-workspace.ts
# Expected: 0

grep -c "parallel" src/mcp-servers/google-workspace.ts
# Expected: 0

# New schema present
grep -c "effort_md" src/mcp-servers/google-workspace.ts
# Expected: multiple

grep -c "risk_buffer\|Risk buffer\|calculateRiskBuffer" src/mcp-servers/google-workspace.ts
# Expected: multiple

grep -c "roundToQuarter" src/mcp-servers/google-workspace.ts
# Expected: multiple

# Orchestrator updated
grep -c "man-days (MD)" src/agents/orchestrator.ts
# Expected: at least 1

grep -c "0.25 MD steps" src/agents/orchestrator.ts
# Expected: 1
```

**Step 4: Update SPEC-040 status to Implemented**

**Step 5: Update `.ai/specs/README.md`**

**Step 6: Push and create PR**

```bash
git push -u origin feat/sheet-format
gh pr create --title "feat: 9-column estimation sheet format with module subtotals" --body "..."
```
