# SPEC-001: Offer Styling & Content Quality

**Status:** Implemented
**Date:** 2026-02-27
**Branch:** `feat/offer-styling-content-quality`

---

## Design


## Problem

Generated Google Doc offers have three deficiencies:
1. **No visual styling** — default Google Docs fonts/colors, no brand identity
2. **Generic content** — filler language, thin sections, tech-spec tone instead of sales-ready
3. **Empty knowledge base** — agent has no real past projects for RAG, so it can't cite specific metrics or case studies

## Solution Overview

| Track | Approach |
|-------|----------|
| Styling | Clone a branded Google Doc template (named styles handle fonts/colors). Expand MCP with table backgrounds, borders, alignment, font size, text color. |
| Content quality | Seed Pinecone with real past estimates. Tighten orchestrator prompt with word counts, anti-generic rules, few-shot examples, stronger review. |
| Style extraction | One-time script reads reference PDFs visually (Claude vision), extracts a style profile, and creates the template programmatically. User reviews/tweaks in Docs UI. |

---

## Extracted Style Profile

From 4 reference PDFs + Blazity Brand Guidelines PDF.

### Typography — Three-Font System

| Element | Font | Weight | Size | Color |
|---------|------|--------|------|-------|
| H1 (major sections) | JetBrains Mono | Regular | ~28pt | Coal `#181B20`. "Proposal" subtitle in Burnt Orange `#FD6027` |
| H2 (subsections) | Inter | Regular | ~20pt | Coal `#181B20` |
| H3 (sub-subsections) | Inter | Semi Bold | ~14pt | Coal `#181B20` |
| Body text | Inter | Regular | ~11pt | Coal `#181B20` |
| Bold emphasis | Inter | Bold | ~11pt | Coal or Burnt Orange for brand keywords |
| Orange brand emphasis | Inter | Bold+Underline | ~11pt | Burnt Orange `#FD6027` — "Blazity", "global leaders in React & Next.js development" |

Brand fonts per guidelines: **Manrope** (headers), **Inter** (body), **JetBrains Mono** (special/code). Proposals use JetBrains Mono for H1, Inter for H2/body. Manrope may be used for cover page titles.

### Colors (from Brand Guidelines — exact hex)

**Base Colors:**

| Name | Hex | RGB | Role |
|------|-----|-----|------|
| **Burnt Orange** | `#FD6027` | 253, 96, 39 | PRIMARY — table headers/totals, "Proposal" title, emphasis text, links |
| **Mariner** | `#3C43E7` | 60, 61, 231 | Secondary blue — links, accents |
| **Off White** | `#F9FAFB` | 249, 250, 251 | Secondary — light backgrounds |
| **Coal** | `#181B20` | 24, 27, 32 | Secondary — body text, dark backgrounds, headings |

**Extra Colors:**

| Name | Hex | Role |
|------|-----|------|
| Vibe Yellow | `#FFC800` | Extra accent |
| Sulu | `#BBED80` | CTA color (green) |

**Orange Shades:** 50: `#FFEFE9` · 100: `#FFDFD4` · 200: `#FECFBE` · 300: `#EBFA9` · 400: `#FEA07D` · 500: `#FD8052` · 600: `#FD6027`

**Blue Shades:** 50: `#ECECFD` · 100: `#D8D9FA` · 200: `#C5C7F8` · 300: `#B1B4F5` · 400: `#8A8EF1` · 500: `#6369EC` · 600: `#3C43E7`

**Neutral Shades:** Off White `#F9FAFB` → 100: `#F2F4F6` → 200: `#E6E8EB` → ... → Coal 900: `#181B20` → 1000: `#121418`

### Tables

- **Header row**: Solid Burnt Orange `#FD6027` background, white `#FFFFFF` bold text
- **Body rows**: White background, thin light borders (neutral ~`#E6E8EB`)
- **Total row**: Same Burnt Orange `#FD6027` background, white bold text — matches header
- **Alignment**: Left-aligned text, right-aligned numbers/currency
- **Typical columns**: Role | Cost/Rate | Time | Total

### Lists

- **Checkmark bullets**: Green checkmark ✅ emoji for key facts and team composition
- **Numbered lists**: Standard `1. 2. 3.` with bold label text (e.g., "**Knowledge Transfer** - description...")
- **Standard bullets**: Black disc for regular lists

### Layout

- **Cover page**: `[Client] & BLAZITY` in JetBrains Mono (Coal), subtitle in JetBrains Mono (Burnt Orange). Followed by table of contents.
- **Footer**: Blazity flame icon + "blazity" text bottom-left, page number bottom-right
- **Generous whitespace**: ~1.3 line height, ample section spacing
- **Page margins**: ~72pt (1 inch) all sides

### Content Structure (consistent across all 4 proposals)

1. Cover page with table of contents
2. **About Us** — Company overview, Our partners, Our clients, Relevant links
3. **Project Approach** — Goals, Assumptions, Risks, Delivery approach, Sprint-based development, Core tools, Team composition
4. **Building Blocks / Project Phases** — Engineering overview, technology options (with architecture diagrams), discovery/design phase, development phase with detailed milestone breakdown
5. **Development Timeline & Budget** — Team composition, Gantt-style timeline, Budget table (orange header+total)
6. **QA & Testing Strategy**, Additional costs
7. **Post-launch support** — Training, Continuous development
8. **Next Steps** — Closing paragraph + contact details (name, email, phone, right-aligned)

---

## 1. Template Creation

### Script: `scripts/create-template.ts`

One-time (re-runnable) script that creates a Google Doc template using the style profile above:

1. Creates a Google Doc via Docs API
2. Applies **named style overrides** via `updateDocumentStyle` + `updateNamedStyle`:
   - HEADING_1: JetBrains Mono, 28pt, Coal `#181B20`
   - HEADING_2: Inter, 20pt, Coal `#181B20`
   - HEADING_3: Inter Semi Bold, 14pt, Coal `#181B20`
   - NORMAL_TEXT: Inter, 11pt, Coal `#181B20`, line spacing 1.3
   This is the key mechanism: once named styles are set on the template, the agent's existing `namedStyleType: "HEADING_2"` automatically inherits all styling. Zero per-section font/color code needed.
