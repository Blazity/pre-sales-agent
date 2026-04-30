# Estimation Sheet Separation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the detailed estimation breakdown from the proposal Doc into a separate Google Sheet (from template), present only a fixed-price summary in the Doc, and reframe VBP as Fixed-Price vs Performance Partnership.

**Architecture:** Add a `sheets_create_estimation` MCP tool to google-workspace that copies a template Sheet, clears example data, and writes structured estimation rows. Modify the orchestrator prompt to call this tool before creating the Doc, remove the detailed budget table from the Doc, and reframe the VBP section.

**Tech Stack:** Google Sheets API v4, existing google-workspace MCP server, `node:test` for testing.

**Spec:** `.ai/specs/SPEC-025-estimation-sheet-separation.md`

---

### Task 1: Add `GSHEETS_TEMPLATE_ID` env var

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`

**Step 1: Add env var to `.env.example`**

Add after line 27 (`GSLIDES_TEMPLATE_ID`):

```
GSHEETS_TEMPLATE_ID=...   # Google Sheets estimation template ID
```

**Step 2: Add to CLAUDE.md**

In `CLAUDE.md`, find the line `- \`GOOGLE_REFRESH_TOKEN\` is obtained once via...` and add nearby:

```
- `GSHEETS_TEMPLATE_ID` is the estimation template spreadsheet ID. Template format: Major Area | Action items | Effort (weeks) | Assumptions.
```

**Step 3: Add the actual value to `.env`**

Add to your local `.env` file:
```
GSHEETS_TEMPLATE_ID=11AVu9dfF-nc-yuQz_LSVeZwBw5CmslvwHTBtZvsVJ94
```

**Step 4: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "feat(estimation-sheet): add GSHEETS_TEMPLATE_ID env var"
```

---

### Task 2: Build `sheets_create_estimation` MCP tool — tests first

**Files:**
- Create: `src/mcp-servers/google-workspace.test.ts`

**Step 1: Write the failing test**

The MCP tool will internally use a helper function `buildEstimationRows()` that transforms structured input into spreadsheet row data. Test this pure function.

Create `src/mcp-servers/google-workspace.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const REQUIRED_ENV_VARS: Record<string, string> = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  SLACK_BOT_TOKEN: "xoxb-test",
  SLACK_SIGNING_SECRET: "signing-secret",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
  GDRIVE_TEMPLATE_ID: "template-doc-id",
  GDRIVE_ROOT_FOLDER_ID: "root-folder-id",
  PINECONE_API_KEY: "pinecone-key",
  VOYAGE_API_KEY: "voyage-key",
  GSLIDES_TEMPLATE_ID: "test-template",
  GSHEETS_TEMPLATE_ID: "test-sheet-template",
  NODE_TEST_CONTEXT: "true",
};

for (const [k, v] of Object.entries(REQUIRED_ENV_VARS)) {
  if (!process.env[k]) process.env[k] = v;
}

const { buildEstimationRows } = await import("./google-workspace.js");

