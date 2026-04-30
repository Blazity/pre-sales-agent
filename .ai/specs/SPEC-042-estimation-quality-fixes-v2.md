# SPEC-042: Estimation Quality Fixes v2

**Status:** Implemented
**Date:** 2026-03-16

## Problem

Six issues identified from production estimation output review:

1. **Component library & page templates underestimated** — no effort calibration ranges, missing component counts and Figma links
2. **Blog post / page migration ignored** — no prompt instruction to check for migration scope
3. **CMS webhook at floor of range** — ranges exist but no criteria for choosing within them
4. **Always 2 senior engineers** — team sizing ranges lack selection thresholds
5. **Sheet template formatting broken** — header description row overwritten, remnant formatting from template bottom rows
6. **Wrong type assignments** — CMS work tagged as Backend, Vercel tagged as DevOps

## Root Causes

| # | Root Cause | Location | Issues |
|---|-----------|----------|--------|
| RC1 | Missing effort calibration ranges for component libraries, page templates, content migration | `orchestrator.ts` EFFORT CALIBRATION section | 1, 2, 3 |
| RC2 | Team sizing ranges have no MD-based selection criteria | `orchestrator.ts` Team Sizing section | 4 |
| RC3 | Type categorization too vague, no classification guide or common mistakes list | `orchestrator.ts` Estimation Breakdown section | 6 |
| RC4a | `values.clear` starts at A2, overwriting template description row; data writes start at row 2 | `google-workspace.ts` lines 1192, 1329, 1342 | 5 |
| RC4b | `values.clear` only clears values, not formatting — template bottom-row styling persists | `google-workspace.ts` line 1329 | 5 |

## Design

### 1. Effort Calibration Additions (RC1)

Add to EFFORT CALIBRATION section after "API Integrations", before "QA & Testing":

```
Component Libraries & Page Templates:
- Component library from Figma: 1-2 MD for ≤10 components, 2-4 MD for 10-25, 4-6 MD for 25+.
  MUST state assumed count in assumptions (e.g., "~15 universal components from Figma").
  If Figma link is available, reference it in figma_link column.
- Page templates (unique layouts): 0.5-1 MD per unique template.
  Count distinct layouts (e.g., homepage, listing, detail, blog post = 4 templates).
  Repeated pages sharing the same template are NOT separate items.

Content & Data Migration:
- Blog post migration: 0.5-1 MD per content type (posts, categories, authors, tags).
  Add 0.5 MD if URL redirect mapping is needed.
- Static page migration: 0.25-0.5 MD per batch of similar pages.
- Data migration from legacy CMS: 1-3 MD depending on schema complexity and volume.
- ALWAYS check the RFP for existing content, pages, or data that must be preserved or migrated.
  Migration is commonly overlooked — treat it as a mandatory scope check.
```

Update CMS webhook range with selection criteria:

```
- WEBHOOK / CACHE INVALIDATION: CMS webhook + cache invalidation is not trivial.
  1-2 MD for sites with ≤5 content types and no ISR/on-demand revalidation.
  2-4 MD for sites with 5+ content types, ISR, or multi-environment cache invalidation.
```

### 2. Team Sizing Selection Criteria (RC2)

Replace current Team Sizing block:

```
Team Sizing (AI-augmented):
- Simple (typically <100k EUR): 1 senior engineer + AI agent.
- Medium (typically 100-200k EUR):
  1 senior engineer + designer if total MD ≤ 50.
  2 senior engineers + designer if total MD > 50 or project has 3+ parallel workstreams.
- Complex (typically >200k EUR):
  2 senior engineers + designer + QA if total MD ≤ 120.
  3 senior engineers + designer + QA if total MD > 120 or tight deadline requires parallelism.
- Never staff "just in case." Only add roles the scope demands.
  Justify your team size in one line (e.g., "1 engineer — 35 MD, no parallel workstreams needed").
```

### 3. Type Classification Guide (RC3)

Replace minimal type definition with full classification guide:

```
- type: one of "Frontend", "Backend", "Design", "QA", or "DevOps"
  Classification guide:
  - Frontend: UI components, page templates, responsive design, client-side logic,
    CMS setup & content models (headless CMS like Contentful/Sanity/Storyblok),
    managed hosting (Vercel, Netlify), SSR/ISR/caching, API routes, webhooks,
    server-side logic within Next.js, database integration via ORMs (Prisma, Drizzle),
    authentication (NextAuth/Clerk), SEO/meta/sitemap,
    3rd-party SDK/API integrations (Anthropic, Stripe, HubSpot, etc.) via Next.js API routes.
  - Backend: ONLY for projects with custom cloud infrastructure (AWS, GCP, Azure) —
    standalone API services, microservices, custom servers outside of Next.js.
    If the project runs entirely on Next.js + managed hosting, there are NO Backend items.
    3rd-party SDK/API integrations handled via Next.js API routes are Frontend, NOT Backend.
  - Design: Figma design systems, UI/UX design, wireframes, prototyping.
  - QA: Test planning, manual/automated testing, cross-browser QA, performance testing.
  - DevOps: Custom infrastructure (k8s, Terraform, Docker), CI/CD pipelines,
    self-hosted environments, monitoring/alerting. NOT managed platforms like Vercel/Netlify.
  Common mistakes — do NOT make these:
  - CMS content models → Frontend, NOT Backend
  - Vercel/Netlify config → Frontend, NOT DevOps
  - Next.js API routes / webhooks → Frontend, NOT Backend
  - Prisma/Drizzle DB work → Frontend, NOT Backend (unless standalone API service)
  - 3rd-party SDK integrations (Stripe, Anthropic) → Frontend, NOT Backend
```

### 4. Sheet Template Fixes (RC4a + RC4b)

**4a — Preserve description row:**
- `buildEstimationRows`: change `currentSheetRow` start from `2` to `3`
- Clear range: change `A2:Z` to `A3:Z` (preserve rows 1-2)
- `requiredRows`: add +1 for description row (header + description + data + subtotals + summary)

**4b — Clear formatting in data range:**
- After `values.clear`, add a `batchUpdate` with `updateCells` clearing `userEnteredFormat` for `A3:I{existingRows}` to strip remnant template formatting

**4c — Subtotal row labels:**
- Write `"Subtotal"` in column B of each subtotal row

## Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 6 estimation quality issues by patching orchestrator prompt + sheet code.

**Architecture:** All prompt changes in the system prompt template string in `orchestrator.ts`. Sheet fixes in `google-workspace.ts` helper functions + tool handler. Tests in `google-workspace.test.ts`.

**Tech Stack:** TypeScript, Google Sheets API v4, Node test runner.

---

### Task 1: Add effort calibration ranges to orchestrator prompt

**Files:**
- Modify: `src/agents/orchestrator.ts:303-306` (after API Integrations block, before QA & Testing)

**Step 1: Add component library, page template, and migration ranges**

In `orchestrator.ts`, find the line `API Integrations:` block ending with `- CRM integration (read + write): 2-3 MD` and insert after it (before `QA & Testing:`):

```
Component Libraries & Page Templates:
- Component library from Figma: 1-2 MD for ≤10 components, 2-4 MD for 10-25, 4-6 MD for 25+.
  MUST state assumed count in assumptions (e.g., "~15 universal components from Figma").
  If Figma link is available, reference it in figma_link column.
- Page templates (unique layouts): 0.5-1 MD per unique template.
  Count distinct layouts (e.g., homepage, listing, detail, blog post = 4 templates).
  Repeated pages sharing the same template are NOT separate items.

Content & Data Migration:
- Blog post migration: 0.5-1 MD per content type (posts, categories, authors, tags).
  Add 0.5 MD if URL redirect mapping is needed.
- Static page migration: 0.25-0.5 MD per batch of similar pages.
- Data migration from legacy CMS: 1-3 MD depending on schema complexity and volume.
- ALWAYS check the RFP for existing content, pages, or data that must be preserved or migrated.
  Migration is commonly overlooked — treat it as a mandatory scope check.
```

**Step 2: Update webhook calibration with selection criteria**

Replace lines 343-344 (the WEBHOOK / CACHE INVALIDATION rule):

Old:
```
4. WEBHOOK / CACHE INVALIDATION: CMS webhook + cache invalidation is not trivial.
   1-2 MD for simple sites, 2-4 MD for complex setups.
```

New:
```
4. WEBHOOK / CACHE INVALIDATION: CMS webhook + cache invalidation is not trivial.
   1-2 MD for sites with ≤5 content types and no ISR/on-demand revalidation.
   2-4 MD for sites with 5+ content types, ISR, or multi-environment cache invalidation.
```

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (prompt is a string, no structural change)

**Step 4: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(est-quality-v2): add calibration ranges for components, migration, webhooks"
```

- [ ] Task 1 done

---

### Task 2: Replace team sizing block

**Files:**
- Modify: `src/agents/orchestrator.ts:256-260`

**Step 1: Replace the team sizing block**

Old (lines 256-260):
```
Team Sizing (AI-augmented):
- Simple (typically <100k EUR): 1 senior engineer + AI agent.
- Medium (typically 100-200k EUR): 1-2 senior engineers + designer.
- Complex (typically >200k EUR): 2-3 senior engineers + designer + QA.
- Never staff "just in case." Only add roles the scope demands.
```

New:
```
Team Sizing (AI-augmented):
- Simple (typically <100k EUR): 1 senior engineer + AI agent.
- Medium (typically 100-200k EUR):
  1 senior engineer + designer if total MD ≤ 50.
  2 senior engineers + designer if total MD > 50 or project has 3+ parallel workstreams.