3. Sets **page margins** (72pt all sides) via `updateDocumentStyle`
4. Creates **cover page** content:
   - `{{CLIENT_NAME}} & BLAZITY` in JetBrains Mono (Coal `#181B20`)
   - `Proposal` in JetBrains Mono (Burnt Orange `#FD6027`)
   - Placeholder tokens: `{{CLIENT_NAME}}`, `{{PROJECT_NAME}}`, `{{DATE}}`
   - Page break after cover
5. Creates **footer**: Blazity flame logo (inline image from Drive) + page number
6. Prints the template Doc URL and ID

**After running:** User reviews the template in Google Docs, tweaks anything, sets `GDRIVE_TEMPLATE_ID` in `.env`.

### Dependencies

- No new npm packages needed (pure Google Docs API calls + existing auth)
- No new OAuth scopes

---

## 2. MCP Styling Expansion

### New section properties

**Table:**
```typescript
{
  type: "table",
  headers: string[],
  rows: string[][],
  headerBackground?: string,  // hex, e.g. "#FD6027" (Blazity orange)
  headerTextColor?: string,   // hex, e.g. "#FFFFFF" (white text on orange)
  totalRowBackground?: string, // hex — same as header for Blazity style. Applied to LAST row.
  totalRowTextColor?: string,  // hex
  borderColor?: string,       // hex, e.g. "#E6E8EB"
}
```

**Paragraph:**
```typescript
{
  type: "paragraph",
  text: string,
  alignment?: "START" | "CENTER" | "END",
  fontSize?: number,  // pt
}
```

**Heading:**
```typescript
{
  type: "heading",
  level: 1 | 2 | 3,
  text: string,
  fontSize?: number,  // pt override (rarely used — named styles handle most cases)
}
```

**Text color runs (inline syntax extension):**

Extend `parseFormattedText()` to support `~~#HEX~~text~~` for colored text alongside existing `**bold**` and `*italic*`:

```
"Total project cost: ~~#4A90D9~~€127,500~~"
→ [
    { text: "Total project cost: " },
    { text: "€127,500", color: "#4A90D9" }
  ]
```

### Implementation details

**Table styling** — after `insertTable` and cell fill, add:
- `updateTableCellStyle` requests for header row cells: set `backgroundColor` from `headerBackground`
- `updateTableBorderStyle` for all table borders: set `color` from `borderColor`, `width: 0.5pt`, `dashStyle: SOLID`

**Paragraph alignment** — in `buildSimpleBatch`, after `insertText`, add:
- `updateParagraphStyle` with `alignment` field when property is present

**Font size** — in `buildSimpleBatch`, after `insertText`, add:
- `updateTextStyle` with `fontSize: { magnitude: N, unit: "PT" }` when property is present

**Text color** — in `buildSimpleBatch`, paragraph handling:
- `parseFormattedText` returns runs with optional `color` property
- `updateTextStyle` includes `foregroundColor` when run has color

### Schema update

Update the `docs_write_sections` tool's JSON schema (the `inputSchema` in the MCP tool definition) to include the new optional properties.

---

## 3. Orchestrator Flow Change

### Template clone

Replace:
```typescript
// Current
"Create a new Google Doc using docs_create_document..."
```

With:
```typescript
// New
"Clone the offer template using docs_copy_template with template_id ${templateId}
 in the Output folder (folder ID: ${outputFolderId}).
 Title: 'Offer - [Project Name] - [Date]'.
 The template includes a cover page with Blazity branding — do NOT add another cover page.
 Start writing sections after the existing cover page content (the tool appends automatically)."
```

### Cover page fill

The template has placeholder text on the cover page (e.g., `[PROJECT NAME]`, `[DATE]`, `[CLIENT NAME]`). The orchestrator prompt instructs the agent to:
1. After cloning, use `docs_find_and_replace` (if available) or a simple text replacement to fill cover page placeholders
2. Then proceed with `docs_write_sections` for the body

If `docs_find_and_replace` doesn't exist in the MCP, add it as a simple tool that wraps `replaceAllText` in the Docs batchUpdate API.

---

## 4. Knowledge Base Seeding

### Seed flow

Reference offer PDFs dropped into `past-estimates/` serve double duty:
1. **Template creation** — visual style extraction (one-time)
2. **RAG seeding** — text extraction for content reference (via existing `npm run seed`)

The existing `scripts/seed-knowledge-base.ts` already handles PDFs: `pdf-parse` extracts text, chunks at 800 words, embeds with `voyage-3`, stores in Pinecone.

No code changes needed — just run `npm run seed` after dropping PDFs.

### Impact on agent

With seeded knowledge base, the agent's `search_case_studies` tool returns real past projects. The orchestrator prompt already instructs the agent to cite specific clients and metrics — now it has real data to draw from instead of fabricating or using generic language.

---

## 5. Orchestrator Prompt Improvements

### Anti-generic rules

Add to OFFER WRITING STANDARDS:
```
CONTENT RULES:
- Every claim MUST cite a specific client name, metric, or project. Generic phrases
  like "extensive experience", "proven track record", "cutting-edge technology" are
  FORBIDDEN. If you cannot cite a specific example, omit the claim entirely.
- Numbers are persuasive. Include: team size, project duration, performance improvement %,
  cost savings, user growth, uptime SLA — wherever real data is available from case studies.
- Write for a C-level audience: lead with business outcomes, follow with technical approach.
  The reader cares about ROI, risk mitigation, and time-to-market — not framework features.
```

### Revised section order (matching reference proposals)

The reference proposals follow a different structure than the current agent output. Update the CREATION block to match:

```
DOCUMENT SECTIONS (in order, single docs_write_sections call):

a. heading level 1: "About Us" (Space Mono style — handled by template HEADING_1)
   - heading level 2: "Company overview" + paragraph (2-3 paragraphs: intro, specialization, key facts with ✅ bullets)
   - heading level 2: "Our partners" + paragraph (Vercel, Contentful, etc.)
   - heading level 2: "Our clients" + numbered_list (3-5 past clients with 2-3 sentence descriptions + case study links)
   - heading level 2: "Relevant links" + numbered_list (website, Clutch, GitHub, open-source projects)

b. heading level 1: "Project Approach"
   - heading level 2: "Goals" + numbered_list (5-7 concrete project goals, bold key phrases)
   - heading level 2: "Assumptions" + bullet_list (technical and scope assumptions)
   - heading level 2: "Risks" + table (columns: Risk | Mitigation Approach — 4-6 rows)
   - heading level 2: "Delivery approach" + paragraph (T&M model explanation)
   - heading level 2: "Sprint-based development" + paragraph (2-week sprints, key delivery elements with ✅ bullets)
   - heading level 2: "Core tools and their roles" + bullet_list (Slack, Google Drive, Jira, GitHub, Figma)
   - heading level 2: "Team composition" + paragraph (✅ bullet list of roles with allocation)

c. heading level 1: "Project Phases"
   - heading level 2: "Discovery/Design" + paragraphs (goals, activities, deliverables — 1-2 pages)
   - heading level 2: "Development" + paragraphs (technology choices with justification, architecture overview)
   - heading level 2: "Milestones" + numbered_list (detailed phase breakdown with durations)

d. heading level 1: "Development Timeline & Budget"
   - heading level 2: "Timeline" + table (Phase | Duration | Key Deliverables)
   - heading level 2: "Budget" + table (Role | Rate | Time | Cost — with orange header + total row)
   - heading level 2: "QA & Testing strategy" + paragraph + numbered_list
   - heading level 2: "Additional costs" + paragraph (infrastructure, tooling)

e. heading level 2: "Post-launch support"
   - heading level 3: "Training" + paragraph
   - heading level 3: "Continuous development" + paragraph + bullet_list

f. page_break

g. heading level 1: "Next Steps"
   - paragraph (closing — 2 paragraphs: process to start, thank you)
   - divider
   - paragraph (contact: name, email, phone — right-aligned)
```

### Word count targets

```
SECTION DEPTH:
- Company overview: 150-200 words. 2-3 paragraphs + key facts.
- Goals: 5-7 numbered items, each with bold keyword + 1-line description.
- Risks table: 4-6 rows, each with specific risk + concrete mitigation.
- Team composition: List each role with allocation and basis (full-time/part-time).
- Discovery/Design: 200-300 words. Concrete activities and deliverables.
- Development: 200-400 words. Technology justification + architecture.
- Milestones: Detailed breakdown, 1-2 sentences per milestone.
- Budget table: Rate per hour, total hours, per-role cost. Total row at bottom.
- Next Steps: 80-120 words. Concrete process to kick off.
```

### Few-shot examples

Extract 2-3 short excerpts from the reference offers (best Executive Summary, best "Why Us" paragraph, best Case Study) and embed inline:
```
EXAMPLE — Executive Summary (from [Client Name] offer):
"[Actual excerpt from reference offer — 3-4 sentences showing the right tone,
 specificity, and structure]"

Write in this style. Match this level of specificity and confidence.
```

These excerpts come from the PDFs during style extraction (step 1) — the script can extract both visual style AND text samples in one pass.

### Styling instructions

Embed the Blazity style values directly in the prompt:
```
STYLING:
When calling docs_write_sections, apply these formatting values:
- ALL tables: headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
- Pricing/Budget table: ALSO set totalRowBackground "#FD6027", totalRowTextColor "#FFFFFF" (total row matches header)
- Brand emphasis: use ~~#FD6027~~Blazity~~ for orange brand text
- Key metrics in case studies: **bold** (e.g., "**40% reduction in page load time**")
- Contact details on last page: alignment "END" (right-aligned)
- Use ✅ emoji as bullet prefix for key facts and team composition lists
- Section headings: do NOT set font/color — template named styles handle this automatically
```

### Stronger review

Replace the REVIEW block with:
```
REVIEW:
Read back the document using docs_get_document. Check EVERY section against these criteria:
1. Executive Summary: Does it name the client's specific challenge? Does it preview the solution approach? Does it include a budget range?
2. Why Blazity: Does it name a SPECIFIC past client? Does it include a NUMERIC metric? If it says "extensive experience" or "proven track record" — REWRITE IT.
3. Case Study: Are all metrics REAL (from search_case_studies)? Are metrics **bolded**?
4. Pricing: Does every phase have effort + rate + subtotal? Is there a total row? Is currency EUR?
5. Timeline: Does it include a buffer phase? Are milestones concrete deliverables?
6. Terms: Are payment terms specific (e.g., "30% upfront, 40% at milestone 2, 30% on delivery")?

If ANY section fails these checks, rewrite it before posting the document link.
```

---

## 6. New Tool: `docs_find_and_replace` (if needed)

If the MCP doesn't already expose `replaceAllText`, add a minimal tool:

```typescript
// Tool: docs_find_and_replace
// Input: { document_id, find: string, replace: string }
// Sends: batchUpdate with replaceAllText request
```

Used by the agent to fill cover page placeholders (`[PROJECT NAME]` → actual name, `[DATE]` → actual date, etc.) after cloning the template.

---

## Implementation Order