describe("buildEstimationRows()", () => {
  it("builds rows for a single area with multiple items", () => {
    const rows = buildEstimationRows([
      {
        name: "Discovery",
        effort_hours: 160,
        items: [
          { name: "Technical discovery", assumptions: "Full-stack audit" },
          { name: "Architecture design", assumptions: "Cloud-native approach" },
        ],
      },
    ]);

    assert.equal(rows.length, 2);
    // First item row has the area name and effort in weeks
    assert.deepEqual(rows[0], ["Discovery", "Technical discovery", "4", "Full-stack audit"]);
    // Second item has empty area and effort columns
    assert.deepEqual(rows[1], ["", "Architecture design", "", "Cloud-native approach"]);
  });

  it("converts hours to weeks (÷40)", () => {
    const rows = buildEstimationRows([
      {
        name: "Dev",
        effort_hours: 200,
        items: [{ name: "Build it", assumptions: "" }],
      },
    ]);

    assert.equal(rows[0][2], "5");
  });

  it("rounds weeks to one decimal place", () => {
    const rows = buildEstimationRows([
      {
        name: "Dev",
        effort_hours: 100,
        items: [{ name: "Build it", assumptions: "" }],
      },
    ]);

    assert.equal(rows[0][2], "2.5");
  });

  it("handles multiple areas", () => {
    const rows = buildEstimationRows([
      {
        name: "Discovery",
        effort_hours: 80,
        items: [{ name: "Audit", assumptions: "Existing codebase" }],
      },
      {
        name: "Development",
        effort_hours: 320,
        items: [
          { name: "Core platform", assumptions: "Next.js" },
          { name: "Integrations", assumptions: "3 APIs" },
        ],
      },
    ]);

    assert.equal(rows.length, 3);
    assert.equal(rows[0][0], "Discovery");
    assert.equal(rows[0][2], "2");
    assert.equal(rows[1][0], "Development");
    assert.equal(rows[1][2], "8");
    assert.equal(rows[2][0], "");
    assert.equal(rows[2][2], "");
  });

  it("handles area with zero hours", () => {
    const rows = buildEstimationRows([
      {
        name: "Optional",
        effort_hours: 0,
        items: [{ name: "Nice to have", assumptions: "" }],
      },
    ]);

    assert.equal(rows[0][2], "0");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: FAIL — `buildEstimationRows` not exported

**Step 3: Commit test**

```bash
git add src/mcp-servers/google-workspace.test.ts
git commit -m "test(estimation-sheet): add buildEstimationRows tests"
```

---

### Task 3: Implement `buildEstimationRows` and `sheets_create_estimation` tool

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts` (add after `docs_find_and_replace` tool, before the start section at ~line 1151)

**Step 1: Add the GSHEETS_TEMPLATE_ID constant**

At the top of `src/mcp-servers/google-workspace.ts`, after line 10 (`ALLOWED_FOLDER_IDS`), add:

```typescript
const GSHEETS_TEMPLATE_ID = process.env.GSHEETS_TEMPLATE_ID ?? "";
```

**Step 2: Add `buildEstimationRows` helper**

Add before the `// ── Start` section (before line 1151):

```typescript
// ── Estimation Sheet helpers ────────────────────────────────────────────────

interface EstimationArea {
  name: string;
  effort_hours: number;
  items: Array<{ name: string; assumptions: string }>;
}

export function buildEstimationRows(areas: EstimationArea[]): string[][] {
  const rows: string[][] = [];

  for (const area of areas) {
    const weeks = area.effort_hours / 40;
    const weeksStr = Number.isInteger(weeks) ? String(weeks) : weeks.toFixed(1);

    for (let i = 0; i < area.items.length; i++) {
      const item = area.items[i];
      if (i === 0) {
        rows.push([area.name, item.name, weeksStr, item.assumptions]);
      } else {
        rows.push(["", item.name, "", item.assumptions]);
      }
    }
  }

  return rows;
}
```

**Step 3: Run tests to verify they pass**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: All PASS

**Step 4: Add `sheets_create_estimation` tool**

Add after `buildEstimationRows`, before `// ── Start`:

```typescript
// ── Sheets: create estimation from template ─────────────────────────────────

server.tool(
  "sheets_create_estimation",
  "Create an estimation spreadsheet from the template. Copies the template, clears example data, writes estimation breakdown by Major Area → Action Items. Effort is provided in hours and auto-converted to weeks.",
  {
    title: z.string().describe("Spreadsheet title, e.g. 'Estimation - Client - 2026-03-06'"),
    parent_folder_id: z.string().describe("Google Drive folder ID to place the spreadsheet in"),
    areas: z.array(z.object({
      name: z.string().describe("Major Area name, e.g. 'Discovery & Architecture'"),
      effort_hours: z.number().describe("Total effort for this area in hours (converted to weeks ÷40)"),
      items: z.array(z.object({
        name: z.string().describe("Action item name"),
        assumptions: z.string().describe("Assumptions for this item"),
      })).describe("Action items within this Major Area"),
    })).describe("Estimation breakdown by Major Area"),
  },
  async ({ title, parent_folder_id, areas }) => {
    try {
      assertAllowedFolder(parent_folder_id);

      if (!GSHEETS_TEMPLATE_ID) {
        return { content: [{ type: "text" as const, text: "Error: GSHEETS_TEMPLATE_ID not configured" }] };
      }

      const token = await getAccessToken();

      // 1. Copy template to output folder
      const copyRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${GSHEETS_TEMPLATE_ID}/copy?supportsAllDrives=true`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: title, parents: [parent_folder_id] }),
        },
      );
      if (!copyRes.ok) {
        const text = await copyRes.text();
        return { content: [{ type: "text" as const, text: `Copy template error: ${text}` }] };
      }
      const copied = (await copyRes.json()) as { id: string };
      const sheetId = copied.id;

      // 2. Get sheet metadata to find the first sheet's gid
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!metaRes.ok) {
        const text = await metaRes.text();
        return { content: [{ type: "text" as const, text: `Metadata error: ${text}` }] };
      }
      const meta = (await metaRes.json()) as {
        sheets: Array<{ properties: { sheetId: number; title: string; gridProperties: { rowCount: number } } }>;
      };
      const firstSheet = meta.sheets[0];
      const gid = firstSheet.properties.sheetId;
      const existingRows = firstSheet.properties.gridProperties.rowCount;

      // 3. Clear all data rows (keep header row 0)
      if (existingRows > 1) {
        const clearRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: [{
                deleteDimension: {
                  range: { sheetId: gid, dimension: "ROWS", startIndex: 1, endIndex: existingRows },
                },
              }],
            }),
          },
        );
        if (!clearRes.ok) {
          const text = await clearRes.text();
          return { content: [{ type: "text" as const, text: `Clear rows error: ${text}` }] };
        }
      }

      // 4. Build data rows
      const dataRows = buildEstimationRows(areas);
      const totalWeeks = areas.reduce((sum, a) => sum + a.effort_hours / 40, 0);
      const totalWeeksStr = Number.isInteger(totalWeeks) ? String(totalWeeks) : totalWeeks.toFixed(1);

      // Add summary rows
      dataRows.push(["Total required (weeks)", "", totalWeeksStr, ""]);
      dataRows.push(["Total optional (weeks)", "", "0", ""]);
      dataRows.push(["Total (weeks)", "", totalWeeksStr, ""]);

      // 5. Write all rows starting at A2
      const range = `${firstSheet.properties.title}!A2:D${dataRows.length + 1}`;
      const writeRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ range, values: dataRows }),
        },
      );
      if (!writeRes.ok) {
        const text = await writeRes.text();
        return { content: [{ type: "text" as const, text: `Write data error: ${text}` }] };
      }

      const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
      return {
        content: [{
          type: "text" as const,
          text: `Estimation spreadsheet created!\nTitle: ${title}\nID: ${sheetId}\nURL: ${sheetUrl}\nTotal: ${totalWeeksStr} weeks (${areas.reduce((s, a) => s + a.effort_hours, 0)} hours)\nAreas: ${areas.length}, Action items: ${dataRows.length - 3}`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);
```

**Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "feat(estimation-sheet): add sheets_create_estimation MCP tool"
```

---

### Task 4: Register the tool in the orchestrator and pass env vars

**Files:**
- Modify: `src/agents/orchestrator.ts:66-72` (requiredEnv)
- Modify: `src/agents/orchestrator.ts:748-756` (google-workspace MCP env)
- Modify: `src/agents/orchestrator.ts:786-798` (allowedTools)

**Step 1: Add `GSHEETS_TEMPLATE_ID` to required env vars**

In `src/agents/orchestrator.ts`, line 70, add `"GSHEETS_TEMPLATE_ID"` to the `requiredEnv` array:

```typescript
  const requiredEnv = [
    "PINECONE_API_KEY", "VOYAGE_API_KEY",
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN",
    "ANTHROPIC_API_KEY", "SLACK_BOT_TOKEN",
    "GDRIVE_TEMPLATE_ID", "GSHEETS_TEMPLATE_ID",
    ...(!job.skipSteps?.includes("presentation") ? ["GSLIDES_TEMPLATE_ID"] : []),
  ];
```

**Step 2: Pass `GSHEETS_TEMPLATE_ID` to google-workspace MCP**

In the google-workspace MCP config (line 751-756), add the env var:

```typescript
          "google-workspace": {
            command: "node",
            args: [path.join(ROOT, "dist/mcp-servers/google-workspace.js")],
            env: {
              GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
              GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
              GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN!,
              GSHEETS_TEMPLATE_ID: process.env.GSHEETS_TEMPLATE_ID!,
              ALLOWED_FOLDER_IDS: allowedFolders,
            },
          },
```

**Step 3: Add `sheets_create_estimation` to allowedTools**

Add after `"mcp__google-workspace__docs_write_sections"` (line 798):

```typescript
          "mcp__google-workspace__sheets_create_estimation",
```

**Step 4: Add `sheets_create_estimation` to TOOL_TO_STEP mapping**

At line 17-31, add the tool to step 4 (Offer):

```typescript
  sheets_create_estimation: 4,
```

**Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-sheet): register tool in orchestrator config"
```

---

### Task 5: Add Step 4a prompt — estimation Sheet creation

**Files:**
- Modify: `src/agents/orchestrator.ts:399-440` (before Step 4 Doc creation)

**Step 1: Insert Step 4a before the existing Step 4**

After the `## Step 3: Value Discovery` section ends (line 397: `Do NOT post findings to Slack. Proceed directly to Step 4.`), insert the new step. Renumber the existing Step 4 to Step 4b:

Replace lines 399-400:
```
## Step 4: Create the Google Doc Offer
```

With:
```
## Step 4a: Create Estimation Breakdown

Before creating the offer document, build the detailed estimation spreadsheet:

1. Structure your estimation by Major Area → Action Items.
   Major Areas are high-level project phases/modules (e.g., "Discovery & Architecture",
   "Core Platform", "Integrations", "QA & Launch").
   Each Major Area should have 3-8 specific action items with brief assumptions.

2. Estimate effort in hours per Major Area using the ESTIMATION RULES rate card.
   Apply the AI productivity factor (30-40% reduction on development tasks).
   The tool converts hours → weeks automatically (÷40).

3. Call sheets_create_estimation:
   - title: "Estimation - [Client] - [Date]"
   - parent_folder_id: ${job.outputFolderId ?? "root"}
   - areas: your structured estimation breakdown

4. Note the total hours and total EUR (hours × blended rate from rate card)
   for use in the offer document's Investment Summary.

## Step 4b: Create the Google Doc Offer
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-sheet): add Step 4a prompt for Sheet creation"
```

---

### Task 6: Replace Doc budget table with Investment Summary + fix Delivery approach

**Files:**
- Modify: `src/agents/orchestrator.ts:464-484` (budget section in Step 4 prompt)
- Modify: `src/agents/orchestrator.ts:464` (Delivery approach — T&M → fixed-price)

**Step 1: Replace the Delivery approach paragraph**

Find line 464:
```
      - heading level 2: "Delivery approach" + paragraph (T&M model explanation)
```

Replace with:
```
      - heading level 2: "Delivery approach" + paragraph (fixed-price engagement model: scope-based pricing, milestone-based delivery, what's included)
```

**Step 2: Replace the Budget section**

Find lines 474-484 (the budget heading, paragraph, and table):

```
   d. heading level 1: "Development Timeline & Budget"
      - heading level 2: "Timeline" + table (Phase | Duration | Key Deliverables,
          headerBackground: "#FD6027", headerTextColor: "#FFFFFF", borderColor: "#E6E8EB")
      - heading level 2: "Budget" + paragraph: "Hours reflect AI-augmented development workflow (est. 35% productivity gain)."
        + table (Feature/Module | Role | Hours | Cost (EUR),
          headerBackground: "#FD6027", headerTextColor: "#FFFFFF", borderColor: "#E6E8EB",
          totalRowBackground: "#FD6027", totalRowTextColor: "#FFFFFF")
          Break down by feature, not by role. Use rates from the ESTIMATION RULES rate card.
          Last rows: Subtotal, PM overhead (10%), Total.
      - heading level 2: "QA & Testing strategy" + paragraph + numbered_list
      - heading level 2: "Additional costs" + paragraph (infrastructure, tooling)
```

Replace with:

```
   d. heading level 1: "Development Timeline & Budget"
      - heading level 2: "Timeline" + table (Phase | Duration | Key Deliverables,
          headerBackground: "#FD6027", headerTextColor: "#FFFFFF", borderColor: "#E6E8EB")
      - heading level 2: "Investment Summary" + paragraph:
          A concise paragraph (80-120 words) covering:
          1. Total estimated effort in weeks (from the estimation spreadsheet)
          2. Total fixed-price investment in EUR (calculated internally from hours × rate card + 10% PM overhead)
          3. What's included: all phases from discovery through launch, QA, and post-launch stabilization
          4. AI productivity note: "Estimate reflects AI-augmented development workflow."
          Do NOT mention T&M, hourly rates, per-feature costs, or rate card details.
          Present as a fixed-price engagement. The detailed breakdown is in the estimation spreadsheet (internal).
          Do NOT include a detailed feature breakdown table in this document.
      - heading level 2: "QA & Testing strategy" + paragraph + numbered_list
      - heading level 2: "Additional costs" + paragraph (infrastructure, tooling)
```

**Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-sheet): replace budget table with Investment Summary"
```

---

### Task 7: Reframe VBP section — T&M → Fixed-Price vs Performance Partnership

**Files:**
- Modify: `src/agents/orchestrator.ts:490-541` (VBP section in Step 4 prompt)

**Step 1: Replace the VBP heading**

Find line 490:
```
   f. heading level 1: "Alternative: Value-Based Partnership"
