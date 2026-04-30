# SPEC-030: Simplified Roles + Team Size & Calendar Days

**Status**: Implemented
**Date**: 2026-03-11

## Problem

1. Rate card has 5 roles including separate Architect and Senior Dev — too granular. Should be one "Senior Engineer" role at 85 EUR/h.
2. Estimation sheet has no visibility into recommended team size or calendar duration.
3. No mechanism for the agent to express task parallelism (which items can run concurrently).

## Design

### Part 1: Simplified Rate Card
- Remove Architect (120) and Mid Developer (75)
- Keep: Senior Engineer (85), Designer (80), QA (40)
- Update Team Sizing to reference Senior Engineers

### Part 2: Per-item parallel flag
- Add `parallel: boolean` to item schema
- Agent marks items that can run concurrently within their area

### Part 3: New summary rows + calculateCalendarDays helper
- Add `recommended_developers: number` input param to tool
- New `calculateCalendarDays(areas, devs)` function:
  - Per area: sequential items run one after another, parallel items run concurrently (calendar = max of parallel items)
  - Total calendar MD = sum of area calendar MDs
  - Calendar days = totalCalendarMD / recommended_developers (ceil)
- Two new summary rows: "Recommended team size" and "Calendar days (estimated)"

## Files Changed

| File | Change |
|------|--------|
| `src/agents/orchestrator.ts` | Simplified rate card, team sizing, Step 4a parallel + recommended_developers guidance |
| `src/mcp-servers/google-workspace.ts` | `parallel` in item schema, `recommended_developers` input, `calculateCalendarDays` helper, new summary rows, updated `EstimationArea` interface |
| `src/mcp-servers/google-workspace.test.ts` | Tests for `calculateCalendarDays`, updated `buildEstimationRows` tests for `parallel` field |

## Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the rate card to one engineering role, add per-item parallelism flag, and show recommended team size + calendar days in the sheet.

**Architecture:** Three changes: (1) prompt text edits for simplified roles, (2) schema + helper function for parallelism and calendar calculation, (3) new summary rows in the sheet tool. TDD for the new `calculateCalendarDays` helper.

**Tech Stack:** TypeScript, Google Sheets API v4, Node test runner, zod

---

### Task 1: Write tests for calculateCalendarDays (TDD)

**Files:**
- Modify: `src/mcp-servers/google-workspace.test.ts`

**Step 1: Add import for calculateCalendarDays**

Find the import block (~line 15-23):

```typescript
const {
  parseFormattedText,
  buildChartSheetData,
  groupSections,
  buildSimpleBatch,
  buildTableFillRequests,
  extractCellPositions,
  buildEstimationRows,
} = await import("./google-workspace.js");
```

Replace with:

```typescript
const {
  parseFormattedText,
  buildChartSheetData,
  groupSections,
  buildSimpleBatch,
  buildTableFillRequests,
  extractCellPositions,
  buildEstimationRows,
  calculateCalendarDays,
} = await import("./google-workspace.js");
```

**Step 2: Add calculateCalendarDays test block after the buildEstimationRows tests (after line 569)**