- [ ] **Task 1:** Add reference PDFs to `past-estimates/` and seed knowledge base (`npm run seed`)
- [ ] **Task 2:** Create `scripts/create-template.ts` — PDF visual extraction + template creation
- [ ] **Task 3:** Run template script, user reviews and sets `GDRIVE_TEMPLATE_ID`
- [ ] **Task 4:** Expand MCP — table `headerBackground`/`borderColor`, paragraph `alignment`/`fontSize`, text color runs
- [ ] **Task 5:** Add `docs_find_and_replace` tool to MCP (if not already present)
- [ ] **Task 6:** Update orchestrator — template clone flow, styling instructions, anti-generic rules, word counts, few-shot examples, stronger review
- [ ] **Task 7:** Full test run — generate an offer and compare against reference
- [ ] **Task 8:** Iterate on prompt/template based on output quality

## Files Modified

| File | Changes |
|------|---------|
| `scripts/create-template.ts` | New — style extraction + template creation |
| `src/agents/style-profile.json` | New — extracted style values (generated by script) |
| `src/mcp-servers/google-workspace.ts` | Expand section type schemas, add table styling, paragraph alignment, font size, text color parsing |
| `src/mcp-servers/google-workspace.test.ts` | Tests for new styling properties |
| `src/agents/orchestrator.ts` | Template clone flow, styling instructions, content rules, word counts, few-shot examples, review |
| `.env.example` | Document `GDRIVE_TEMPLATE_ID` |

## Dependencies

- No new npm packages for template creation (pure Docs API)
- No new OAuth scopes
- `pdf-parse` already handles PDF text extraction for seeding

---

## Implementation Plan


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make generated Google Doc offers match Blazity's reference proposals in both visual styling (branded fonts, colors, table formatting) and content quality (specific, persuasive, sales-ready).

**Architecture:** Clone a branded Google Doc template (named styles handle fonts/colors automatically), expand the MCP's `docs_write_sections` tool with table styling + paragraph formatting + text color, add a `docs_find_and_replace` tool for template placeholders, rewrite the orchestrator prompt to match reference proposal structure.

**Tech Stack:** Google Docs API (batchUpdate, named styles, table cell styles), existing MCP server, Zod schemas, node:test.

**Design doc:** `.ai/specs/SPEC-001-offer-styling-content-quality.md (Design section)` — read it fully before starting. It contains the complete brand style profile (fonts, hex colors, typography rules).

---

### Task 1: Extend `parseFormattedText` with color syntax

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts` (the `parseFormattedText` function, ~line 407-422)
- Test: `src/mcp-servers/google-workspace.test.ts`

Currently `parseFormattedText` handles `**bold**` and `*italic*`. We add `~~#HEX~~text~~` for colored text.

**Step 1: Write failing tests**

Add to the existing `describe("parseFormattedText()")` block in the test file:

```typescript
it("parses ~~#HEX~~colored~~ text", () => {
  const runs = parseFormattedText("price: ~~#FD6027~~€50,000~~");
  assert.equal(runs.length, 2);
  assert.equal(runs[0].text, "price: ");
  assert.equal(runs[1].text, "€50,000");
  assert.equal(runs[1].color, "#FD6027");
});

it("parses mixed bold and colored text", () => {
  const runs = parseFormattedText("**bold** and ~~#3C43E7~~blue~~");
  assert.equal(runs.length, 3);
  assert.equal(runs[0].text, "bold");
  assert.equal(runs[0].bold, true);
  assert.equal(runs[1].text, " and ");
  assert.equal(runs[2].text, "blue");
  assert.equal(runs[2].color, "#3C43E7");
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsc --noEmit && node --test dist/mcp-servers/google-workspace.test.js`
Expected: FAIL — `color` property doesn't exist on TextRun

**Step 3: Implement color parsing**

In `src/mcp-servers/google-workspace.ts`, update the `TextRun` type and `parseFormattedText`:

The `TextRun` type (find it near `parseFormattedText`) needs a `color?: string` field.

Update the regex in `parseFormattedText` to also match `~~#HEX~~text~~`:

```typescript
export function parseFormattedText(input: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(~~(#[0-9A-Fa-f]{6})~~(.+?)~~|\*\*(.+?)\*\*|\*(.+?)\*|([^*~]+|[*~]))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m[3] !== undefined && m[2] !== undefined) {
      runs.push({ text: m[3], color: m[2] });
    } else if (m[4] !== undefined) {
      runs.push({ text: m[4], bold: true });
    } else if (m[5] !== undefined) {
      runs.push({ text: m[5], italic: true });
    } else if (m[6] !== undefined) {
      runs.push({ text: m[6] });
    }
  }
  return runs;
}
```

In `buildSimpleBatch` paragraph handling (~line 501-523), where runs with `bold` or `italic` get `updateTextStyle`, add color support:

```typescript
if (run.bold || run.italic || run.color) {
  const style: Record<string, any> = {};
  const fields: string[] = [];
  if (run.bold) { style.bold = true; fields.push("bold"); }
  if (run.italic) { style.italic = true; fields.push("italic"); }
  if (run.color) {
    const hex = run.color.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    style.foregroundColor = { color: { rgbColor: { red: r, green: g, blue: b } } };
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
```

**Step 4: Run tests to verify they pass**

Run: `npx tsc --noEmit && node --test dist/mcp-servers/google-workspace.test.js`
Expected: ALL PASS

**Step 5: Commit**

```
feat(docs-styling): add ~~#HEX~~text~~ color syntax to parseFormattedText
```

---

### Task 2: Expand section schemas with styling properties

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts` (the Zod schema definitions, ~lines 346-395)

**Step 1: Update the Zod schemas**

Find the `sectionSchema` discriminated union (search for `z.discriminatedUnion`). Add optional properties:

**Table schema** — add after `rows`:
```typescript
headerBackground: z.string().optional().describe("Hex color for header row background, e.g. '#FD6027'"),
headerTextColor: z.string().optional().describe("Hex color for header row text, e.g. '#FFFFFF'"),
totalRowBackground: z.string().optional().describe("Hex color for last row background (total row)"),
totalRowTextColor: z.string().optional().describe("Hex color for last row text"),
borderColor: z.string().optional().describe("Hex color for table borders, e.g. '#E6E8EB'"),
```

**Paragraph schema** — add after `text`:
```typescript
alignment: z.enum(["START", "CENTER", "END"]).optional().describe("Paragraph alignment"),
fontSize: z.number().optional().describe("Font size in points"),
```

**Heading schema** — add after `text`:
```typescript
fontSize: z.number().optional().describe("Font size override in points"),
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors — the new optional fields flow through the `Section` inferred type)