```

Replace with:
```
   f. heading level 1: "Alternative: Performance Partnership"
```

**Step 2: Replace the Approach Comparison table**

Find lines 507-515 (the Investment Structure table):

```
        + table: Approach Comparison
          columns: Dimension | T&M Approach | Value-Based Partnership
          rows:
            1. "Investment" | T&M total from budget table | VBP base fee + max bonus
            2. "Risk Allocation" | "Client bears scope and timeline risk" | "Shared — Blazity puts bonus at stake on outcomes"
            3. "Incentive Alignment" | "Vendor compensated for time spent" | "Both parties benefit from measurable outcomes"
            4. "Scope Flexibility" | "Flexible scope, variable cost" | "Fixed scope, performance-linked upside"
            5. "Expected ROI" | "N/A — priced on effort" | "[X]× projected return on first-year value"
```

Replace with:

```
        + table: Approach Comparison
          columns: Dimension | Fixed-Price | Performance Partnership
          rows:
            1. "Investment" | "€X fixed" | "Base €X + max bonus €Y"
            2. "Risk Allocation" | "Blazity bears delivery risk" | "Shared — Blazity puts bonus at stake on outcomes"
            3. "Incentive Alignment" | "Deliverables-focused" | "Both parties benefit from measurable results"
            4. "Scope" | "Fixed scope, fixed price" | "Fixed scope + performance-linked upside"
            5. "Expected ROI" | "N/A — priced on scope" | "[N]× projected return on first-year value"