```typescript
// ── calculateCalendarDays ───────────────────────────────────────────────────

describe("calculateCalendarDays()", () => {
  it("sequential items sum their MD", () => {
    const days = calculateCalendarDays([
      {
        name: "Discovery",
        items: [
          { name: "Kickoff", effort_hours: 8, parallel: false, assumptions: "" },
          { name: "Audit", effort_hours: 16, parallel: false, assumptions: "" },
        ],
      },
    ], 1);

    // 8h=1MD + 16h=2MD = 3 calendar MD, 1 dev → 3 days
    assert.equal(days, 3);
  });

  it("parallel items take the max duration", () => {
    const days = calculateCalendarDays([
      {
        name: "Development",
        items: [
          { name: "Component A", effort_hours: 40, parallel: true, assumptions: "" },
          { name: "Component B", effort_hours: 24, parallel: true, assumptions: "" },
          { name: "Component C", effort_hours: 16, parallel: true, assumptions: "" },
        ],
      },
    ], 1);

    // All parallel → max(40/8, 24/8, 16/8) = max(5, 3, 2) = 5 calendar MD
    assert.equal(days, 5);
  });

  it("mixes sequential and parallel items", () => {
    const days = calculateCalendarDays([
      {
        name: "Dev",
        items: [
          { name: "Setup", effort_hours: 8, parallel: false, assumptions: "" },
          { name: "Feature A", effort_hours: 40, parallel: true, assumptions: "" },
          { name: "Feature B", effort_hours: 24, parallel: true, assumptions: "" },
          { name: "Integration", effort_hours: 16, parallel: false, assumptions: "" },
        ],
      },
    ], 1);

    // Sequential: 8/8 + 16/8 = 1 + 2 = 3 MD
    // Parallel: max(40/8, 24/8) = 5 MD
    // Total calendar MD: 3 + 5 = 8, 1 dev → 8 days
    assert.equal(days, 8);
  });

  it("divides by team size", () => {
    const days = calculateCalendarDays([
      {
        name: "Dev",
        items: [
          { name: "Feature A", effort_hours: 80, parallel: true, assumptions: "" },
          { name: "Feature B", effort_hours: 80, parallel: true, assumptions: "" },
        ],
      },
    ], 2);

    // Parallel: max(80/8, 80/8) = 10 calendar MD
    // 2 devs → ceil(10 / 2) = 5 days
    assert.equal(days, 5);
  });

  it("sums across multiple areas (areas are sequential)", () => {
    const days = calculateCalendarDays([
      {
        name: "Discovery",
        items: [
          { name: "Kickoff", effort_hours: 8, parallel: false, assumptions: "" },
        ],
      },
      {
        name: "Development",
        items: [
          { name: "Build", effort_hours: 40, parallel: true, assumptions: "" },
          { name: "Test", effort_hours: 24, parallel: true, assumptions: "" },
        ],
      },
    ], 1);

    // Discovery: 1 MD (sequential)
    // Development: max(5, 3) = 5 MD (parallel)
    // Total: 6 calendar MD, 1 dev → 6 days
    assert.equal(days, 6);
  });

  it("rounds up to whole days", () => {
    const days = calculateCalendarDays([
      {
        name: "Dev",
        items: [
          { name: "Task", effort_hours: 12, parallel: false, assumptions: "" },
        ],
      },
    ], 2);

    // 12/8 = 1.5 calendar MD, 2 devs → ceil(1.5/2) = ceil(0.75) = 1 day
    assert.equal(days, 1);
  });
});
```

**Step 3: Run tests to confirm they fail**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: FAIL — `calculateCalendarDays` is not exported.

**Step 4: Commit**

```bash
git add src/mcp-servers/google-workspace.test.ts
git commit -m "test(team-calendar): add calculateCalendarDays tests"
```

---

### Task 2: Update EstimationArea interface and add calculateCalendarDays

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:1154-1172`

**Step 1: Update the interface to include parallel flag**

Find (~line 1154-1157):

```typescript
interface EstimationArea {
  name: string;
  items: Array<{ name: string; effort_hours: number; assumptions: string }>;
}
```

Replace with:

```typescript
interface EstimationArea {
  name: string;
  items: Array<{ name: string; effort_hours: number; parallel: boolean; assumptions: string }>;
}
```

**Step 2: Add calculateCalendarDays after buildEstimationRows (after line 1172)**

Insert after the closing `}` of `buildEstimationRows`:

```typescript

