# SPEC-036: Remove Presentation Step + Fix Rounding

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the unused Google Slides presentation step (Step 5) from the pipeline, and fix overly aggressive MD rounding by removing the 0.5 minimum floor.

**Architecture:** Delete the google-slides MCP server, remove Step 5 prompt and all slides tool references from the orchestrator, move the completion message into Step 4. Change `buildEstimationRows` to drop the `Math.max(0.5, ...)` floor.

**Tech Stack:** Orchestrator prompt, MCP server config, Google Workspace MCP helpers.

**Status:** Implemented
**Date:** 2026-03-12
**Scope:** `src/agents/orchestrator.ts`, `src/mcp-servers/google-slides.ts`, `src/mcp-servers/google-workspace.ts`, `src/mcp-servers/google-workspace.test.ts`

---

## Problem

1. **Presentation step is unused** — Step 5 creates a Google Slides deck but the team doesn't use it. It adds ~100 lines of prompt, a full MCP server (670 lines), 6 tools, and wastes agent turns + API cost on every estimation.

2. **Rounding too aggressive** — The `Math.max(0.5, Math.round(md * 2) / 2)` formula forces every non-zero item to at least 0.5 MD (4 hours). A 1-hour task (0.125 MD) becomes 0.5 MD — a 4x inflation. The `Math.max(0.5, ...)` floor should be removed; round-to-nearest-0.5 stays.

## Design

### Change 1: Remove Presentation Step

**Orchestrator (`src/agents/orchestrator.ts`):**
- `STEP_NAMES` (line 15): Remove `"Presentation"` from the array
- `TOOL_TO_STEP` (lines 29-34): Remove all 6 slides tool entries
- Required env vars (line 87): Remove `GSLIDES_TEMPLATE_ID` conditional
- `skipSteps` (lines 364-366): Remove the `"presentation"` skip branch
- Step 5 prompt (lines 763-874): Delete entirely
- Completion message: The final Slack message currently lives inside Step 5 (lines 861-874) and includes a Slides link. Move it to the end of Step 4 without the Slides field.
- MCP config (lines 932-942): Remove `"google-slides"` server block
- `allowedTools` (lines 977-982): Remove 6 `mcp__google-slides__*` entries

**Files to delete:**
- `src/mcp-servers/google-slides.ts` (~670 lines)
- `scripts/build-slides-template.ts`
- `scripts/create-slides-template.ts`

**Docs to update:**
- `.ai/architecture.md`: Remove slides row from pipeline table, remove template script reference, remove `GSLIDES_TEMPLATE_ID` reference
- `.ai/mcp-tools.md`: Remove `## google-slides` section

### Change 2: Fix Rounding

**`src/mcp-servers/google-workspace.ts` (line 1168):**

Current:
```typescript
const mdNum = md === 0 ? 0 : Math.max(0.5, Math.round(md * 2) / 2);
```

New:
```typescript
const mdNum = Math.round(md * 2) / 2;
```

The `md === 0` guard is no longer needed — `Math.round(0) / 2 = 0`.

Before/after:
| Hours | MD (raw) | Current | New |
|-------|----------|---------|-----|
| 0 | 0.0 | 0 | 0 |
| 1 | 0.125 | 0.5 | 0 |
| 2 | 0.25 | 0.5 | 0.5 |
| 5 | 0.625 | 0.5 | 0.5 |
| 10 | 1.25 | 1.5 | 1.5 |
| 9.6 | 1.2 | 1.0 | 1.0 |

---

## Plan

### Task 1: Remove slides tools and MCP config from orchestrator

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Remove slides entries from `TOOL_TO_STEP` (lines 29-34)**

Delete these 6 lines:
```typescript
  create_presentation: 5,
  add_slide: 5,
  set_client_logo: 5,
  add_timeline_data: 5,
  add_pricing_block: 5,
  cleanup_template_slides: 5,
```

**Step 2: Remove "Presentation" from `STEP_NAMES` (line 15)**

Change:
```typescript
const STEP_NAMES = ["Initializing", "Analysis", "Clarification", "Value Discovery", "Offer", "Presentation"] as const;
```
To:
```typescript
const STEP_NAMES = ["Initializing", "Analysis", "Clarification", "Value Discovery", "Offer"] as const;
```