```

**Step 3: Replace the Investment breakdown paragraph**

Find lines 516-520:

```
        + paragraph: Investment breakdown:
          "**Base delivery fee: €X** — covers full project delivery including all phases, QA, and launch support."
          "**Performance bonus pool: €Y (20% of base)** — earned upon achievement of the success metrics below."
          "**Total maximum investment: €Z** — projected ROI of **[N]×** based on first-year value."
          Where X = T&M budget total, Y = X × 0.20, Z = X + Y, N = Total Annual Value ÷ Z.
```

Replace with:

```
        + paragraph: Investment breakdown:
          "**Fixed delivery fee: €X** — covers full project delivery including all phases, QA, and launch support."
          "**Performance bonus pool: €Y (20% of base)** — earned upon achievement of the success metrics below."
          "**Total maximum investment: €Z** — projected ROI of **[N]×** based on first-year value."
          Where X = fixed-price total from Investment Summary, Y = X × 0.20, Z = X + Y, N = Total Annual Value ÷ Z.
```

**Step 4: Replace "Why Value-Based Pricing" heading**

Find line 536:
```
      - heading level 2: "Why Value-Based Pricing"
```

Replace with:
```
      - heading level 2: "Why Performance Partnership"
```

**Step 5: Update the paragraph content**

Find lines 537-541 and replace:

```
        + paragraph: 3-4 sentences covering:
          1. Incentive alignment — "We succeed when you succeed"
          2. Shared risk — Blazity puts meaningful compensation at stake on outcomes
          3. Quality focus — rewards efficiency and results, not hours logged
          4. Partnership model — designed for clients who prioritize measurable business impact
