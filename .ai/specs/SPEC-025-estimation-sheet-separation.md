# SPEC-025: Estimation Sheet Separation & Fixed-Price Framing

**Status**: Implemented
**Date**: 2026-03-06

## Problem

The detailed budget breakdown (Feature | Role | Hours | Cost) currently lives inside the proposal Google Doc. This exposes internal pricing details to the client and uses a T&M framing. The team wants to:
1. Move the detailed estimation to a separate Google Sheet using a standard template
2. Present only a fixed-price summary in the proposal Doc
3. Reframe the VBP section as Fixed-Price vs Performance Partnership

## Goal

- Create a Google Sheet estimation (from template) in the Output folder alongside the Doc
- Doc shows only a summary investment paragraph with fixed total — no detailed table
- Agent estimates internally in hours (using rate card), converts to weeks for the Sheet
- VBP section reframed around fixed-price base

## Design

### 1. New MCP Tool: `sheets_create_estimation`

Added to `src/mcp-servers/google-workspace.ts`. Copies the estimation template, clears example data, writes structured estimation data.

**Template ID**: `GSHEETS_TEMPLATE_ID` env var (template: `11AVu9dfF-nc-yuQz_LSVeZwBw5CmslvwHTBtZvsVJ94`)

**Template format** (4 columns):
```
Major Area | Action items | Effort (weeks) | Assumptions
```

- Major Area name appears on the first row of each group
- Subsequent rows under the same Major Area have empty col A
- Effort is at the Major Area level (group total in weeks)
- Bottom rows: Total required / Total optional / Total (weeks)

**Input schema:**
```typescript
{
  title: string,              // "Estimation - [Client] - [Date]"
  parent_folder_id: string,   // Output folder ID
  areas: [{
    name: string,             // "Discovery & Architecture"
    effort_hours: number,     // 160 (agent estimates in hours internally)
    items: [{
      name: string,           // "Technical discovery & solution design"
      assumptions: string,    // "Technology stack, integrations..."
    }]
  }]
}
```

**Tool behavior:**
1. Copy template to Output folder with given title
2. Clear all data rows (keep header row 0)
3. Write rows: for each area, first row has `[area.name, items[0].name, effort_hours/40, items[0].assumptions]`, subsequent items have `["", item.name, "", item.assumptions]`
4. Add bottom summary rows: `Total required (weeks)` with SUM formula, `Total optional (weeks)`, `Total (weeks)` with SUM formula
5. Return: `{ sheetId, sheetUrl, totalWeeks }`

### 2. Orchestrator Prompt Changes

#### New Step 4a: Create Estimation Sheet (before Doc creation)

```
## Step 4a: Create Estimation Breakdown

Before creating the offer document, build the detailed estimation spreadsheet:

1. Structure your estimation by Major Area → Action Items.
   Major Areas are high-level project phases/modules (e.g., "Discovery & Architecture",
   "Core Platform", "Integrations", "QA & Launch").
   Each Major Area should have 3-8 specific action items with assumptions.

2. Estimate effort in hours per Major Area (using the rate card and estimation rules).
   The tool converts hours → weeks automatically (÷40).

3. Call sheets_create_estimation with your structured data.
   Title: "Estimation - [Client] - [Date]"
   Place it in the Output folder (folder ID: {outputFolderId}).

4. Note the total weeks and total EUR (hours × blended rate) for use in the offer document.
```

#### Modified Step 4 Budget Section

Remove the current detailed budget table (`Feature/Module | Role | Hours | Cost`).

Replace with:
```
- heading level 2: "Investment Summary" + paragraph:
  A concise paragraph (80-120 words) covering:
  1. Total estimated effort in weeks
  2. Total fixed-price investment in EUR
  3. What's included (all phases, QA, launch support)
  4. AI productivity note: "Estimate reflects AI-augmented development workflow"
  Do NOT mention T&M, hourly rates, or per-feature costs.
  Present as a fixed-price engagement.
  Do NOT include a detailed feature breakdown table — that lives in the estimation spreadsheet.
```

#### Reframed VBP Section

Replace "Alternative: Value-Based Partnership" with "Alternative: Performance Partnership".

Approach Comparison table changes from T&M vs VBP to:

| Dimension | Fixed-Price | Performance Partnership |
|---|---|---|
| Investment | €X fixed | Base €X + max bonus €Y (20% of base) |
| Risk Allocation | Blazity bears delivery risk | Shared — Blazity puts bonus at stake on outcomes |
| Incentive Alignment | Deliverables-focused | Both parties benefit from measurable results |
| Scope | Fixed scope, fixed price | Fixed scope + performance-linked upside |
| Expected ROI | N/A — priced on scope | [N]× projected return on first-year value |

All references to "T&M total" or "T&M approach" change to "fixed-price total" / "fixed-price approach".

Investment breakdown paragraph changes to:
- "**Fixed delivery fee: €X** — covers full project delivery including all phases, QA, and launch support."
- "**Performance bonus pool: €Y (20% of base)** — earned upon achievement of the success metrics below."

#### Slack Completion Message

Add Sheet URL to the final completion message:
```
*📊 Estimation:*\n<SHEET_URL|View Spreadsheet>
```

### 3. Orchestrator Config Changes

- Add `sheets_create_estimation` to `allowedTools` array
- Add `GSHEETS_TEMPLATE_ID` to `requiredEnv` check
- Pass `GSHEETS_TEMPLATE_ID` env var to the google-workspace MCP server

### 4. Environment Changes

- Add `GSHEETS_TEMPLATE_ID` to `.env.example`
- Document in `CLAUDE.md` rules

### 5. Estimation Quality Adjustments

The review checklist in the orchestrator prompt needs updates:
- Remove checks for budget table formatting (no longer in Doc)
- Remove rate card compliance check on Doc table (rates are internal)
- Add check: "Is the Investment Summary paragraph present with a fixed EUR amount?"
- Add check: "Does the Sheet contain the estimation breakdown?"
- Keep VBP math checks but update references from T&M to fixed-price

## Files Changed

| File | Change |
|---|---|
| `src/mcp-servers/google-workspace.ts` | Add `sheets_create_estimation` tool |
| `src/agents/orchestrator.ts` | Add Step 4a, modify budget section, reframe VBP, update review checklist, add to allowedTools |
| `.env.example` | Add `GSHEETS_TEMPLATE_ID` |
| `CLAUDE.md` | Add `GSHEETS_TEMPLATE_ID` to env docs |

## Implementation Plan

- [x] 1. Add `GSHEETS_TEMPLATE_ID` to `.env.example` and `CLAUDE.md`
- [x] 2. Build `sheets_create_estimation` tool in `src/mcp-servers/google-workspace.ts`
- [x] 3. Add `sheets_create_estimation` to orchestrator's `allowedTools` and MCP env config
- [x] 4. Add Step 4a prompt for estimation Sheet creation in orchestrator
- [x] 5. Replace detailed budget table with Investment Summary paragraph in Step 4 prompt
- [x] 6. Reframe VBP section: T&M → Fixed-Price vs Performance Partnership
- [x] 7. Update review checklist to remove budget table checks, add Sheet + Investment Summary checks
- [x] 8. Add Sheet URL to Slack completion message
- [x] 9. Add tests for `sheets_create_estimation` tool (data transformation, row layout)
- [x] 10. Type-check (`npx tsc --noEmit`) and manual test
- [x] 11. Update `.ai/lessons.md` if new pitfalls discovered