export function calculateCalendarDays(areas: EstimationArea[], recommendedDevs: number): number {
  let totalCalendarMD = 0;

  for (const area of areas) {
    const sequential = area.items.filter((i) => !i.parallel);
    const parallel = area.items.filter((i) => i.parallel);
    const sequentialMD = sequential.reduce((s, i) => s + i.effort_hours / 8, 0);
    const maxParallelMD = parallel.length > 0
      ? Math.max(...parallel.map((i) => i.effort_hours / 8))
      : 0;
    totalCalendarMD += sequentialMD + maxParallelMD;
  }

  return Math.ceil(totalCalendarMD / recommendedDevs);
}
```

**Step 3: Run tests**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: PASS — all calculateCalendarDays tests green.

**Step 4: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "feat(team-calendar): add parallel flag to EstimationArea and calculateCalendarDays helper"
```

---

### Task 3: Update buildEstimationRows tests for new parallel field

**Files:**
- Modify: `src/mcp-servers/google-workspace.test.ts:478-568`

**Step 1: Add `parallel: false` to all existing test items**

In every test within the `buildEstimationRows()` describe block, add `parallel: false` to each item object. For example, the first test becomes:

```typescript
  it("builds rows with per-item MD for a single area", () => {
    const rows = buildEstimationRows([
      {
        name: "Discovery",
        items: [
          { name: "Technical discovery", effort_hours: 40, parallel: false, assumptions: "Full-stack audit" },
          { name: "Architecture design", effort_hours: 24, parallel: false, assumptions: "Cloud-native approach" },
        ],
      },
    ]);

    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], ["Discovery", "Technical discovery", 5, "Full-stack audit"]);
    assert.deepEqual(rows[1], ["", "Architecture design", 3, "Cloud-native approach"]);
  });
```

Apply the same change to ALL items in ALL tests in the `buildEstimationRows()` block:
- "converts hours to man-days" test: add `parallel: false`
- "rounds man-days to one decimal place" test: add `parallel: false`
- "writes MD on every row" test: add `parallel: false` to both items
- "handles multiple areas" test: add `parallel: false` to all 3 items
- "handles item with zero hours" test: add `parallel: false`

**Step 2: Run tests**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: PASS — all tests green.

**Step 3: Commit**

```bash
git add src/mcp-servers/google-workspace.test.ts
git commit -m "test(team-calendar): update buildEstimationRows tests for parallel field"
```

---

### Task 4: Update sheets_create_estimation tool schema and summary rows

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:1177-1345`

**Step 1: Update tool description (line 1178)**

Find:

```typescript
  "Create an estimation spreadsheet from the template. Copies the template, clears example data, writes estimation breakdown by Major Area → Action Items. Effort is provided in hours per item and auto-converted to man-days (÷8).",
```

Replace with:

```typescript
  "Create an estimation spreadsheet from the template. Copies the template, clears example data, writes estimation breakdown by Major Area → Action Items. Effort is provided in hours per item and auto-converted to man-days (÷8). Includes recommended team size and estimated calendar days.",
```

**Step 2: Add `parallel` to item schema and `recommended_developers` to top-level (lines 1179-1190)**

Find:

```typescript
  {
    title: z.string().describe("Spreadsheet title, e.g. 'Estimation - Client - 2026-03-06'"),
    parent_folder_id: z.string().describe("Google Drive folder ID to place the spreadsheet in"),
    areas: z.array(z.object({
      name: z.string().describe("Major Area name, e.g. 'Discovery & Architecture'"),
      items: z.array(z.object({
        name: z.string().describe("Action item name"),
        effort_hours: z.number().describe("Effort for this item in hours (auto-converted to man-days ÷8)"),
        assumptions: z.string().describe("Assumptions for this item"),
      })).min(1).describe("Action items within this Major Area (at least one required)"),
    })).min(1).describe("Estimation breakdown by Major Area (at least one required)"),
  },