```

Replace with:

```
        + paragraph: 3-4 sentences covering:
          1. Incentive alignment — "We succeed when you succeed"
          2. Shared risk — Blazity puts meaningful compensation at stake on outcomes
          3. Quality focus — rewards results and efficiency, not just deliverables
          4. Partnership model — designed for clients who prioritize measurable business impact
```

**Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-sheet): reframe VBP as Fixed-Price vs Performance Partnership"
```

---

### Task 8: Update review checklist

**Files:**
- Modify: `src/agents/orchestrator.ts:556-583` (review checklist)

**Step 1: Replace budget-related checks**

Find line 560:
```
4. Budget table: Does every feature line item have role + hours + cost? Is there a Subtotal, PM overhead (10%), and Total row? Is currency EUR?
```

Replace with:
```
4. Investment Summary: Is there a concise paragraph with total weeks, total fixed EUR amount, and inclusions? Does it avoid mentioning hourly rates or T&M?
```

Find lines 566-567 (formatting checks 8-9):
```
8. Tables: Verify all three tables (Risks, Timeline, Budget) have orange header backgrounds. If headers have no background color, rewrite the table with headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB".
9. Budget table: Verify the last row (Total) has an orange background. If not, rewrite with totalRowBackground "#FD6027", totalRowTextColor "#FFFFFF".
```

