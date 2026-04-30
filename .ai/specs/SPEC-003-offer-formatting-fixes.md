# SPEC-003: Offer Formatting Fixes

**Status:** Planning
**Date:** 2026-03-01

---

## Design


**Date:** 2026-03-01
**Status:** Approved

## Problem

The latest Kotsovolos test-run offer has multiple formatting/readability issues:

1. Cover page shows literal `{{CLIENT_NAME}}`, `{{PROJECT_NAME}}`, `{{DATE}}` placeholders
2. All three tables (Risks, Timeline, Budget) have no header background colors or borders
3. Milestone items show literal `**bold**` markers instead of bold text
4. QA strategy list items also show literal `**bold**` markers
5. Risk table has trailing empty row
6. Dense wall-of-text paragraphs in Discovery/Development sections
7. All case study links point to generic URL

## Root Causes

### Code bug (MCP server)
- `google-workspace.ts` lines 576-590: `bullet_list`/`numbered_list` handler inserts raw text without calling `parseFormattedText()`. Paragraphs call it (line 530), lists don't.

### Agent behavior (prompt)
- Agent skips `docs_find_and_replace` calls for cover placeholders
- Agent doesn't pass `headerBackground`, `headerTextColor`, `borderColor` params to table sections
- Existing STYLING instructions are in a separate section from where tables are defined — agent doesn't connect them

## Solution: Approach C (MCP fix + prompt hardening + validation)

### Change 1: Fix bold/italic/color parsing in list items

**File:** `src/mcp-servers/google-workspace.ts`

Refactor the `bullet_list`/`numbered_list` case to:
1. Run each item through `parseFormattedText()`
2. Insert plain text (stripped of `**` markers)
3. Apply bold/italic/color formatting runs (same as paragraph handler)
4. Apply bullet preset after

### Change 2: Harden orchestrator prompt

**File:** `src/agents/orchestrator.ts`

- Move `docs_find_and_replace` to a MANDATORY numbered step with explicit "do not proceed until confirmed"
- Embed exact table styling params inline with each table instruction (Risks, Timeline, Budget)
- Remove reliance on agent connecting separate STYLING section to table definitions

### Change 3: Add validation checklist

**File:** `src/agents/orchestrator.ts`

Expand the existing REVIEW section with explicit checks:
- Cover page: `{{CLIENT_NAME}}` must NOT appear
- Tables: verify header row has orange background
- Lists: bold markers must render as bold, not literal asterisks
- Risks table: no empty trailing rows
- Milestones: each starts with bold name

---

## Implementation Plan


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all formatting and readability issues in generated Google Doc offers: cover page placeholders, table header styling, bold text in lists, and add a post-generation validation step.

**Architecture:** Three changes — (1) fix `parseFormattedText()` not being called in list handlers in the MCP server, (2) harden the orchestrator prompt to make placeholder replacement and table styling explicit, (3) add a validation checklist to the review step.

**Tech Stack:** TypeScript, Google Docs API (batchUpdate), Claude Agent SDK orchestrator prompt.

**Design doc:** `.ai/specs/SPEC-003-offer-formatting-fixes.md (Design section)`

---

### Task 1: Fix bold/italic/color parsing in list items

The `bullet_list`/`numbered_list` handler in `google-workspace.ts` inserts raw text without calling `parseFormattedText()`. This causes `**bold**` markers to appear as literal asterisks.

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:576-590`

**Step 1: Replace the list handler**

Replace lines 576-590 (the `case "bullet_list"` / `case "numbered_list"` block) with a version that parses formatted text per item, like the paragraph handler does.

Current code:
```typescript
      case "bullet_list":
      case "numbered_list": {
        const text = section.items.join("\n") + "\n";
        requests.push({ insertText: { location: { index: cursor }, text } });
        const preset = section.type === "bullet_list"
          ? "BULLET_DISC_CIRCLE_SQUARE"
          : "NUMBERED_DECIMAL_NESTED";
        requests.push({
          createParagraphBullets: {
            range: { startIndex: cursor, endIndex: cursor + text.length - 1 },
            bulletPreset: preset,
          },
        });
        cursor += text.length;
        break;
      }