```

Replace with:

```typescript
  {
    title: z.string().describe("Spreadsheet title, e.g. 'Estimation - Client - 2026-03-06'"),
    parent_folder_id: z.string().describe("Google Drive folder ID to place the spreadsheet in"),
    recommended_developers: z.number().int().min(1).describe("Recommended number of senior engineers for this project"),
    areas: z.array(z.object({
      name: z.string().describe("Major Area name, e.g. 'Discovery & Architecture'"),
      items: z.array(z.object({
        name: z.string().describe("Action item name"),
        effort_hours: z.number().describe("Effort for this item in hours (auto-converted to man-days ÷8)"),
        parallel: z.boolean().describe("true if this item can run concurrently with other parallel items in its area"),
        assumptions: z.string().describe("Assumptions for this item"),
      })).min(1).describe("Action items within this Major Area (at least one required)"),
    })).min(1).describe("Estimation breakdown by Major Area (at least one required)"),
  },
```

**Step 3: Update the handler destructuring (line 1191)**

Find:

```typescript
  async ({ title, parent_folder_id, areas }) => {
```

Replace with:

```typescript
  async ({ title, parent_folder_id, recommended_developers, areas }) => {
```

**Step 4: Update summary rows to include team size and calendar days (lines 1315-1319)**

Find:

```typescript
      const summaryRows = [
        ["Total required (MD)", "", sumFormula, ""],
        ["Total optional (MD)", "", "0", ""],
        ["Total (MD)", "", sumFormula, ""],
      ];
```

Replace with:

```typescript
      const calendarDays = calculateCalendarDays(areas, recommended_developers);
      const summaryRows = [
        ["Total required (MD)", "", sumFormula, ""],
        ["Total optional (MD)", "", "0", ""],
        ["Total (MD)", "", sumFormula, ""],
        ["Recommended team size", "", recommended_developers, "Senior Engineers"],
        ["Calendar days (estimated)", "", calendarDays, "Based on task parallelism and team size"],
      ];
```

**Step 5: Update summary range to accommodate 5 rows instead of 3 (line 1320)**

Find:

```typescript
      const summaryRange = `${quotedTitle}!A${summaryStartRow}:D${summaryStartRow + 2}`;
```

Replace with:

```typescript
      const summaryRange = `${quotedTitle}!A${summaryStartRow}:D${summaryStartRow + 4}`;
```

**Step 6: Update success message to include team and calendar info (line 1338)**

Find:

```typescript
          text: `Estimation spreadsheet created!\nTitle: ${title}\nID: ${sheetId}\nURL: ${sheetUrl}\nTotal: ${totalMDStr} MD (${totalHours} hours)\nAreas: ${areas.length}, Action items: ${dataRows.length}`,
```

Replace with:

```typescript
          text: `Estimation spreadsheet created!\nTitle: ${title}\nID: ${sheetId}\nURL: ${sheetUrl}\nTotal: ${totalMDStr} MD (${totalHours} hours)\nAreas: ${areas.length}, Action items: ${dataRows.length}\nRecommended team: ${recommended_developers} senior engineers\nEstimated calendar days: ${calendarDays}`,
```

**Step 7: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "feat(team-calendar): add recommended_developers, parallel flag, and calendar day summary rows"
```

---

### Task 5: Simplify rate card and team sizing in orchestrator prompt

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Replace rate card (lines 205-211)**

Find:

```
Rate Card (EUR/h):
- Architect: 120
- Senior Developer: 85
- Mid Developer: 75
- Designer: 80
- QA (manual): 40
Add 10% PM overhead to the total (not a separate line item).
```

Replace with:

```
Rate Card (EUR/h):
- Senior Engineer: 85 (covers architecture + development)
- Designer: 80
- QA (manual): 40
Add 10% PM overhead to the total (not a separate line item).
```

**Step 2: Replace team sizing (lines 244-248)**

Find:

```
Team Sizing (AI-augmented):
- Simple (typically <100k EUR): 1 senior/architect + AI agent. Add 1 mid only if scope demands parallel workstreams.
- Medium (typically 100-200k EUR): 1 architect (part-time) + 1-2 seniors + 1 mid + designer.
- Complex (typically >200k EUR): 1 architect + 2-3 seniors + 1-2 mids + designer + QA.
- Never 2+ architects. Never staff "just in case."
```

Replace with:

```
Team Sizing (AI-augmented):
- Simple (typically <100k EUR): 1 senior engineer + AI agent.
- Medium (typically 100-200k EUR): 1-2 senior engineers + designer.
- Complex (typically >200k EUR): 2-3 senior engineers + designer + QA.
- Never staff "just in case." Only add roles the scope demands.
```

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(team-calendar): simplify rate card to Senior Engineer + Designer + QA"
```

---

### Task 6: Update Step 4a for parallel flag and recommended_developers

**Files:**
- Modify: `src/agents/orchestrator.ts` (Step 4a section)

**Step 1: Update Step 4a instructions**

Find the Step 4a block starting at "Before creating the offer document" (~line 479). Find points 1-3:

```
1. Structure your estimation by Major Area → Action Items.
   Major Areas are high-level project phases/modules (e.g., "Discovery & Architecture",
   "Core Platform", "Integrations", "QA & Launch").
   Follow the guardrails for your complexity tier (from Step 1):
   areas count, items per area, discovery effort, and which infrastructure items to include or skip.
   Do not exceed the tier's item counts without justification.

2. Estimate effort in hours per action item using the ESTIMATION RULES rate card.
   Apply the AI productivity factor (30-40% reduction on development tasks).
   The tool converts hours → man-days automatically (÷8).
   Do NOT factor the client's deadline into your hour estimates.
   Estimate each item's effort as if there were no deadline constraint.
   The timeline is derived AFTER estimation by dividing total effort by team capacity.

3. Call sheets_create_estimation:
   - title: "Estimation - [Client] - [Date]"
   - parent_folder_id: ${job.outputFolderId ?? "root"}
   - areas: your structured estimation breakdown
```

Replace with:

```
1. Structure your estimation by Major Area → Action Items.
   Major Areas are high-level project phases/modules (e.g., "Discovery & Architecture",
   "Core Platform", "Integrations", "QA & Launch").
   Follow the guardrails for your complexity tier (from Step 1):
   areas count, items per area, discovery effort, and which infrastructure items to include or skip.
   Do not exceed the tier's item counts without justification.

2. Estimate effort in hours per action item using the ESTIMATION RULES rate card.
   Apply the AI productivity factor (30-40% reduction on development tasks).
   The tool converts hours → man-days automatically (÷8).
   Do NOT factor the client's deadline into your hour estimates.
   Estimate each item's effort as if there were no deadline constraint.
   The timeline is derived AFTER estimation by dividing total effort by team capacity.

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

**Step 2: Renumber subsequent points (old 4 → 5, old 5 → 6)**

Find:

```
4. Note the total hours and total EUR (hours × blended rate from rate card)
   for use in the offer document's Investment Summary.

5. SANITY CHECK
```

Replace with:

```
5. Note the total hours and total EUR (hours × blended rate from rate card)
   for use in the offer document's Investment Summary.

6. SANITY CHECK
```

And the final Slack status post: renumber from old 6 to 7 (or whatever the next number is after the sanity check).

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(team-calendar): update Step 4a for parallel flags and recommended_developers"
```

---

### Task 7: Type-check, test, and finalize

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: If any failures, fix and re-run.**

**Step 4: Update spec and index**

Mark all tasks `[x]` in this spec. Set status to "Implemented".
In `.ai/specs/README.md`, update SPEC-030 status to "Implemented".

```bash
git add .ai/specs/SPEC-030-simplified-roles-team-calendar.md .ai/specs/README.md
git commit -m "docs(team-calendar): mark SPEC-030 as implemented"
```

---

- [x] Task 1: Write tests for calculateCalendarDays (TDD)
- [x] Task 2: Update EstimationArea interface and add calculateCalendarDays
- [x] Task 3: Update buildEstimationRows tests for new parallel field
- [x] Task 4: Update sheets_create_estimation tool schema and summary rows
- [x] Task 5: Simplify rate card and team sizing in orchestrator prompt
- [x] Task 6: Update Step 4a for parallel flag and recommended_developers
- [x] Task 7: Type-check, test, and finalize