Replace with:
```
8. Tables: Verify both tables (Risks, Timeline) have orange header backgrounds. If headers have no background color, rewrite the table with headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB".
9. Estimation Sheet: Was sheets_create_estimation called successfully? If not, call it now before proceeding.
```

Find line 572 (VBP check 12):
```
12. Investment Structure: Does the base fee match the T&M budget total exactly? Is the bonus pool exactly 20% of the base fee? Is the ROI multiplier calculated correctly (Total Annual Value ÷ Total Maximum Investment)?
```

Replace with:
```
12. Investment Structure: Does the base fee match the fixed-price total from the Investment Summary? Is the bonus pool exactly 20% of the base fee? Is the ROI multiplier calculated correctly (Total Annual Value ÷ Total Maximum Investment)?
```

Find lines 576-578 (estimation calibration checks 14-16):
```
14. Rate card compliance: Do all hourly rates match the ESTIMATION RULES rate card exactly?
15. Team size matches complexity tier: Does the team composition follow the Simple/Medium/Complex sizing rules?
16. Feature-level breakdown: Is the budget broken down by feature/module (not by role/phase)?
```

Replace with:
```
14. Rate card compliance: Was the fixed price calculated using the ESTIMATION RULES rate card? (Internal check — rates should not appear in the Doc.)
15. Team size matches complexity tier: Does the team composition follow the Simple/Medium/Complex sizing rules?
16. Estimation Sheet populated: Does the Sheet have a breakdown by Major Area with action items and assumptions?
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-sheet): update review checklist for fixed-price model"
```

---

### Task 9: Add Sheet URL to Slack completion message

**Files:**
- Modify: `src/agents/orchestrator.ts:694-705` (completion message)

**Step 1: Add Sheet to the completion message**

Find lines 694-705:

```
6. Post a final completion message to Slack using blocks:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "✅ Estimation Complete"}},
  {"type": "divider"},
  {"type": "section", "fields": [
    {"type": "mrkdwn", "text": "*📄 Offer:*\n<GOOGLE_DOC_URL|View Document>"},
    {"type": "mrkdwn", "text": "*🎨 Presentation:*\n<GOOGLE_SLIDES_URL|View Slides>"}
  ]},
  {"type": "context", "elements": [{"type": "mrkdwn", "text": "Both documents are in the shared Google Drive folder."}]}
]
text: "✅ Estimation complete — offer and presentation ready"
```

Replace with:

```
6. Post a final completion message to Slack using blocks:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "✅ Estimation Complete"}},
  {"type": "divider"},
  {"type": "section", "fields": [
    {"type": "mrkdwn", "text": "*📄 Offer:*\n<GOOGLE_DOC_URL|View Document>"},
    {"type": "mrkdwn", "text": "*📊 Estimation:*\n<GOOGLE_SHEET_URL|View Spreadsheet>"},
    {"type": "mrkdwn", "text": "*🎨 Presentation:*\n<GOOGLE_SLIDES_URL|View Slides>"}
  ]},
  {"type": "context", "elements": [{"type": "mrkdwn", "text": "All documents are in the shared Google Drive folder. The estimation spreadsheet is for internal review — do not share with the client."}]}
]
text: "✅ Estimation complete — offer, estimation, and presentation ready"
```

**Step 2: Also update the Slides pricing slide instruction**

Find lines 661-664:
```
   SLIDE N+9 — layout: PRICING
     → Call add_pricing_block with feature-level cost breakdown (matching the offer's
       feature-level budget table). Include the AI productivity note.
       Rates must match the ESTIMATION RULES rate card.
```

Replace with:
```
   SLIDE N+9 — layout: PRICING
     → Call add_pricing_block with the fixed-price total and effort breakdown by Major Area
       (matching the estimation spreadsheet). Include the AI productivity note.
       Present as fixed-price, not hourly rates.
```

**Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-sheet): add Sheet to completion message and update slides"
```

---

### Task 10: Update system prompt — estimation rules context

**Files:**
- Modify: `src/agents/orchestrator.ts:188-226` (estimation rules in system prompt)

**Step 1: Add estimation sheet context to the system prompt**

Find line 218 (the Feature-Level Estimation section):

```
Feature-Level Estimation:
Break the budget into features/modules, not roles. Format:
  Feature | Role | Hours | Cost (EUR)
  e.g. "CMS migration (content modeling + import) | Senior | 40 | 3,400"
  Last rows: Subtotal, PM overhead (10%), Total.
The discovery team must be able to challenge individual line items.
```

Replace with:

```
Estimation Breakdown:
Structure the estimation by Major Area → Action Items (matching the Sheet template).
Major Areas are project phases/modules. Each has a total effort in hours and 3-8 action items.
Example: "Core Platform | CMS setup & content models, Shared component library, Auth & SSO, ..."
Calculate the fixed price internally: total hours × blended rate + 10% PM overhead.
The estimation spreadsheet is internal — the Doc shows only the total fixed price.
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-sheet): update estimation rules for sheet-based workflow"
```

---

### Task 11: Full verification

**Files:**
- All modified files

**Step 1: Run full type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Update spec status**

In `.ai/specs/SPEC-025-estimation-sheet-separation.md`, check off completed items.
In `.ai/specs/README.md`, update status from "Planning" to "Implemented".

**Step 4: Update lessons learned**

Append to `.ai/lessons.md` if new pitfalls were discovered. Known things to document:
- `GSHEETS_TEMPLATE_ID` must be set before running estimations — otherwise `sheets_create_estimation` returns an error
- The Sheets API `deleteDimension` clears rows but the header row (row 0) must be preserved
- `valueInputOption: USER_ENTERED` is required so Sheets interprets formulas and numbers correctly
- The pricing slide now shows fixed-price totals by Major Area, not hourly breakdowns

**Step 5: Final commit**

```bash
git add .ai/specs/ .ai/lessons.md
git commit -m "feat(estimation-sheet): complete implementation and update docs"
```

---

### Task 12: Reseed knowledge base with corrected Drive files

The estimation and proposal Drive folders now have corrected files. The Pinecone knowledge base must be fully re-indexed to replace the stale data.

**Context:**
- The seed script reads from two Drive folders configured in `.env`:
  - `GDRIVE_ESTIMATIONS_FOLDER_ID` — Google Sheets with feature-level breakdowns
  - `GDRIVE_PROPOSALS_FOLDER_ID` — Google Docs with past proposals
- It parses Sheets into structured records (summary + per-feature) and chunks Docs (~800 words)
- Both are embedded via Voyage AI (voyage-3) and stored in Pinecone namespaces
- The script supports `--incremental` but we want a **full re-index** to replace stale data

**Step 1: Verify Drive folder IDs in `.env`**

Run: `grep GDRIVE_ .env`

Confirm both `GDRIVE_ESTIMATIONS_FOLDER_ID` and `GDRIVE_PROPOSALS_FOLDER_ID` point to the correct folders with the updated files. If not, update them now.

**Step 2: Delete the incremental state file**

The seed script uses `.seed-state.json` to track which files have been indexed. Delete it to force a full re-index:

Run: `rm -f .seed-state.json`

**Step 3: Run full re-index**

Run: `npm run seed`

This will:
1. List all Sheets in the estimations folder and parse each one
2. List all Docs in the proposals folder and chunk each one
3. Embed everything via Voyage AI (rate-limited to ~3 RPM)
4. Upsert all vectors into Pinecone, replacing stale data

Expected: Script completes with summary showing number of sheets/docs indexed and vectors upserted. Watch for errors about invalid sheets or access issues.

**Important:** This can take several minutes depending on the number of files and Voyage rate limits. The script prints progress as it goes.

**Step 4: Verify the new data**

After seeding completes, verify by checking the Pinecone index stats. Run a quick sanity check:

```bash
npx tsx -e "
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY ?? '' });
const idx = pc.index(process.env.PINECONE_INDEX ?? 'estimations');
const stats = await idx.describeIndexStats();
console.log('Index stats:', JSON.stringify(stats, null, 2));
"
```

Confirm the vector count reflects the newly seeded data.

**Step 5: Commit state file (if it exists)**

If `.seed-state.json` was regenerated, it should NOT be committed (it's in `.gitignore`). Verify:

Run: `git status`

No action needed unless the state file is tracked.