- Complex (typically >200k EUR):
  2 senior engineers + designer + QA if total MD ≤ 120.
  3 senior engineers + designer + QA if total MD > 120 or tight deadline requires parallelism.
- Never staff "just in case." Only add roles the scope demands.
  Justify your team size in one line (e.g., "1 engineer — 35 MD, no parallel workstreams needed").
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(est-quality-v2): add MD thresholds to team sizing rules"
```

- [ ] Task 2 done

---

### Task 3: Replace type definition with classification guide

**Files:**
- Modify: `src/agents/orchestrator.ts:267-272`

**Step 1: Replace the type definition and example**

Old (lines 266-272):
```
For each item, also specify:
- type: "Frontend", "Backend", "Design", "QA", or "DevOps"
- optional: true if the item is a nice-to-have, false if required
- risk: "Low", "Medium", or "High" — affects the risk buffer column automatically
- assumptions: notes about what is assumed for this estimate
- figma_link: URL to relevant Figma frame/page, or empty string if none
Example: "Core Platform | CMS setup & content models (3 MD, Frontend, Low), Component library (5 MD, Frontend, Medium, ~15 components from Figma), ..."
```

New:
```
For each item, also specify:
- type: one of "Frontend", "Backend", "Design", "QA", or "DevOps"
  Classification guide:
  - Frontend: UI components, page templates, responsive design, client-side logic,
    CMS setup & content models (headless CMS like Contentful/Sanity/Storyblok),
    managed hosting (Vercel, Netlify), SSR/ISR/caching, API routes, webhooks,
    server-side logic within Next.js, database integration via ORMs (Prisma, Drizzle),
    authentication (NextAuth/Clerk), SEO/meta/sitemap,
    3rd-party SDK/API integrations (Anthropic, Stripe, HubSpot, etc.) via Next.js API routes.
  - Backend: ONLY for projects with custom cloud infrastructure (AWS, GCP, Azure) —
    standalone API services, microservices, custom servers outside of Next.js.
    If the project runs entirely on Next.js + managed hosting, there are NO Backend items.
    3rd-party SDK/API integrations handled via Next.js API routes are Frontend, NOT Backend.
  - Design: Figma design systems, UI/UX design, wireframes, prototyping.
  - QA: Test planning, manual/automated testing, cross-browser QA, performance testing.
  - DevOps: Custom infrastructure (k8s, Terraform, Docker), CI/CD pipelines,
    self-hosted environments, monitoring/alerting. NOT managed platforms like Vercel/Netlify.
  Common mistakes — do NOT make these:
  - CMS content models → Frontend, NOT Backend
  - Vercel/Netlify config → Frontend, NOT DevOps
  - Next.js API routes / webhooks → Frontend, NOT Backend
  - Prisma/Drizzle DB work → Frontend, NOT Backend (unless standalone API service)
  - 3rd-party SDK integrations (Stripe, Anthropic) → Frontend, NOT Backend
- optional: true if the item is a nice-to-have, false if required
- risk: "Low", "Medium", or "High" — affects the risk buffer column automatically
- assumptions: notes about what is assumed for this estimate
- figma_link: URL to relevant Figma frame/page, or empty string if none
Example: "Core Platform | CMS setup & content models (3 MD, Frontend, Low), Component library (5 MD, Frontend, Medium, ~15 components from Figma), ..."
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(est-quality-v2): add type classification guide with common mistakes"
```

- [ ] Task 3 done

---

### Task 4: Fix `buildEstimationRows` to start at row 3

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:1192`

**Step 1: Change start row from 2 to 3**

In `buildEstimationRows` (line 1192), change:
```typescript
  let currentSheetRow = 2;
```
to:
```typescript
  let currentSheetRow = 3; // Row 1 = header, Row 2 = column descriptions
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] Task 4 done

---

### Task 5: Fix sheet tool — adjust clear range, requiredRows, data write range

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:1329,1342,1365,1380`

**Step 1: Change clear range from A2 to A3**

Line 1329 — change:
```typescript
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${quotedTitle}!A2:Z${existingRows}`)}:clear`,
```
to:
```typescript
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${quotedTitle}!A3:Z${existingRows}`)}:clear`,
```