**Step 3: Remove `GSLIDES_TEMPLATE_ID` from required env vars (line 87)**

Change:
```typescript
    "GDRIVE_TEMPLATE_ID", "GSHEETS_TEMPLATE_ID",
    ...(!job.skipSteps?.includes("presentation") ? ["GSLIDES_TEMPLATE_ID"] : []),
```
To:
```typescript
    "GDRIVE_TEMPLATE_ID", "GSHEETS_TEMPLATE_ID",
```

**Step 4: Remove presentation skip branch (lines 364-366)**

Delete:
```typescript
  if (job.skipSteps?.includes("presentation")) {
    skipInstructions.push("SKIP Step 5 entirely — do not create a Google Slides presentation.");
  }
```

**Step 5: Remove `"google-slides"` MCP server config (lines 932-942)**

Delete the entire block:
```typescript
          "google-slides": {
            command: "node",
            args: [path.join(ROOT, "dist/mcp-servers/google-slides.js")],
            env: {
              GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
              GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
              GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN!,
              GSLIDES_TEMPLATE_ID: process.env.GSLIDES_TEMPLATE_ID!,
              ALLOWED_FOLDER_IDS: allowedFolders,
            },
          },
```

**Step 6: Remove 6 slides tools from `allowedTools` (lines 977-982)**

Delete:
```typescript
          "mcp__google-slides__create_presentation",
          "mcp__google-slides__add_slide",
          "mcp__google-slides__set_client_logo",
          "mcp__google-slides__add_timeline_data",
          "mcp__google-slides__add_pricing_block",
          "mcp__google-slides__cleanup_template_slides",
```

**Step 7: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(remove-presentation): strip slides MCP config, tools, and env vars"
```

---

### Task 2: Replace Step 5 prompt with completion message in Step 4

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Delete the entire Step 5 block (lines 763-874)**

Delete from `## Step 5: Create the Visual Presentation` through the completion message blocks (ending just before `${skipInstructions.length > 0`).

**Step 2: Add a completion message at the end of Step 4**

After the Step 4 review checks (after line 761 `Note the Google Doc URL for the final completion message.`), replace that line and add the new completion message:

```
After ALL checks pass, post a final completion message to Slack:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "✅ Estimation Complete"}},
  {"type": "divider"},
  {"type": "section", "fields": [
    {"type": "mrkdwn", "text": "*📄 Offer:*\n<GOOGLE_DOC_URL|View Document>"},
    {"type": "mrkdwn", "text": "*📊 Estimation:*\n<GOOGLE_SHEET_URL|View Spreadsheet>"}
  ]},
  {"type": "context", "elements": [{"type": "mrkdwn", "text": "All documents are in the shared Google Drive folder. The estimation spreadsheet is for internal review — do not share with the client."}]}
]
text: "✅ Estimation complete — offer and estimation ready"
```

Note: Compared to the old message, removed the `🎨 Presentation` field and changed the text from "offer, estimation, and presentation ready" to "offer and estimation ready".

**Step 3: Update the comment on line 78**

Change:
```typescript
/** Run the full estimation pipeline: analysis → clarification → offer → presentation. */
```
To:
```typescript
/** Run the full estimation pipeline: analysis → clarification → offer. */
```

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(remove-presentation): replace Step 5 with completion message in Step 4"
```

---

### Task 3: Delete google-slides MCP server and template scripts

**Files:**
- Delete: `src/mcp-servers/google-slides.ts`
- Delete: `scripts/build-slides-template.ts`
- Delete: `scripts/create-slides-template.ts`

**Step 1: Delete the files**

```bash
rm src/mcp-servers/google-slides.ts
rm scripts/build-slides-template.ts
rm scripts/create-slides-template.ts
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors (no other file imports from google-slides)

**Step 3: Commit**

```bash
git add -u src/mcp-servers/google-slides.ts scripts/build-slides-template.ts scripts/create-slides-template.ts
git commit -m "feat(remove-presentation): delete google-slides MCP server and template scripts"
```

---

### Task 4: Update architecture and MCP docs

**Files:**
- Modify: `.ai/architecture.md`
- Modify: `.ai/mcp-tools.md`