**Step 3: Commit**

```
feat(docs-styling): add table/paragraph/heading styling properties to section schemas
```

---

### Task 3: Implement paragraph alignment and fontSize in `buildSimpleBatch`

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts` (`buildSimpleBatch`, ~line 466-610)
- Test: `src/mcp-servers/google-workspace.test.ts`

**Step 1: Write failing tests**

Add to `describe("buildSimpleBatch()")`:

```typescript
it("paragraph with alignment → correct updateParagraphStyle", () => {
  const { requests } = buildSimpleBatch(
    [{ type: "paragraph", text: "Centered", alignment: "CENTER" }],
    1, [0],
  );
  const alignStyle = requests.find(
    (r: any) => r.updateParagraphStyle?.paragraphStyle?.alignment,
  );
  assert.ok(alignStyle);
  assert.equal(alignStyle.updateParagraphStyle.paragraphStyle.alignment, "CENTER");
});

it("paragraph with fontSize → correct updateTextStyle", () => {
  const { requests } = buildSimpleBatch(
    [{ type: "paragraph", text: "Big", fontSize: 18 }],
    1, [0],
  );
  const fontStyle = requests.find(
    (r: any) => r.updateTextStyle?.textStyle?.fontSize,
  );
  assert.ok(fontStyle);
  assert.equal(fontStyle.updateTextStyle.textStyle.fontSize.magnitude, 18);
  assert.equal(fontStyle.updateTextStyle.textStyle.fontSize.unit, "PT");
});