**Step 2: Add formatting clear after values clear**

After the clear block (after line 1339 `}`), insert:

```typescript
      // 3a. Clear formatting from data area to remove remnant template styles
      const clearFmtRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [{
              updateCells: {
                range: { sheetId: gid, startRowIndex: 2, endRowIndex: existingRows, startColumnIndex: 0, endColumnIndex: 9 },
                fields: "userEnteredFormat",
              },
            }],
          }),
        },
      );
      if (!clearFmtRes.ok) {
        const text = await clearFmtRes.text();
        return { content: [{ type: "text" as const, text: `Clear formatting error: ${text}` }] };
      }
```

**Step 3: Adjust requiredRows calculation**

Line 1342 — change:
```typescript
      const requiredRows = 1 + dataRows.length + subtotalPositions.length + 5;
```
to:
```typescript
      const requiredRows = 2 + dataRows.length + subtotalPositions.length + 5; // +2 for header + description rows
```

**Step 4: Adjust data write start row**

Line 1365 — change:
```typescript
      let sheetRow = 2;
```
to:
```typescript
      let sheetRow = 3;
```

Line 1380 — change:
```typescript
      const dataRange = `${quotedTitle}!A2:I${lastDataGridRow}`;
```
to:
```typescript
      const dataRange = `${quotedTitle}!A3:I${lastDataGridRow}`;
```

**Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 6: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "fix(est-quality-v2): preserve description row, clear remnant formatting"
```

- [ ] Task 5 done

---

### Task 6: Add "Subtotal" label to subtotal rows

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:1397-1401`

**Step 1: Add label to subtotal row**

Change the subtotal values (line 1397-1401):
```typescript
        const subtotalValues = [[
          "", "",
          `=SUM(C${sub.firstDataRow}:C${sub.lastDataRow})`,
          `=SUM(D${sub.firstDataRow}:D${sub.lastDataRow})`,
          "", "", "", "", "",
        ]];
```
to:
```typescript
        const subtotalValues = [[
          "", "Subtotal",
          `=SUM(C${sub.firstDataRow}:C${sub.lastDataRow})`,
          `=SUM(D${sub.firstDataRow}:D${sub.lastDataRow})`,
          "", "", "", "", "",
        ]];
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "fix(est-quality-v2): add Subtotal label to module subtotal rows"
```

- [ ] Task 6 done

---

### Task 7: Update tests for row offset and subtotal labels

**Files:**
- Modify: `src/mcp-servers/google-workspace.test.ts:479-577`

All `buildEstimationRows` tests need subtotal/data row numbers shifted by +1 (row 2→3 start).

**Step 1: Update single area test (line 493-496)**

Old:
```typescript
    assert.equal(subtotalPositions[0].sheetRow, 4);
    assert.equal(subtotalPositions[0].firstDataRow, 2);
    assert.equal(subtotalPositions[0].lastDataRow, 3);
```
New:
```typescript
    assert.equal(subtotalPositions[0].sheetRow, 5);
    assert.equal(subtotalPositions[0].firstDataRow, 3);
    assert.equal(subtotalPositions[0].lastDataRow, 4);
```

**Step 2: Update multiple areas test (line 546-551)**

Old:
```typescript
    assert.equal(subtotalPositions[0].sheetRow, 3);
    assert.equal(subtotalPositions[0].firstDataRow, 2);
    assert.equal(subtotalPositions[0].lastDataRow, 2);
    assert.equal(subtotalPositions[1].sheetRow, 6);
    assert.equal(subtotalPositions[1].firstDataRow, 4);
    assert.equal(subtotalPositions[1].lastDataRow, 5);
```
New:
```typescript
    assert.equal(subtotalPositions[0].sheetRow, 4);
    assert.equal(subtotalPositions[0].firstDataRow, 3);
    assert.equal(subtotalPositions[0].lastDataRow, 3);
    assert.equal(subtotalPositions[1].sheetRow, 7);
    assert.equal(subtotalPositions[1].firstDataRow, 5);
    assert.equal(subtotalPositions[1].lastDataRow, 6);
```

**Step 3: Run tests**

Run: `npm test`
Expected: all tests pass

**Step 4: Commit**

```bash
git add src/mcp-servers/google-workspace.test.ts
git commit -m "test(est-quality-v2): update row offsets for description row preservation"
```

- [ ] Task 7 done

---

### Task 8: Final verification

**Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 2: Full test suite**

Run: `npm test`
Expected: all tests pass

**Step 3: Update spec status**

Mark SPEC-042 as Implemented in `.ai/specs/README.md`.

- [ ] Task 8 done