```

New code:
```typescript
      case "bullet_list":
      case "numbered_list": {
        // Parse each item for **bold**, *italic*, ~~#HEX~~color~~ formatting
        const itemRuns = section.items.map((item) => parseFormattedText(item));
        const plainText = itemRuns.map((runs) => runs.map((r) => r.text).join("")).join("\n") + "\n";
        requests.push({ insertText: { location: { index: cursor }, text: plainText } });

        // Apply inline formatting (bold/italic/color) per item
        let offset = cursor;
        for (let i = 0; i < itemRuns.length; i++) {
          for (const run of itemRuns[i]) {
            if (run.bold || run.italic || run.color) {
              const style: Record<string, any> = {};
              const fields: string[] = [];
              if (run.bold) { style.bold = true; fields.push("bold"); }
              if (run.italic) { style.italic = true; fields.push("italic"); }
              if (run.color) {
                style.foregroundColor = { color: { rgbColor: hexToRgb(run.color) } };
                fields.push("foregroundColor");
              }
              requests.push({
                updateTextStyle: {
                  range: { startIndex: offset, endIndex: offset + run.text.length },
                  textStyle: style,
                  fields: fields.join(","),
                },
              });
            }
            offset += run.text.length;
          }
          // Account for the \n separator between items (not after last item — it's the trailing \n)
          offset += 1;
        }

        const preset = section.type === "bullet_list"
          ? "BULLET_DISC_CIRCLE_SQUARE"
          : "NUMBERED_DECIMAL_NESTED";
        requests.push({
          createParagraphBullets: {
            range: { startIndex: cursor, endIndex: cursor + plainText.length - 1 },
            bulletPreset: preset,
          },
        });
        cursor += plainText.length;
        break;
      }
```

**Step 2: Verify**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "fix(offer-formatting): parse bold/italic/color in list items"
```

- [ ] Done

---

### Task 2: Harden cover page placeholder replacement in orchestrator prompt

The agent skips `docs_find_and_replace` calls. Make the instruction non-skippable by marking it MANDATORY and adding a stronger directive.

**Files:**
- Modify: `src/agents/orchestrator.ts:225-233`

**Step 1: Replace the CREATION section opening**

Replace lines 225-233 (the CREATION steps 1 and 2) with:

```
CREATION:
1. Clone the offer template using docs_copy_template with template_id "${job.templateId ?? process.env.GDRIVE_TEMPLATE_ID ?? ""}"
   in the Output folder (folder ID: ${job.outputFolderId ?? "root"}).
   Title: "Offer - [Project Name] - [Date]"

2. MANDATORY — Fill cover page placeholders using docs_find_and_replace.
   You MUST make all three calls before writing any content. Do NOT proceed to step 3 until done:
   - Replace "{{CLIENT_NAME}}" with the client's company name
   - Replace "{{PROJECT_NAME}}" with the project name from the RFP
   - Replace "{{DATE}}" with today's date (format: DD Month YYYY)
```

Note: this is the same steps 1-2 but step 2 now starts with "MANDATORY" and has a "Do NOT proceed" directive.

**Step 2: Verify**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "fix(offer-formatting): make cover placeholder replacement mandatory in prompt"
```

- [ ] Done

---

### Task 3: Embed table styling params inline with each table instruction

The agent doesn't connect the STYLING section (lines 99-107) to the table definitions (lines 247, 259-260). Fix by putting the exact params right where each table is defined.

**Files:**
- Modify: `src/agents/orchestrator.ts:247, 259-260`

**Step 1: Update the Risks table instruction**

Replace line 247:
```
      - heading level 2: "Risks" + table (columns: Risk | Mitigation Approach — 4-6 rows)
```

With:
```
      - heading level 2: "Risks" + table (columns: Risk | Mitigation Approach — 4-6 rows,
          headerBackground: "#FD6027", headerTextColor: "#FFFFFF", borderColor: "#E6E8EB")