it("heading with fontSize → correct updateTextStyle", () => {
  const { requests } = buildSimpleBatch(
    [{ type: "heading", level: 1, text: "Title", fontSize: 32 }],
    1, [0],
  );
  const fontStyle = requests.find(
    (r: any) => r.updateTextStyle?.textStyle?.fontSize,
  );
  assert.ok(fontStyle);
  assert.equal(fontStyle.updateTextStyle.textStyle.fontSize.magnitude, 32);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsc --noEmit && node --test dist/mcp-servers/google-workspace.test.js`
Expected: FAIL — alignment and fontSize not yet processed

**Step 3: Implement in `buildSimpleBatch`**

In the `case "paragraph"` block (~line 501), after the existing text style loop, add:

```typescript
// After the existing bold/italic/color style loop
if (section.alignment) {
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: cursor, endIndex: cursor + plainText.length },
      paragraphStyle: { alignment: section.alignment },
      fields: "alignment",
    },
  });
}
if (section.fontSize) {
  requests.push({
    updateTextStyle: {
      range: { startIndex: cursor, endIndex: cursor + plainText.length - 1 },
      textStyle: { fontSize: { magnitude: section.fontSize, unit: "PT" } },
      fields: "fontSize",
    },
  });
}
```

In the `case "heading"` block (~line 486), after the existing `updateParagraphStyle`, add:

```typescript
if (section.fontSize) {
  requests.push({
    updateTextStyle: {
      range: { startIndex: cursor, endIndex: cursor + text.length - 1 },
      textStyle: { fontSize: { magnitude: section.fontSize, unit: "PT" } },
      fields: "fontSize",
    },
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsc --noEmit && node --test dist/mcp-servers/google-workspace.test.js`
Expected: ALL PASS

**Step 5: Commit**

```
feat(docs-styling): implement paragraph alignment and fontSize overrides
```

---

### Task 4: Implement table styling (backgrounds, borders, text color)

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts` (`buildTableFillRequests` + `executeSections`, ~lines 642-776)
- Test: `src/mcp-servers/google-workspace.test.ts`

This is the most complex task. Table styling is applied AFTER cell text is filled, using the cell positions from the document structure read-back.

**Step 1: Write failing test for `buildTableFillRequests` with header text color**

`buildTableFillRequests` currently only bolds headers. Add white text color support. Add to `describe("buildTableFillRequests()")`:

```typescript
it("header text color → correct foregroundColor on header cells", () => {
  const cellPositions = [[5, 10]];
  const { requests } = buildTableFillRequests(
    ["A", "B"], [], cellPositions, { headerTextColor: "#FFFFFF" },
  );
  const colorStyles = requests.filter(
    (r: any) => r.updateTextStyle?.textStyle?.foregroundColor,
  );
  assert.equal(colorStyles.length, 2);
  assert.deepEqual(
    colorStyles[0].updateTextStyle.textStyle.foregroundColor,
    { color: { rgbColor: { red: 1, green: 1, blue: 1 } } },
  );
});

it("total row text color → correct foregroundColor on last row", () => {
  const cellPositions = [[5, 10], [20, 25]];
  const { requests } = buildTableFillRequests(
    ["A", "B"], [["x", "y"]], cellPositions, { totalRowTextColor: "#FFFFFF" },
  );
  const colorStyles = requests.filter(
    (r: any) => r.updateTextStyle?.textStyle?.foregroundColor,
  );
  // Only the last row (row index 1) gets color
  assert.equal(colorStyles.length, 2);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsc --noEmit && node --test dist/mcp-servers/google-workspace.test.js`
Expected: FAIL — `buildTableFillRequests` doesn't accept style options

**Step 3: Implement `buildTableFillRequests` styling**

Update the function signature to accept an optional style object:

```typescript
export function buildTableFillRequests(
  headers: string[],
  rows: string[][],
  cellPositions: number[][],
  style?: {
    headerTextColor?: string;
    totalRowTextColor?: string;
  },
): { requests: DocRequest[]; totalTextInserted: number }
```

Create a helper to parse hex to RGB object:

```typescript
function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    red: parseInt(h.substring(0, 2), 16) / 255,
    green: parseInt(h.substring(2, 4), 16) / 255,
    blue: parseInt(h.substring(4, 6), 16) / 255,
  };
}
```

Inside the cell loop, after inserting text, update the styling logic:

```typescript
const isHeaderRow = r === 0;
const isTotalRow = r === allData.length - 1 && r > 0;

// Bold for header row (existing)
if (isHeaderRow) {
  requests.push({
    updateTextStyle: {
      range: { startIndex: actualIdx, endIndex: actualIdx + text.length },
      textStyle: { bold: true },
      fields: "bold",
    },
  });
}

// Header text color
if (isHeaderRow && style?.headerTextColor) {
  requests.push({
    updateTextStyle: {
      range: { startIndex: actualIdx, endIndex: actualIdx + text.length },
      textStyle: { foregroundColor: { color: { rgbColor: hexToRgb(style.headerTextColor) } } },
      fields: "foregroundColor",
    },
  });
}

// Total row: bold + text color
if (isTotalRow && style?.totalRowTextColor) {
  requests.push({
    updateTextStyle: {
      range: { startIndex: actualIdx, endIndex: actualIdx + text.length },
      textStyle: {
        bold: true,
        foregroundColor: { color: { rgbColor: hexToRgb(style.totalRowTextColor) } },
      },
      fields: "bold,foregroundColor",
    },
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsc --noEmit && node --test dist/mcp-servers/google-workspace.test.js`
Expected: ALL PASS

**Step 5: Implement table cell background + border styling in `executeSections`**

In `executeSections`, in the table group handler (after the cell fill `sendBatchUpdate`), add background + border requests:

```typescript
// After cell fill sendBatchUpdate, before cursor advancement
const tableStyle = group.table;
const tableStyleRequests: DocRequest[] = [];

// Header row background
if (tableStyle.headerBackground) {
  const rgb = hexToRgb(tableStyle.headerBackground);
  for (let c = 0; c < cols; c++) {
    tableStyleRequests.push({
      updateTableCellStyle: {
        tableStartLocation: { index: tableInsertIdx },
        rowIndex: 0,
        columnIndex: c,
        tableCellStyle: {
          backgroundColor: { color: { rgbColor: rgb } },
        },
        fields: "backgroundColor",
      },
    });
  }
}

// Total row background (last row)
if (tableStyle.totalRowBackground && rowCount > 1) {
  const rgb = hexToRgb(tableStyle.totalRowBackground);
  for (let c = 0; c < cols; c++) {
    tableStyleRequests.push({
      updateTableCellStyle: {
        tableStartLocation: { index: tableInsertIdx },
        rowIndex: rowCount - 1,
        columnIndex: c,
        tableCellStyle: {
          backgroundColor: { color: { rgbColor: rgb } },
        },
        fields: "backgroundColor",
      },
    });
  }
}

// Table borders
if (tableStyle.borderColor) {
  const rgb = hexToRgb(tableStyle.borderColor);
  const border = {
    color: { color: { rgbColor: rgb } },
    width: { magnitude: 0.5, unit: "PT" },
    dashStyle: "SOLID",
  };
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < cols; c++) {
      tableStyleRequests.push({
        updateTableCellStyle: {
          tableStartLocation: { index: tableInsertIdx },
          rowIndex: r,
          columnIndex: c,
          tableCellStyle: {
            borderTop: border,
            borderBottom: border,
            borderLeft: border,
            borderRight: border,
          },
          fields: "borderTop,borderBottom,borderLeft,borderRight",
        },
      });
    }
  }
}

if (tableStyleRequests.length > 0) {
  await sendBatchUpdate(documentId, tableStyleRequests, token);
}
```

IMPORTANT: Use the **correct `tableStartLocation` index**. The `updateTableCellStyle` API uses `tableStartLocation` (not `tableInsertIdx` directly) — use the `tableEl.startIndex` from the document read-back, which is the actual table start position found via `>= tableInsertIdx`.

Also update the `buildTableFillRequests` call to pass style:

```typescript
const { requests, totalTextInserted } = buildTableFillRequests(
  group.table.headers, group.table.rows, cellPositions,
  {
    headerTextColor: group.table.headerTextColor,
    totalRowTextColor: group.table.totalRowTextColor,
  },
);
```

**Step 6: Run full tests**

Run: `npx tsc --noEmit && node --test dist/mcp-servers/google-workspace.test.js`
Expected: ALL PASS

**Step 7: Commit**

```
feat(docs-styling): implement table backgrounds, borders, and text colors
```

---

### Task 5: Add `docs_find_and_replace` tool

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts` (add new tool definition, after existing tools)

**Step 1: Add the tool**

Add a new `server.tool()` call after the existing `docs_write_sections` tool (before the `isTestRun` check at the end):

```typescript
server.tool(
  "docs_find_and_replace",
  "Find and replace text in a Google Doc. Useful for filling template placeholders.",
  {
    document_id: z.string().describe("The Google Doc document ID"),
    find: z.string().describe("Text to find (exact match)"),
    replace: z.string().describe("Replacement text"),
  },
  async ({ document_id, find, replace }) => {
    try {
      const token = await getAccessToken();
      const res = await fetch(
        `https://docs.googleapis.com/v1/documents/${document_id}:batchUpdate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requests: [{
              replaceAllText: {
                containsText: { text: find, matchCase: true },
                replaceText: replace,
              },
            }],
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: "text" as const, text: `Replace error: ${text}` }] };
      }
      const data = (await res.json()) as { replies: { replaceAllText: { occurrencesChanged: number } }[] };
      const changed = data.replies[0]?.replaceAllText?.occurrencesChanged ?? 0;
      return {
        content: [{
          type: "text" as const,
          text: `Replaced ${changed} occurrence(s) of "${find}" with "${replace}".`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
feat(docs-styling): add docs_find_and_replace tool for template placeholders
```

---

### Task 6: Create template script

**Files:**
- Create: `scripts/create-template.ts`

This script creates a branded Google Doc template with named styles, cover page placeholders, and footer. Read the full style profile in the design doc (`.ai/specs/SPEC-001-offer-styling-content-quality.md (Design section)`) for exact values.

**Step 1: Write the script**

Create `scripts/create-template.ts`:

```typescript
/**
 * Creates a branded Google Doc template with Blazity styling.
 *
 * Named styles (HEADING_1/2/3, NORMAL_TEXT) are configured with brand fonts/colors.
 * Cover page has placeholder tokens: {{CLIENT_NAME}}, {{PROJECT_NAME}}, {{DATE}}.
 *
 * Usage:
 *   npx tsx scripts/create-template.ts [--folder-id FOLDER_ID]
 *
 * After running, review the template in Google Docs and set GDRIVE_TEMPLATE_ID in .env.
 */
import "dotenv/config";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    red: parseInt(h.substring(0, 2), 16) / 255,
    green: parseInt(h.substring(2, 4), 16) / 255,
    blue: parseInt(h.substring(4, 6), 16) / 255,
  };
}

// Brand colors from docs/brand/Blazity Brand Guidelines.pdf
const BURNT_ORANGE = "#FD6027";
const COAL = "#181B20";

async function main() {
  const folderId = process.argv.find((a, i) => process.argv[i - 1] === "--folder-id")
    ?? process.env.GDRIVE_ROOT_FOLDER_ID
    ?? "root";

  const token = await getAccessToken();

  // 1. Create blank doc
  console.log("Creating blank Google Doc...");
  const createRes = await fetch(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Blazity Offer Template",
        mimeType: "application/vnd.google-apps.document",
        parents: [folderId],
      }),
    },
  );
  if (!createRes.ok) throw new Error(`Create error: ${await createRes.text()}`);
  const doc = (await createRes.json()) as { id: string };
  console.log(`Doc created: ${doc.id}`);

  // 2. Apply named styles + page margins + cover page content
  console.log("Applying brand styles...");

  const coal = hexToRgb(COAL);
  const orange = hexToRgb(BURNT_ORANGE);

  const requests: any[] = [
    // Page margins (72pt = 1 inch)
    {
      updateDocumentStyle: {
        documentStyle: {
          marginTop: { magnitude: 72, unit: "PT" },
          marginBottom: { magnitude: 72, unit: "PT" },
          marginLeft: { magnitude: 72, unit: "PT" },
          marginRight: { magnitude: 72, unit: "PT" },
        },
        fields: "marginTop,marginBottom,marginLeft,marginRight",
      },
    },
    // Named style: HEADING_1 — JetBrains Mono, 28pt, Coal
    {
      updateParagraphStyle: {
        range: { startIndex: 1, endIndex: 1 },
        paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
        fields: "namedStyleType",
      },
    },
  ];

  // Named style overrides
  const namedStyleRequests = {
    updateNamedStyle: {
      namedStyle: {
        namedStyleType: "HEADING_1",
        textStyle: {
          fontFamily: "JetBrains Mono",
          fontSize: { magnitude: 28, unit: "PT" },
          foregroundColor: { color: { rgbColor: coal } },
          bold: false,
        },
        paragraphStyle: {
          spaceAbove: { magnitude: 24, unit: "PT" },
          spaceBelow: { magnitude: 12, unit: "PT" },
          lineSpacing: 130,
        },
      },
      fields: "textStyle.fontFamily,textStyle.fontSize,textStyle.foregroundColor,textStyle.bold,paragraphStyle.spaceAbove,paragraphStyle.spaceBelow,paragraphStyle.lineSpacing",
    },
  };

  const h2Style = {
    updateNamedStyle: {
      namedStyle: {
        namedStyleType: "HEADING_2",
        textStyle: {
          fontFamily: "Inter",
          fontSize: { magnitude: 20, unit: "PT" },
          foregroundColor: { color: { rgbColor: coal } },
          bold: false,
        },
        paragraphStyle: {
          spaceAbove: { magnitude: 18, unit: "PT" },
          spaceBelow: { magnitude: 8, unit: "PT" },
          lineSpacing: 130,
        },
      },
      fields: "textStyle.fontFamily,textStyle.fontSize,textStyle.foregroundColor,textStyle.bold,paragraphStyle.spaceAbove,paragraphStyle.spaceBelow,paragraphStyle.lineSpacing",
    },
  };

  const h3Style = {
    updateNamedStyle: {
      namedStyle: {
        namedStyleType: "HEADING_3",
        textStyle: {
          fontFamily: "Inter",
          fontSize: { magnitude: 14, unit: "PT" },
          foregroundColor: { color: { rgbColor: coal } },
          bold: true,
        },
        paragraphStyle: {
          spaceAbove: { magnitude: 14, unit: "PT" },
          spaceBelow: { magnitude: 6, unit: "PT" },
          lineSpacing: 130,
        },
      },
      fields: "textStyle.fontFamily,textStyle.fontSize,textStyle.foregroundColor,textStyle.bold,paragraphStyle.spaceAbove,paragraphStyle.spaceBelow,paragraphStyle.lineSpacing",
    },
  };

  const normalStyle = {
    updateNamedStyle: {
      namedStyle: {
        namedStyleType: "NORMAL_TEXT",
        textStyle: {
          fontFamily: "Inter",
          fontSize: { magnitude: 11, unit: "PT" },
          foregroundColor: { color: { rgbColor: coal } },
        },
        paragraphStyle: {
          lineSpacing: 130,
          spaceAbove: { magnitude: 0, unit: "PT" },
          spaceBelow: { magnitude: 6, unit: "PT" },
        },
      },
      fields: "textStyle.fontFamily,textStyle.fontSize,textStyle.foregroundColor,paragraphStyle.lineSpacing,paragraphStyle.spaceAbove,paragraphStyle.spaceBelow",
    },
  };

  // Cover page content
  const coverText = "{{CLIENT_NAME}} & BLAZITY\nProposal\n\n{{PROJECT_NAME}}\n{{DATE}}\n";

  const allRequests = [
    ...requests,
    namedStyleRequests,
    h2Style,
    h3Style,
    normalStyle,
    // Insert cover page text
    { insertText: { location: { index: 1 }, text: coverText } },
    // Style "{{CLIENT_NAME}} & BLAZITY" line — JetBrains Mono, 28pt, Coal
    {
      updateTextStyle: {
        range: { startIndex: 1, endIndex: 1 + "{{CLIENT_NAME}} & BLAZITY".length },
        textStyle: {
          fontFamily: "JetBrains Mono",
          fontSize: { magnitude: 28, unit: "PT" },
          foregroundColor: { color: { rgbColor: coal } },
        },
        fields: "fontFamily,fontSize,foregroundColor",
      },
    },
    // Style "Proposal" line — JetBrains Mono, 28pt, Burnt Orange
    {
      updateTextStyle: {
        range: {
          startIndex: 1 + "{{CLIENT_NAME}} & BLAZITY\n".length,
          endIndex: 1 + "{{CLIENT_NAME}} & BLAZITY\nProposal".length,
        },
        textStyle: {
          fontFamily: "JetBrains Mono",
          fontSize: { magnitude: 28, unit: "PT" },
          foregroundColor: { color: { rgbColor: orange } },
        },
        fields: "fontFamily,fontSize,foregroundColor",
      },
    },
    // Page break after cover
    {
      insertPageBreak: {
        location: { index: 1 + coverText.length },
      },
    },
  ];

  const batchRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${doc.id}:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: allRequests }),
    },
  );
  if (!batchRes.ok) {
    const text = await batchRes.text();
    throw new Error(`batchUpdate failed: ${text}`);
  }

  console.log("\n✅ Template created!");
  console.log(`URL: https://docs.google.com/document/d/${doc.id}/edit`);
  console.log(`\nSet in .env:\n  GDRIVE_TEMPLATE_ID=${doc.id}`);
  console.log("\nReview the template in Google Docs and adjust styling if needed.");
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (script uses `dotenv/config` and `fetch`, no extra deps)

**Step 3: Commit**

```
feat(docs-styling): add template creation script with brand named styles
```

**Step 4: Run the script (requires user action)**

The user must run `npx tsx scripts/create-template.ts`, review the template, and set `GDRIVE_TEMPLATE_ID` in `.env`. This is a manual step — pause here and confirm with the user.

---

### Task 7: Update orchestrator prompt

**Files:**
- Modify: `src/agents/orchestrator.ts` (~lines 74-247)

This is a prompt-only change — no logic changes. Read the design doc section "5. Orchestrator Prompt Improvements" for the full content.

**Step 1: Update OFFER WRITING STANDARDS (~line 74)**

After the existing "Formatting:" line, add the CONTENT RULES and SECTION DEPTH blocks from the design doc. Also add the STYLING block with Blazity hex values.

**Step 2: Update CREATION block (~line 197)**

Replace the current `docs_create_document` instruction with template clone flow:

```
CREATION:
1. Clone the offer template using docs_copy_template with template_id "${job.templateId ?? env.GDRIVE_TEMPLATE_ID}"
   in the Output folder (folder ID: ${job.outputFolderId ?? "root"}).
   Title: "Offer - [Project Name] - [Date]"

2. Fill cover page placeholders using docs_find_and_replace:
   - Replace "{{CLIENT_NAME}}" with the client's company name
   - Replace "{{PROJECT_NAME}}" with the project name from the RFP
   - Replace "{{DATE}}" with today's date

3. Write the ENTIRE offer body in a SINGLE docs_write_sections call...
```

Then replace the section list (items a through l) with the full revised section order from the design doc (About Us → Project Approach → Project Phases → Development Timeline & Budget → Post-launch support → Next Steps).

**Step 3: Update REVIEW block (~line 230)**

Replace with the stronger review checklist from the design doc.

**Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```
feat(docs-styling): rewrite orchestrator prompt with brand styling, template clone, and content rules
```

---

### Task 8: Seed knowledge base

**Step 1: Run seed script**

Run: `npx tsx scripts/seed-knowledge-base.ts`

This processes the 4 PDFs in `past-estimates/` (Solkysten, Transnetyx, MIB, Speedgoat), extracts text, chunks, embeds with voyage-3, and stores in Pinecone.

Expected: Success messages for each PDF, chunks uploaded.

**Step 2: No commit needed** — this is a runtime data operation, not a code change.

---

### Task 9: Build verification

**Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: PASS — zero errors

**Step 2: Run all tests**

Run: `node --test dist/mcp-servers/google-workspace.test.js`
Expected: ALL PASS

**Step 3: Verify no references to old patterns**

Search for `docs_create_document` in `orchestrator.ts` — should NOT appear in the CREATION block (replaced by `docs_copy_template`).

Search for `buildBatchUpdateRequests` — should NOT exist anywhere.

**Step 4: Final commit if any cleanup needed**

```
chore(docs-styling): build verification and cleanup
```

---

## Implementation Order Summary

| Task | Description | Dependencies |
|------|-------------|-------------|
| 1 | `parseFormattedText` color syntax | None |
| 2 | Expand section Zod schemas | None |
| 3 | Paragraph alignment + fontSize | Task 1, 2 |
| 4 | Table styling (backgrounds, borders, text color) | Task 2 |
| 5 | `docs_find_and_replace` tool | None |
| 6 | Template creation script | None |
| 7 | Orchestrator prompt rewrite | Task 2, 4, 5 |
| 8 | Seed knowledge base | None (runtime) |
| 9 | Build verification | All above |

Tasks 1, 2, 5, 6, 8 can run in parallel. Tasks 3 and 4 depend on 1+2. Task 7 depends on 2+4+5. Task 9 is last.