**Step 1: Update `.ai/architecture.md`**

- Remove the Step 5 Presentation row from the pipeline table (line 19)
- Remove `scripts/build-slides-template.ts` from the scripts table (line 61)
- Remove `GSLIDES_TEMPLATE_ID (Slides)` from line 69
- Update the placeholder pattern line 68 to say "Docs templates" instead of "both Docs and Slides templates"

**Step 2: Update `.ai/mcp-tools.md`**

Remove the entire `## google-slides` section (tools: `create_presentation`, `add_slide`, `set_client_logo`, `add_timeline_data`, `add_pricing_block`, `cleanup_template_slides`).

**Step 3: Commit**

```bash
git add .ai/architecture.md .ai/mcp-tools.md
git commit -m "docs(remove-presentation): update architecture and MCP tool docs"
```

---

### Task 5: Fix rounding — remove 0.5 MD minimum

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts` (line 1168)
- Modify: `src/mcp-servers/google-workspace.test.ts` (lines 543-553)

**Step 1: Update `buildEstimationRows` formula (line 1168)**

Change:
```typescript
      const mdNum = md === 0 ? 0 : Math.max(0.5, Math.round(md * 2) / 2);
```
To:
```typescript
      const mdNum = Math.round(md * 2) / 2;
```

**Step 2: Update the "enforces 0.5 minimum" test (lines 543-553)**

The test "enforces 0.5 minimum for non-zero hours" should now reflect that 2h / 8 = 0.25 → rounds to 0.5 (which is correct with `Math.round(0.25 * 2) / 2 = Math.round(0.5) / 2 = 1 / 2 = 0.5`).

Wait — `Math.round(0.5)` in JavaScript returns 1 (rounds half up). So 0.25 MD → 0.5 still. The test actually still passes!

Let's verify edge cases:
- 1h → 0.125 MD → `Math.round(0.25) / 2 = 0 / 2 = 0` (was 0.5, now 0)
- 2h → 0.25 MD → `Math.round(0.5) / 2 = 1 / 2 = 0.5` (was 0.5, still 0.5)

The test "enforces 0.5 minimum for non-zero hours" uses 2h which still rounds to 0.5. Rename the test and add a test for 1h → 0:

Rename:
```typescript
  it("rounds 0.25 MD to 0.5", () => {
    // 2h / 8 = 0.25 → Math.round(0.5)/2 = 0.5
```
(Keep the same assertion — it still expects 0.5)

Add new test:
```typescript
  it("rounds very small items to 0", () => {
    // 1h / 8 = 0.125 → Math.round(0.25)/2 = 0
    const rows = buildEstimationRows([
      {
        name: "Dev",
        items: [{ name: "Task", effort_hours: 1, parallel: false, assumptions: "" }],
      },
    ]);

    assert.equal(rows[0][2], 0);
  });
```

**Step 3: Run tests**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: All pass

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/mcp-servers/google-workspace.ts src/mcp-servers/google-workspace.test.ts
git commit -m "fix(remove-presentation): remove 0.5 MD minimum from rounding"
```

---

### Task 6: Final verification

**Step 1: Run full type check**

Run: `npx tsc --noEmit`

**Step 2: Run all tests**

Run: `npm test`

**Step 3: Verify no stale references**

- `grep -r "google-slides\|google_slides\|GSLIDES" src/` — should find nothing
- `grep -r "create_presentation\|add_slide\|set_client_logo\|add_timeline_data\|add_pricing_block\|cleanup_template_slides" src/` — should find nothing
- `grep -r "Step 5\|Presentation" src/agents/orchestrator.ts` — should find nothing
- `grep -r "Math.max(0.5" src/` — should find nothing

**Step 4: Self-review checklist**

- Error propagation: No new error paths introduced (only deletions)
- Prompt safety: Completion message uses same block format as before, no new user data interpolation
- Accounting: TOOL_TO_STEP no longer maps step 5, STEP_NAMES has 5 entries matching steps 0-4
- Stale env: `.env.example` — remove `GSLIDES_TEMPLATE_ID` if present

**Step 5: Push and create PR**

```bash
git push -u origin feat/remove-presentation
gh pr create --title "feat: remove presentation step, fix MD rounding" --body "..."
```