```

**Step 2: Update the Timeline table instruction**

Replace line 259:
```
      - heading level 2: "Timeline" + table (Phase | Duration | Key Deliverables)
```

With:
```
      - heading level 2: "Timeline" + table (Phase | Duration | Key Deliverables,
          headerBackground: "#FD6027", headerTextColor: "#FFFFFF", borderColor: "#E6E8EB")
```

**Step 3: Update the Budget table instruction**

Replace line 260:
```
      - heading level 2: "Budget" + table (Role | Rate | Time | Cost — with orange header + total row)
```

With:
```
      - heading level 2: "Budget" + table (Role | Rate | Time | Cost,
          headerBackground: "#FD6027", headerTextColor: "#FFFFFF", borderColor: "#E6E8EB",
          totalRowBackground: "#FD6027", totalRowTextColor: "#FFFFFF")
```

**Step 4: Verify**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "fix(offer-formatting): embed table styling params inline in prompt"
```

- [ ] Done

---

### Task 4: Add post-generation validation checklist

Expand the existing REVIEW section (lines 278-287) with explicit formatting validation checks that catch the issues we found.

**Files:**
- Modify: `src/agents/orchestrator.ts:278-287`

**Step 1: Replace the REVIEW section**

Replace lines 278-287 (from `REVIEW:` to `Post the Google Doc URL to Slack with a 2-line summary.`) with:

```
REVIEW:
Read back the document using docs_get_document. Check EVERY item below. If ANY check fails, fix it before posting the document link.

CONTENT CHECKS:
1. About Us — Company overview: Does it name specific credentials (Deloitte Fast 50, Vercel partner)? Does it list real clients? If it says "extensive experience" or "proven track record" — REWRITE IT.
2. Project Approach — Goals: Are there 5-7 concrete goals with bold key phrases? Are assumptions and risks specific to this project?
3. Risks table: Does every risk have a concrete mitigation approach? Are there 4-6 rows? Is there a trailing empty row? If so, remove it.
4. Budget table: Does every role have rate + hours + cost? Is there a total row? Is currency EUR?
5. Timeline: Does it include a buffer phase? Are milestones concrete deliverables?
6. Next Steps: Is there a concrete process to kick off? Are contact details right-aligned?

FORMATTING CHECKS:
7. Cover page: Search the document text for "{{". If ANY placeholder like {{CLIENT_NAME}}, {{PROJECT_NAME}}, or {{DATE}} still exists, run docs_find_and_replace to fix them NOW.
8. Tables: Verify all three tables (Risks, Timeline, Budget) have orange header backgrounds. If headers have no background color, rewrite the table with headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB".
9. Budget table: Verify the last row (Total) has an orange background. If not, rewrite with totalRowBackground "#FD6027", totalRowTextColor "#FFFFFF".

If ANY check fails, fix it before posting the document link.
Post the Google Doc URL to Slack with a 2-line summary.
```

**Step 2: Verify**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "fix(offer-formatting): add formatting validation checklist to review step"
```

- [ ] Done

---

### Task 5: Run a test to verify fixes

Run a test-run against the Kotsovolos RFP to verify all formatting fixes work end-to-end.

**Step 1: Build**

```bash
npm run build
```

**Step 2: Run the test**

```bash
npx tsx scripts/test-run.ts
```

**Step 3: Verify the generated doc**

Check the generated Google Doc for:
- Cover page: Client name, project name, and date are filled in (no `{{` placeholders)
- Tables: All three tables have orange (#FD6027) header row backgrounds with white text
- Budget table: Total row has orange background
- Milestones: Bold text renders as actual bold, not `**literal asterisks**`
- QA list: Same — bold renders correctly
- No trailing empty rows in tables

**Step 4: Commit if no further changes needed**

No code changes expected — this is verification only.

- [ ] Done

---

## Verification

After all tasks:

1. `npx tsc --noEmit` passes
2. Generated offers have filled cover page placeholders
3. All tables have orange header backgrounds and borders
4. Bold text in numbered/bullet lists renders as actual bold formatting
5. The REVIEW step catches and fixes any formatting issues the agent initially misses
