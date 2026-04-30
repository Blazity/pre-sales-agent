# SPEC-002: Google Slides Presentation

**Status:** Implemented
**Date:** 2026-02-28
**Branch:** `feat/presentation-slides`

---

## Design


## Problem

The current presentation pipeline uses Gamma's API (`POST /v1/generate/text`), which takes markdown + a theme name and returns an auto-generated deck. The output has no brand identity — no Blazity colors, no flame graphics, no layout control, no custom typography. The reference presentation (KTMxBlazity_Proposal_v3.pdf, 33 slides) is hand-crafted with custom graphics, multi-column layouts, Gantt charts, and pricing comparison blocks that Gamma cannot reproduce.

## Goal

Replace Gamma with Google Slides API to produce brand-matched presentations that are 80-90% ready to send. A human polishes the final 10-20% (diagram tweaks, copy refinement) before delivery.

## Approach: Template-First

A manually designed Google Slides template provides the visual foundation (master layouts with flame graphics, brand fonts, colors). A new MCP server copies the template and fills placeholders per-slide at runtime.

---

## 1. Google Slides Template (Manual, One-Time)

### 6 Master Layouts

| # | Layout Name | Background | Fixed Elements | Placeholders | Used For |
|---|-------------|-----------|----------------|--------------|----------|
| 1 | `COVER` | Coal `#181B20` | Large flame graphic (right), Blazity logo | `{{TITLE}}`, `{{SUBTITLE}}` | First slide only |
| 2 | `SECTION_DIVIDER` | Mariner blue `#3C43E7` | Orange circle accent (top-right), Blazity flame logo (bottom-right) | `{{TITLE}}` | Section transitions |
| 3 | `DARK_CONTENT` | Coal `#181B20` | Blazity logo (top-right), optional flame accent | `{{TITLE}}`, `{{BODY}}`, `{{CLIENT_LOGO}}` | Exec summary, why us, delivery, pricing summary |
| 4 | `LIGHT_CONTENT` | Off-white `#F9FAFB` | Blazity logo (top-right, orange) | `{{TITLE}}`, `{{BODY}}` | Scope, exclusions, architecture, tech options |
| 5 | `PRICING` | Coal `#181B20` | Blazity logo | `{{TITLE}}`, `{{CURRENT_COST}}`, `{{PROPOSED_COST}}`, `{{SAVINGS}}` | Budget comparison |
| 6 | `TIMELINE` | Coal `#181B20` | Blazity logo | `{{TITLE}}`, `{{GANTT_AREA}}`, `{{TOTAL_COST}}` | Timeline/Gantt slide |

### Typography (set in template)

| Element | Font | Weight | Size | Color |
|---------|------|--------|------|-------|
| Slide titles (DARK) | JetBrains Mono* | Regular | 36pt | White `#FFFFFF` |
| Slide titles (LIGHT) | JetBrains Mono* | Regular | 36pt | Coal `#181B20` |
| Section divider title | Inter | Medium | 64pt | White `#FFFFFF` |
| Body text (DARK) | Inter | Regular | 18pt | White `#FFFFFF` |
| Body text (LIGHT) | Inter | Regular | 18pt | Coal `#181B20` |
| Bold emphasis | Inter | Bold | 18pt | Same as body |
| Orange emphasis | Inter | Bold | 18pt | Burnt Orange `#FD6027` |
| Monospace labels | JetBrains Mono* | Regular | 24pt | Coal/White |

*JetBrains Mono may not be available in Google Slides. Fallback: use Roboto Mono or Space Mono for headings.

### Brand Graphics

- Flame graphics baked into master layouts for: COVER, SECTION_DIVIDER, DARK_CONTENT (optional accent)
- Uploaded to Drive as PNG/SVG, referenced by the template
- Client logo: agent finds URL via web search, MCP server inserts into `{{CLIENT_LOGO}}` placeholder area

### Setup Steps (manual)

1. Create the Google Slides presentation in the UI
2. Design the 6 master layouts with brand graphics, fonts, colors
3. Add named placeholder text boxes (`{{TITLE}}`, `{{BODY}}`, etc.)
4. Upload to a known Drive folder
5. Set `GSLIDES_TEMPLATE_ID` in `.env`

---

## 2. MCP Server: `google-slides.ts`

Replaces `src/mcp-servers/gamma.ts`.

### Tools

#### `create_presentation`
Creates a branded deck by copying the template.

```typescript
{
  title: z.string(),
  folder_id: z.string().optional()
}
// Returns: { presentation_id, url }
```

**Implementation**: Calls `drive.files.copy` on the template file, moves to `folder_id`, renames.

#### `add_slide`
Appends a slide using a named layout and fills text placeholders.

```typescript
{
  presentation_id: z.string(),
  layout: z.enum(["COVER", "SECTION_DIVIDER", "DARK_CONTENT", "LIGHT_CONTENT", "PRICING", "TIMELINE"]),
  title: z.string(),
  body: z.string().optional(),
  subtitle: z.string().optional(),
  notes: z.string().optional()
}
// Returns: { slide_id, slide_index }
```

**Implementation**:
1. Find the layout by name in the presentation's masters
2. `appendSlide` with `layoutReference` pointing to the matched layout
3. Find placeholder shapes on the new slide by matching `{{TITLE}}`, `{{BODY}}`, etc.
4. `replaceAllText` or `insertText` to fill placeholders
5. Parse body text for `**bold**` markers and apply bold text runs via `updateTextStyle`

#### `set_client_logo`
Places a client logo image on a specific slide.

```typescript
{
  presentation_id: z.string(),
  slide_index: z.number(),
  image_url: z.string()
}
// Returns: { success: boolean }
```

**Implementation**: Finds `{{CLIENT_LOGO}}` placeholder shape on the slide, calls `replaceAllShapesWithImage` with the URL.

#### `add_timeline_data`
Populates the timeline layout with phase data as colored bars.

```typescript
{
  presentation_id: z.string(),
  slide_index: z.number(),
  phases: z.array(z.object({
    name: z.string(),
    start_month: z.string(),
    end_month: z.string(),
    color: z.string()
  })),
  total_cost: z.string().optional()
}
// Returns: { success: boolean }
```

**Implementation**: Creates colored rectangle shapes positioned proportionally within the Gantt area. Adds text labels. Sets `{{TOTAL_COST}}` text.

#### `add_pricing_block`
Fills the pricing comparison layout.

```typescript
{
  presentation_id: z.string(),
  slide_index: z.number(),
  current_cost: z.string(),
  proposed_cost: z.string(),
  savings_percent: z.string()
}
// Returns: { success: boolean }
```

**Implementation**: Fills `{{CURRENT_COST}}`, `{{PROPOSED_COST}}`, `{{SAVINGS}}` placeholders with text.

### Auth

Same OAuth credentials as google-workspace MCP:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

Required scope: `https://www.googleapis.com/auth/presentations` (may need to be added to `get-google-token.ts`).

### Env Vars

- `GSLIDES_TEMPLATE_ID` — the template presentation ID

---

## 3. Orchestrator Changes

### MCP Server Config

Replace `gamma` MCP server entry with:

```typescript
"google-slides": {
  command: "node",
  args: [path.join(ROOT, "dist/mcp-servers/google-slides.js")],
  env: {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN!,
    GSLIDES_TEMPLATE_ID: process.env.GSLIDES_TEMPLATE_ID!,
  },
},
```

### Allowed Tools

Replace:
```
"mcp__gamma__create_presentation"
```

With:
```
"mcp__google-slides__create_presentation",
"mcp__google-slides__add_slide",
"mcp__google-slides__set_client_logo",
"mcp__google-slides__add_timeline_data",
"mcp__google-slides__add_pricing_block",
```

### Step 4 Prompt Rewrite

```
## Step 4: Create the Visual Presentation

1. Create a branded presentation using create_presentation.
   Title: "[Client] x Blazity — Initial Offer"
   Place it in the Output folder.

2. Search for the client's logo online using fetch_web_page on their website.
   Extract the logo image URL (prefer PNG/SVG on transparent or white background).

3. Build the deck using add_slide calls in this order.
   Choose the layout that matches each slide's purpose:

   SLIDE 1 — layout: COVER
     title: "[Client] x Blazity"
     subtitle: "Initial Offer"

   SLIDE 2 — layout: DARK_CONTENT
     title: "Executive Summary"
     body: 2-3 sentence project summary + 4-5 bullet pain points (bold key phrases)
     → Then call set_client_logo to place client logo on this slide

   SLIDE 3 — layout: DARK_CONTENT
     title: "Our understanding of [Client]'s goals, constraints, and risks"
     body: 3-4 key goals/constraints with bold emphasis, each 1-2 lines

   SLIDE 4 — layout: DARK_CONTENT
     title: "Why Blazity is a good fit"
     body: 5 numbered points (quality, experience, portfolio, Vercel certified, proactive)

   SLIDE 5 — layout: SECTION_DIVIDER
     title: "Scope Definition & Assumptions"

   SLIDES 6-8 — layout: LIGHT_CONTENT (1-3 slides based on scope size)
     "What's included in scope"
     Each item: bold title + 2-3 sentence description. Max 3 items per slide.

   SLIDE N — layout: LIGHT_CONTENT
     title: "What is explicitly excluded or assumed"
     body: exclusions with bold title + description

   SLIDE N+1 — layout: SECTION_DIVIDER
     title: "Delivery approach, role description & tooling"

   SLIDE N+2 — layout: DARK_CONTENT
     title: "Virtual team organization & delivery approach"
     body: operational principles with bold key phrases

   SLIDE N+3 — layout: DARK_CONTENT
     title: "Sprint-based development & core tools"

   SLIDE N+4 — layout: SECTION_DIVIDER
     title: "Platform & Architecture Overview"

   SLIDES N+5..N+6 — layout: LIGHT_CONTENT (1-2 slides)
     Technology recommendations (framework, CMS, hosting)

   SLIDE N+7 — layout: SECTION_DIVIDER
     title: "Estimation & pricing structure"

   SLIDE N+8 — layout: TIMELINE
     → Call add_timeline_data with project phases and colors

   SLIDE N+9 — layout: PRICING
     → Call add_pricing_block with cost comparison

   OPTIONAL — layout: SECTION_DIVIDER
     title: "Technical assumptions" (only for complex projects)

   OPTIONAL — layout: LIGHT_CONTENT
     Detailed assumptions

   LAST SLIDE — layout: DARK_CONTENT
     title: "Next Steps"
     body: 3-4 concrete next actions + contact info

CONTENT RULES FOR SLIDES:
- MAX 6 bullet points per slide. If a section needs more, split across slides.
- MAX 40 words per bullet point. Slides are visual — not documents.
- Bold the key phrase in each bullet (first 3-5 words).
- Use concrete numbers, not adjectives. "8+ years" not "extensive experience".
- Section divider slides have NO body text — just the section title.
- Target 12-20 slides total depending on project complexity.

4. Post the Google Slides URL to Slack with a 1-line summary.
```

---

## 4. Files Changed

| File | Change |
|------|--------|
| `src/mcp-servers/gamma.ts` | **Delete** |
| `src/mcp-servers/google-slides.ts` | **New** — 5 tools for Google Slides generation |
| `src/agents/orchestrator.ts` | **Modify** — Step 4 rewrite, MCP config, allowed tools |
| `.env.example` | **Modify** — add `GSLIDES_TEMPLATE_ID`, remove `GAMMA_API_KEY` |
| `scripts/get-google-token.ts` | **Modify** — add `presentations` scope if missing |

### Not in code scope (manual one-time)

- Design and create the Google Slides template with 6 master layouts
- Upload flame graphics to Drive
- Set `GSLIDES_TEMPLATE_ID` in `.env`
- Re-run `scripts/get-google-token.ts` if presentations scope was missing

---

## 5. Implementation Order

- [ ] **Task 1**: Check OAuth scopes — verify `presentations` scope is included, add if needed
- [ ] **Task 2**: Create `src/mcp-servers/google-slides.ts` — auth helper, `create_presentation` tool
- [ ] **Task 3**: Add `add_slide` tool — layout matching, placeholder fill, bold text parsing
- [ ] **Task 4**: Add `set_client_logo` tool — image replacement
- [ ] **Task 5**: Add `add_timeline_data` tool — Gantt bar generation
- [ ] **Task 6**: Add `add_pricing_block` tool — pricing placeholder fill
- [ ] **Task 7**: Delete `src/mcp-servers/gamma.ts`
- [ ] **Task 8**: Update orchestrator — MCP config, allowed tools, Step 4 prompt rewrite
- [ ] **Task 9**: Update `.env.example`
- [ ] **Task 10**: Manual — create Google Slides template, set env var
- [ ] **Task 11**: End-to-end test — run estimation workflow, verify presentation output
- [ ] **Task 12**: Iterate on prompt/template based on output quality

## Dependencies

- Google Slides API (REST) — no npm package needed beyond `googleapis` if we want it, but raw fetch works fine (matching the pattern of the existing MCP servers)
- No new OAuth scopes beyond `presentations` (already using `drive` and `documents`)
- The Google Slides template must be created manually before Task 11

---

## Implementation Plan


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Gamma MCP server with a Google Slides MCP server that produces brand-matched Blazity presentations from a pre-designed template.

**Architecture:** A new MCP server (`google-slides.ts`) copies a branded Google Slides template and fills slides via the Slides REST API. The orchestrator's Step 4 prompt is rewritten to call slide-by-slide tools instead of one markdown dump. The template (manual, one-time) provides 6 master layouts with flame graphics, brand fonts, and colors.

**Tech Stack:** Google Slides REST API (raw fetch, no SDK), Zod schemas, MCP SDK stdio transport. Same OAuth flow as `google-workspace.ts`.

**Design doc:** `.ai/specs/SPEC-002-presentation-google-slides.md (Design section)`

---

### Task 1: Add `presentations` OAuth scope

**Files:**
- Modify: `scripts/get-google-token.ts:11-15`
- Modify: `.env.example:22-23`

**Step 1: Add the presentations scope**

In `scripts/get-google-token.ts`, add the Slides scope to the SCOPES array:

```typescript
const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
].join(" ");
```

**Step 2: Update `.env.example`**

Replace the Gamma section and add Slides template ID:

```bash
# Google Slides
GSLIDES_TEMPLATE_ID=...   # Google Slides template ID for branded presentations

# Gamma (removed — replaced by Google Slides)
# GAMMA_API_KEY=...
```

**Step 3: Commit**

```bash
git add scripts/get-google-token.ts .env.example
git commit -m "feat(presentation-slides): add presentations OAuth scope, replace Gamma env var"
```

- [ ] Done

---

### Task 2: Create `google-slides.ts` — auth helper + `create_presentation` tool

**Files:**
- Create: `src/mcp-servers/google-slides.ts`

**Step 1: Write the MCP server skeleton with auth and `create_presentation`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "dotenv";
config();

const TEMPLATE_ID = process.env.GSLIDES_TEMPLATE_ID!;
const SLIDES_API = "https://slides.googleapis.com/v1/presentations";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

// ── Token cache (same pattern as google-workspace.ts) ────────────────────────
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function slidesApi(presentationId: string, path: string, method = "GET", body?: unknown) {
  const token = await getAccessToken();
  const url = `${SLIDES_API}/${presentationId}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Slides API ${method} ${path}: ${res.status} ${text}`);
  }
  return res.json();
}

async function driveApi(path: string, method = "GET", body?: unknown) {
  const token = await getAccessToken();
  const url = `${DRIVE_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API ${method} ${path}: ${res.status} ${text}`);
  }
  return res.json();
}

// ── Layout matching ─────────────────────────────────────────────────────────

const LAYOUT_NAMES = ["COVER", "SECTION_DIVIDER", "DARK_CONTENT", "LIGHT_CONTENT", "PRICING", "TIMELINE"] as const;
type LayoutName = (typeof LAYOUT_NAMES)[number];

interface LayoutInfo {
  objectId: string;
  name: string;
}

async function getLayouts(presentationId: string): Promise<Map<LayoutName, LayoutInfo>> {
  const pres = await slidesApi(presentationId, "");
  const layouts = new Map<LayoutName, LayoutInfo>();

  for (const layout of pres.layouts ?? []) {
    const name = layout.layoutProperties?.displayName ?? "";
    if (LAYOUT_NAMES.includes(name as LayoutName)) {
      layouts.set(name as LayoutName, {
        objectId: layout.objectId,
        name,
      });
    }
  }

  return layouts;
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({ name: "google-slides", version: "1.0.0" });

server.tool(
  "create_presentation",
  "Copy the branded Blazity presentation template. Returns the new presentation ID and URL.",
  {
    title: z.string().describe("Presentation title, e.g. 'ClientName x Blazity — Initial Offer'"),
    folder_id: z.string().optional().describe("Google Drive folder ID to place the copy in"),
  },
  async ({ title, folder_id }) => {
    try {
      const copied = (await driveApi(`/${TEMPLATE_ID}/copy`, "POST", { name: title })) as {
        id: string;
        name: string;
      };

      if (folder_id) {
        const token = await getAccessToken();
        // Get current parents
        const fileRes = await fetch(`${DRIVE_API}/${copied.id}?fields=parents`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const file = (await fileRes.json()) as { parents?: string[] };
        const prevParent = file.parents?.[0] ?? "";

        // Move to target folder
        await fetch(
          `${DRIVE_API}/${copied.id}?addParents=${folder_id}&removeParents=${prevParent}`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}` },
          }
        );
      }

      const url = `https://docs.google.com/presentation/d/${copied.id}/edit`;
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Presentation created!\nID: ${copied.id}\nURL: ${url}\nTitle: ${title}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error creating presentation: ${String(err)}` }],
      };
    }
  }
);

// Server startup (skip during tests)
const isTestRun = process.env.NODE_TEST_CONTEXT !== undefined || process.argv[1]?.includes("test");
if (!isTestRun) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { getLayouts, getAccessToken, slidesApi, driveApi };
```

**Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/mcp-servers/google-slides.ts
git commit -m "feat(presentation-slides): add google-slides MCP server with create_presentation"
```

- [ ] Done

---

### Task 3: Add `add_slide` tool

**Files:**
- Modify: `src/mcp-servers/google-slides.ts`

**Step 1: Add the bold text parser helper**

Add this before the server definition:

```typescript
// ── Text formatting ─────────────────────────────────────────────────────────

interface TextRun {
  text: string;
  bold?: boolean;
}

export function parseBoldText(input: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: input.slice(lastIndex, match.index) });
    }
    runs.push({ text: match[1], bold: true });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < input.length) {
    runs.push({ text: input.slice(lastIndex) });
  }

  return runs.length ? runs : [{ text: input }];
}
```

**Step 2: Add the `add_slide` tool**

Add after the `create_presentation` tool:

```typescript
server.tool(
  "add_slide",
  "Append a slide using a named layout from the branded template. Fill title and body placeholders. Body supports **bold** markers.",
  {
    presentation_id: z.string().describe("The presentation ID returned by create_presentation"),
    layout: z.enum(LAYOUT_NAMES).describe("Layout name: COVER, SECTION_DIVIDER, DARK_CONTENT, LIGHT_CONTENT, PRICING, TIMELINE"),
    title: z.string().describe("Slide title text"),
    body: z.string().optional().describe("Slide body text. Use **bold** for emphasis. Use \\n for line breaks."),
    subtitle: z.string().optional().describe("Subtitle text (COVER layout only)"),
    notes: z.string().optional().describe("Speaker notes"),
  },
  async ({ presentation_id, layout, title, body, subtitle, notes }) => {
    try {
      const layouts = await getLayouts(presentation_id);
      const layoutInfo = layouts.get(layout);
      if (!layoutInfo) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Layout "${layout}" not found. Available: ${[...layouts.keys()].join(", ")}. Make sure the template has layouts named exactly: ${LAYOUT_NAMES.join(", ")}`,
            },
          ],
        };
      }

      // Generate a unique ID for the new slide
      const slideId = `slide_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Create the slide with the specified layout
      const createRequests: unknown[] = [
        {
          createSlide: {
            objectId: slideId,
            slideLayoutReference: { layoutId: layoutInfo.objectId },
          },
        },
      ];

      await slidesApi(presentation_id, ":batchUpdate", "POST", { requests: createRequests });

      // Get the new slide to find placeholder shapes
      const pres = (await slidesApi(presentation_id, "")) as {
        slides: Array<{
          objectId: string;
          pageElements?: Array<{
            objectId: string;
            shape?: {
              placeholder?: { type: string };
              text?: { textElements?: Array<{ textRun?: { content: string } }> };
            };
          }>;
        }>;
      };

      const slide = pres.slides.find((s) => s.objectId === slideId);
      if (!slide) throw new Error("New slide not found after creation");

      // Build replacement requests
      const updateRequests: unknown[] = [];

      for (const el of slide.pageElements ?? []) {
        const placeholderType = el.shape?.placeholder?.type;
        const currentText = el.shape?.text?.textElements
          ?.map((te) => te.textRun?.content ?? "")
          .join("")
          .trim();

        // Match placeholders by type or by placeholder text content
        if (
          placeholderType === "TITLE" ||
          placeholderType === "CENTERED_TITLE" ||
          currentText?.includes("{{TITLE}}")
        ) {
          updateRequests.push({
            deleteText: { objectId: el.objectId, textRange: { type: "ALL" } },
          });
          updateRequests.push({
            insertText: { objectId: el.objectId, text: title, insertionIndex: 0 },
          });
        } else if (
          placeholderType === "SUBTITLE" ||
          currentText?.includes("{{SUBTITLE}}")
        ) {
          if (subtitle) {
            updateRequests.push({
              deleteText: { objectId: el.objectId, textRange: { type: "ALL" } },
            });
            updateRequests.push({
              insertText: { objectId: el.objectId, text: subtitle, insertionIndex: 0 },
            });
          }
        } else if (
          placeholderType === "BODY" ||
          currentText?.includes("{{BODY}}")
        ) {
          if (body) {
            updateRequests.push({
              deleteText: { objectId: el.objectId, textRange: { type: "ALL" } },
            });

            // Insert text and apply bold formatting
            const fullText = body.replace(/\\n/g, "\n");
            updateRequests.push({
              insertText: { objectId: el.objectId, text: fullText, insertionIndex: 0 },
            });

            // Apply bold to **...** segments
            const runs = parseBoldText(fullText);
            let offset = 0;
            for (const run of runs) {
              if (run.bold) {
                updateRequests.push({
                  updateTextStyle: {
                    objectId: el.objectId,
                    textRange: {
                      type: "FIXED_RANGE",
                      startIndex: offset,
                      endIndex: offset + run.text.length,
                    },
                    style: { bold: true },
                    fields: "bold",
                  },
                });
              }
              offset += run.text.length;
            }
          }
        }
      }

      // Add speaker notes if provided
      if (notes) {
        updateRequests.push({
          insertText: {
            objectId: `${slideId}_notes`,
            text: notes,
            insertionIndex: 0,
          },
        });
      }

      if (updateRequests.length > 0) {
        await slidesApi(presentation_id, ":batchUpdate", "POST", { requests: updateRequests });
      }

      const slideIndex = pres.slides.findIndex((s) => s.objectId === slideId);
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Slide added: "${title}" (layout: ${layout}, index: ${slideIndex})`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error adding slide: ${String(err)}` }],
      };
    }
  }
);
```

**Step 3: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/mcp-servers/google-slides.ts
git commit -m "feat(presentation-slides): add add_slide tool with bold text parsing"
```

- [ ] Done

---

### Task 4: Add `set_client_logo` tool

**Files:**
- Modify: `src/mcp-servers/google-slides.ts`

**Step 1: Add the tool**

Add after `add_slide`:

```typescript
server.tool(
  "set_client_logo",
  "Place a client logo image on a specific slide. The image replaces the {{CLIENT_LOGO}} placeholder or is inserted in the top-right area.",
  {
    presentation_id: z.string().describe("The presentation ID"),
    slide_index: z.number().int().min(0).describe("Zero-based slide index"),
    image_url: z.string().url().describe("Public URL of the client logo image (PNG, JPG, or SVG)"),
  },
  async ({ presentation_id, slide_index, image_url }) => {
    try {
      const pres = (await slidesApi(presentation_id, "")) as {
        slides: Array<{
          objectId: string;
          pageElements?: Array<{
            objectId: string;
            shape?: {
              text?: { textElements?: Array<{ textRun?: { content: string } }> };
            };
          }>;
        }>;
      };

      if (slide_index >= pres.slides.length) {
        return {
          content: [{ type: "text" as const, text: `Error: slide_index ${slide_index} out of range (${pres.slides.length} slides)` }],
        };
      }

      const slide = pres.slides[slide_index];
      const requests: unknown[] = [];

      // Look for a {{CLIENT_LOGO}} placeholder shape
      let logoPlaceholder: string | null = null;
      for (const el of slide.pageElements ?? []) {
        const text = el.shape?.text?.textElements
          ?.map((te) => te.textRun?.content ?? "")
          .join("")
          .trim();
        if (text?.includes("{{CLIENT_LOGO}}")) {
          logoPlaceholder = el.objectId;
          break;
        }
      }

      if (logoPlaceholder) {
        // Replace the placeholder shape with the image
        requests.push({
          replaceAllShapesWithImage: {
            imageUrl: image_url,
            imageReplaceMethod: "CENTER_INSIDE",
            containsText: { text: "{{CLIENT_LOGO}}", matchCase: true },
            pageObjectIds: [slide.objectId],
          },
        });
      } else {
        // No placeholder found — insert image in bottom-right area
        const imageId = `logo_${Date.now()}`;
        requests.push({
          createImage: {
            objectId: imageId,
            url: image_url,
            elementProperties: {
              pageObjectId: slide.objectId,
              size: {
                width: { magnitude: 1200000, unit: "EMU" },  // ~1.33 inches
                height: { magnitude: 800000, unit: "EMU" },   // ~0.89 inches
              },
              transform: {
                scaleX: 1,
                scaleY: 1,
                translateX: 7200000, // ~8 inches from left (right side)
                translateY: 3800000, // ~4.2 inches from top (bottom area)
                unit: "EMU",
              },
            },
          },
        });
      }

      await slidesApi(presentation_id, ":batchUpdate", "POST", { requests });

      return {
        content: [{ type: "text" as const, text: `✅ Client logo placed on slide ${slide_index}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error placing logo: ${String(err)}` }],
      };
    }
  }
);
```

**Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/mcp-servers/google-slides.ts
git commit -m "feat(presentation-slides): add set_client_logo tool"
```

- [ ] Done

---

### Task 5: Add `add_timeline_data` tool

**Files:**
- Modify: `src/mcp-servers/google-slides.ts`

**Step 1: Add the tool**

Add after `set_client_logo`:

```typescript
server.tool(
  "add_timeline_data",
  "Populate a TIMELINE layout slide with project phases as colored horizontal bars (Gantt-style). Also sets the total cost text.",
  {
    presentation_id: z.string().describe("The presentation ID"),
    slide_index: z.number().int().min(0).describe("Zero-based slide index of the TIMELINE slide"),
    phases: z
      .array(
        z.object({
          name: z.string().describe("Phase name, e.g. 'Discovery & Architecture'"),
          start_month: z.string().describe("Start month, e.g. 'Feb'"),
          end_month: z.string().describe("End month, e.g. 'April'"),
          color: z.string().describe("Hex color for the bar, e.g. '#FD6027'"),
        })
      )
      .describe("Project phases in chronological order"),
    total_cost: z.string().optional().describe("Total cost string, e.g. '254 000 EUR'"),
  },
  async ({ presentation_id, slide_index, phases, total_cost }) => {
    try {
      const pres = (await slidesApi(presentation_id, "")) as {
        slides: Array<{
          objectId: string;
          pageElements?: Array<{
            objectId: string;
            size?: { width?: { magnitude: number }; height?: { magnitude: number } };
            transform?: { translateX?: number; translateY?: number; scaleX?: number; scaleY?: number };
            shape?: { text?: { textElements?: Array<{ textRun?: { content: string } }> } };
          }>;
        }>;
      };

      if (slide_index >= pres.slides.length) {
        return {
          content: [{ type: "text" as const, text: `Error: slide_index ${slide_index} out of range` }],
        };
      }

      const slide = pres.slides[slide_index];
      const requests: unknown[] = [];

      // Find the gantt_area rectangle placed by the template builder (stable ID)
      const ganttEl = slide.pageElements?.find((el) => el.objectId === "gantt_area");
      if (!ganttEl) {
        return {
          content: [{ type: "text" as const, text: `Error: no gantt_area element found on slide ${slide_index}. Is this a TIMELINE layout slide?` }],
        };
      }

      // Read bounds from the template element
      const GANTT_LEFT = ganttEl.transform?.translateX ?? 640_000;
      const GANTT_TOP = ganttEl.transform?.translateY ?? 1_371_600;
      const GANTT_WIDTH = (ganttEl.size?.width?.magnitude ?? 7_496_800) * (ganttEl.transform?.scaleX ?? 1);
      const GANTT_HEIGHT = (ganttEl.size?.height?.magnitude ?? 2_560_320) * (ganttEl.transform?.scaleY ?? 1);

      // Layout: leave padding inside the Gantt area
      const PAD = 80_000;
      const areaTop = GANTT_TOP + PAD;
      const areaLeft = GANTT_LEFT + PAD;
      const areaWidth = GANTT_WIDTH - PAD * 2;
      const areaHeight = GANTT_HEIGHT - PAD * 2;

      // Split vertical space evenly across phases
      const BAR_HEIGHT = Math.min(350_000, Math.floor(areaHeight / phases.length * 0.7));
      const BAR_GAP = Math.floor((areaHeight - BAR_HEIGHT * phases.length) / Math.max(phases.length, 1));

      // Months for positioning (12-month timeline)
      const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const LABEL_WIDTH = 1_100_000;
      const barAreaLeft = areaLeft + LABEL_WIDTH;
      const barAreaWidth = areaWidth - LABEL_WIDTH;
      const MONTH_WIDTH = barAreaWidth / 12;

      function monthIndex(m: string): number {
        const normalized = m.slice(0, 3);
        const idx = MONTHS.findIndex((mo) => mo.toLowerCase() === normalized.toLowerCase());
        return idx >= 0 ? idx : 0;
      }

      // Create bars for each phase
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        const startIdx = monthIndex(phase.start_month);
        const endIdx = monthIndex(phase.end_month);
        const barWidth = Math.max((endIdx - startIdx + 1) * MONTH_WIDTH, MONTH_WIDTH);
        const barLeft = barAreaLeft + startIdx * MONTH_WIDTH;
        const barTop = areaTop + i * (BAR_HEIGHT + BAR_GAP);

        const barId = `timeline_bar_${i}_${Date.now()}`;
        const labelId = `timeline_label_${i}_${Date.now()}`;

        // Create colored rectangle
        requests.push({
          createShape: {
            objectId: barId,
            shapeType: "ROUND_RECTANGLE",
            elementProperties: {
              pageObjectId: slide.objectId,
              size: {
                width: { magnitude: barWidth, unit: "EMU" },
                height: { magnitude: BAR_HEIGHT, unit: "EMU" },
              },
              transform: {
                scaleX: 1,
                scaleY: 1,
                translateX: barLeft,
                translateY: barTop,
                unit: "EMU",
              },
            },
          },
        });

        // Set bar color
        const r = parseInt(phase.color.slice(1, 3), 16) / 255;
        const g = parseInt(phase.color.slice(3, 5), 16) / 255;
        const b = parseInt(phase.color.slice(5, 7), 16) / 255;

        requests.push({
          updateShapeProperties: {
            objectId: barId,
            shapeProperties: {
              shapeBackgroundFill: {
                solidFill: { color: { rgbColor: { red: r, green: g, blue: b } } },
              },
              outline: { propertyState: "NOT_RENDERED" },
            },
            fields: "shapeBackgroundFill.solidFill.color,outline",
          },
        });

        // Add phase label to the left of the bar
        requests.push({
          createShape: {
            objectId: labelId,
            shapeType: "TEXT_BOX",
            elementProperties: {
              pageObjectId: slide.objectId,
              size: {
                width: { magnitude: LABEL_WIDTH, unit: "EMU" },
                height: { magnitude: BAR_HEIGHT, unit: "EMU" },
              },
              transform: {
                scaleX: 1,
                scaleY: 1,
                translateX: areaLeft,
                translateY: barTop,
                unit: "EMU",
              },
            },
          },
        });

        requests.push({
          insertText: { objectId: labelId, text: phase.name, insertionIndex: 0 },
        });

        requests.push({
          updateTextStyle: {
            objectId: labelId,
            textRange: { type: "ALL" },
            style: {
              fontSize: { magnitude: 10, unit: "PT" },
              foregroundColor: { opaqueColor: { rgbColor: { red: r, green: g, blue: b } } },
              bold: true,
            },
            fields: "fontSize,foregroundColor,bold",
          },
        });
      }

      // Set total cost if the slide has a {{TOTAL_COST}} placeholder
      if (total_cost) {
        for (const el of slide.pageElements ?? []) {
          const text = el.shape?.text?.textElements?.map((te) => te.textRun?.content ?? "").join("").trim();
          if (text?.includes("{{TOTAL_COST}}")) {
            requests.push({ deleteText: { objectId: el.objectId, textRange: { type: "ALL" } } });
            requests.push({ insertText: { objectId: el.objectId, text: `Estimated cost ${total_cost}`, insertionIndex: 0 } });

            // Style in orange
            requests.push({
              updateTextStyle: {
                objectId: el.objectId,
                textRange: { type: "ALL" },
                style: {
                  foregroundColor: {
                    opaqueColor: { rgbColor: { red: 0.99, green: 0.376, blue: 0.153 } },
                  },
                  fontSize: { magnitude: 24, unit: "PT" },
                  bold: true,
                },
                fields: "foregroundColor,fontSize,bold",
              },
            });
            break;
          }
        }
      }

      if (requests.length > 0) {
        await slidesApi(presentation_id, ":batchUpdate", "POST", { requests });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Timeline populated with ${phases.length} phases on slide ${slide_index}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error populating timeline: ${String(err)}` }],
      };
    }
  }
);
```

**Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/mcp-servers/google-slides.ts
git commit -m "feat(presentation-slides): add add_timeline_data tool for Gantt charts"
```

- [ ] Done

---

### Task 6: Add `add_pricing_block` tool

**Files:**
- Modify: `src/mcp-servers/google-slides.ts`

**Step 1: Add the tool**

Add after `add_timeline_data`:

```typescript
server.tool(
  "add_pricing_block",
  "Fill the PRICING layout slide with cost comparison data (current vs proposed, savings percentage).",
  {
    presentation_id: z.string().describe("The presentation ID"),
    slide_index: z.number().int().min(0).describe("Zero-based slide index of the PRICING slide"),
    current_cost: z.string().describe("Client's current cost, e.g. '650 000 EUR'"),
    proposed_cost: z.string().describe("Blazity's proposed cost, e.g. '571 500 EUR'"),
    savings_percent: z.string().describe("Savings percentage, e.g. '12%'"),
    current_label: z.string().optional().describe("Label for current cost block (default: 'Current cost')"),
    proposed_label: z.string().optional().describe("Label for proposed cost block (default: 'With Blazity')"),
  },
  async ({ presentation_id, slide_index, current_cost, proposed_cost, savings_percent, current_label, proposed_label }) => {
    try {
      const pres = (await slidesApi(presentation_id, "")) as {
        slides: Array<{ objectId: string; pageElements?: Array<{ objectId: string; shape?: { text?: { textElements?: Array<{ textRun?: { content: string } }> } } }> }>;
      };

      if (slide_index >= pres.slides.length) {
        return {
          content: [{ type: "text" as const, text: `Error: slide_index ${slide_index} out of range` }],
        };
      }

      const slide = pres.slides[slide_index];
      const requests: unknown[] = [];

      // Replace placeholder tokens
      const replacements: Record<string, string> = {
        "{{CURRENT_COST}}": current_cost,
        "{{PROPOSED_COST}}": proposed_cost,
        "{{SAVINGS}}": `${savings_percent} LESS`,
        "{{CURRENT_LABEL}}": current_label ?? "Current cost",
        "{{PROPOSED_LABEL}}": proposed_label ?? "With Blazity",
      };

      for (const el of slide.pageElements ?? []) {
        const text = el.shape?.text?.textElements?.map((te) => te.textRun?.content ?? "").join("").trim();
        if (!text) continue;

        for (const [placeholder, value] of Object.entries(replacements)) {
          if (text.includes(placeholder)) {
            requests.push({ deleteText: { objectId: el.objectId, textRange: { type: "ALL" } } });
            requests.push({ insertText: { objectId: el.objectId, text: value, insertionIndex: 0 } });
            break;
          }
        }
      }

      if (requests.length > 0) {
        await slidesApi(presentation_id, ":batchUpdate", "POST", { requests });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Pricing block filled: ${current_cost} → ${proposed_cost} (${savings_percent} savings)`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error filling pricing: ${String(err)}` }],
      };
    }
  }
);
```

**Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/mcp-servers/google-slides.ts
git commit -m "feat(presentation-slides): add add_pricing_block tool"
```

- [ ] Done

---

### Task 7: Write tests for `parseBoldText`

**Files:**
- Create: `src/mcp-servers/google-slides.test.ts`

**Step 1: Write the tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Set required env vars before importing
if (!process.env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = "test";
if (!process.env.GOOGLE_CLIENT_SECRET) process.env.GOOGLE_CLIENT_SECRET = "test";
if (!process.env.GOOGLE_REFRESH_TOKEN) process.env.GOOGLE_REFRESH_TOKEN = "test";
if (!process.env.GSLIDES_TEMPLATE_ID) process.env.GSLIDES_TEMPLATE_ID = "test";

const { parseBoldText } = await import("./google-slides.js");

describe("parseBoldText()", () => {
  it("returns plain text when no bold markers", () => {
    const runs = parseBoldText("Hello world");
    assert.deepEqual(runs, [{ text: "Hello world" }]);
  });

  it("parses single bold segment", () => {
    const runs = parseBoldText("This is **bold** text");
    assert.deepEqual(runs, [
      { text: "This is " },
      { text: "bold", bold: true },
      { text: " text" },
    ]);
  });

  it("parses multiple bold segments", () => {
    const runs = parseBoldText("**First** normal **second**");
    assert.deepEqual(runs, [
      { text: "First", bold: true },
      { text: " normal " },
      { text: "second", bold: true },
    ]);
  });

  it("handles bold at start and end", () => {
    const runs = parseBoldText("**all bold**");
    assert.deepEqual(runs, [{ text: "all bold", bold: true }]);
  });

  it("handles empty string", () => {
    const runs = parseBoldText("");
    assert.deepEqual(runs, [{ text: "" }]);
  });
});
```

**Step 2: Run the tests**

```bash
npx tsx --test src/mcp-servers/google-slides.test.ts
```

Expected: all pass.

**Step 3: Commit**

```bash
git add src/mcp-servers/google-slides.test.ts
git commit -m "test(presentation-slides): add parseBoldText unit tests"
```

- [ ] Done

---

### Task 8: Delete Gamma MCP server

**Files:**
- Delete: `src/mcp-servers/gamma.ts`

**Step 1: Delete the file**

```bash
rm src/mcp-servers/gamma.ts
```

**Step 2: Verify nothing imports from gamma**

```bash
grep -r "gamma" src/ --include="*.ts" -l
```

Expected: only `orchestrator.ts` (which we'll update in Task 9).

**Step 3: Verify TypeScript compilation still passes**

```bash
npx tsc --noEmit
```

This will likely show errors in `orchestrator.ts` referencing gamma — that's expected, we fix it in Task 9.

**Step 4: Commit**

```bash
git add -u src/mcp-servers/gamma.ts
git commit -m "feat(presentation-slides): remove Gamma MCP server"
```

- [ ] Done

---

### Task 9: Update orchestrator — MCP config, allowed tools, Step 4 prompt

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Update system prompt (line 69)**

Replace:
```
- gamma MCP: create visual presentations
```

With:
```
- google-slides MCP: create branded visual presentations (copy template, add slides by layout, set client logo, build timeline/Gantt, fill pricing)
```

**Step 2: Update TOOL_TO_STEP mapping (line 23)**

The `create_presentation` short name stays the same (it's stripped of the MCP prefix), but also add the new tools:

Replace:
```typescript
  create_presentation: 4,
```

With:
```typescript
  create_presentation: 4,
  add_slide: 4,
  set_client_logo: 4,
  add_timeline_data: 4,
  add_pricing_block: 4,
```

**Step 3: Replace Step 4 in the prompt (lines 286-297)**

Replace the entire Step 4 block with:

```
## Step 4: Create the Visual Presentation

1. Create a branded presentation using create_presentation.
   Title: "[Client] x Blazity — Initial Offer"
   Place it in the Output folder (folder ID: ${job.outputFolderId ?? "root"}).

2. Search for the client's logo online using fetch_web_page on their website.
   Extract the logo image URL (prefer PNG/SVG on transparent or white background).

3. Build the deck using add_slide calls in this order.
   Choose the layout that matches each slide's purpose:

   SLIDE 1 — layout: COVER
     title: "[Client] x Blazity"
     subtitle: "Initial Offer"

   SLIDE 2 — layout: DARK_CONTENT
     title: "Executive Summary"
     body: 2-3 sentence project summary + 4-5 bullet pain points (**bold** key phrases)
     → Then call set_client_logo to place client logo on this slide

   SLIDE 3 — layout: DARK_CONTENT
     title: "Our understanding of [Client]'s goals, constraints, and risks"
     body: 3-4 key goals/constraints with **bold** emphasis, each 1-2 lines

   SLIDE 4 — layout: DARK_CONTENT
     title: "Why Blazity is a good fit"
     body: 5 numbered points (quality, experience, portfolio, Vercel certified, proactive)

   SLIDE 5 — layout: SECTION_DIVIDER
     title: "Scope Definition & Assumptions"

   SLIDES 6-8 — layout: LIGHT_CONTENT (1-3 slides based on scope size)
     title: "What's included in scope"
     body: Each item: **bold title** + 2-3 sentence description. Max 3 items per slide.

   SLIDE N — layout: LIGHT_CONTENT
     title: "What is explicitly excluded or assumed"
     body: exclusions with **bold** title + description

   SLIDE N+1 — layout: SECTION_DIVIDER
     title: "Delivery approach, role description & tooling"

   SLIDE N+2 — layout: DARK_CONTENT
     title: "Virtual team organization & delivery approach"
     body: operational principles with **bold** key phrases

   SLIDE N+3 — layout: DARK_CONTENT
     title: "Sprint-based development & core tools"
     body: sprint details + core collaboration tools

   SLIDE N+4 — layout: SECTION_DIVIDER
     title: "Platform & Architecture Overview"

   SLIDES N+5..N+6 — layout: LIGHT_CONTENT (1-2 slides)
     Technology recommendations (framework, CMS, hosting)

   SLIDE N+7 — layout: SECTION_DIVIDER
     title: "Estimation & pricing structure"

   SLIDE N+8 — layout: TIMELINE
     → Call add_timeline_data with project phases. Use these colors:
       Discovery: "#FFC800" (yellow), Development: "#3C43E7" (blue),
       Testing: "#BBED80" (green), Deployment: "#FD6027" (orange)

   SLIDE N+9 — layout: PRICING
     → Call add_pricing_block with cost comparison

   OPTIONAL — layout: SECTION_DIVIDER
     title: "Technical assumptions" (only for complex projects)

   OPTIONAL — layout: LIGHT_CONTENT
     Detailed technical assumptions

   LAST SLIDE — layout: DARK_CONTENT
     title: "Next Steps"
     body: 3-4 concrete next actions + contact info

CONTENT RULES FOR SLIDES:
- MAX 6 bullet points per slide. If a section needs more, split across slides.
- MAX 40 words per bullet point. Slides are visual — not documents.
- **Bold** the key phrase in each bullet (first 3-5 words).
- Use concrete numbers, not adjectives. "**8+ years** of experience" not "extensive experience".
- Section divider slides have NO body text — just the section title.
- Target 12-20 slides total depending on project complexity.

4. Post the Google Slides URL to Slack with a 1-line summary.
```

**Step 4: Replace MCP server config — swap gamma for google-slides (lines 361-367)**

Replace:
```typescript
          gamma: {
            command: "node",
            args: [path.join(ROOT, "dist/mcp-servers/gamma.js")],
            env: {
              GAMMA_API_KEY: process.env.GAMMA_API_KEY!,
            },
          },
```

With:
```typescript
          "google-slides": {
            command: "node",
            args: [path.join(ROOT, "dist/mcp-servers/google-slides.js")],
            env: {
              GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
              GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
              GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN!,
              GSLIDES_TEMPLATE_ID: process.env.GSLIDES_TEMPLATE_ID!,
            },
          },
```

**Step 5: Update allowed tools list (line 396)**

Replace:
```typescript
          "mcp__gamma__create_presentation",
```

With:
```typescript
          "mcp__google-slides__create_presentation",
          "mcp__google-slides__add_slide",
          "mcp__google-slides__set_client_logo",
          "mcp__google-slides__add_timeline_data",
          "mcp__google-slides__add_pricing_block",
```

**Step 6: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 7: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(presentation-slides): replace Gamma with Google Slides in orchestrator"
```

- [ ] Done

---

### Task 10: Verify all tests pass

**Files:** none (verification only)

**Step 1: Run the full test suite**

```bash
npx tsx --test src/**/*.test.ts
```

Expected: all tests pass, including the new `google-slides.test.ts`.

**Step 2: Run TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] Done

---

### Task 11: Manual — Create Google Slides template

**This task is NOT automated.** The developer must:

1. Create a new Google Slides presentation in the browser
2. Go to Slide → Edit master
3. Create 6 layouts named exactly: `COVER`, `SECTION_DIVIDER`, `DARK_CONTENT`, `LIGHT_CONTENT`, `PRICING`, `TIMELINE`
4. For each layout:
   - Set background color (Coal `#181B20` for dark, Off-white `#F9FAFB` for light, Mariner `#3C43E7` for divider)
   - Add text placeholders with `{{TITLE}}`, `{{BODY}}`, `{{SUBTITLE}}`, `{{CLIENT_LOGO}}`, `{{TOTAL_COST}}`, `{{CURRENT_COST}}`, `{{PROPOSED_COST}}`, `{{SAVINGS}}`, `{{CURRENT_LABEL}}`, `{{PROPOSED_LABEL}}` as appropriate
   - Set font styles on placeholders (Inter 18pt for body, larger for titles)
   - Add flame graphics (PNG) as static images on COVER, SECTION_DIVIDER, and DARK_CONTENT layouts
   - Add Blazity logo (flame + "blazity" text) in top-right corner
5. Copy the presentation ID from the URL: `https://docs.google.com/presentation/d/THIS_ID/edit`
6. Set `GSLIDES_TEMPLATE_ID=THIS_ID` in `.env`
7. Re-run `npx tsx scripts/get-google-token.ts` if the `presentations` scope is new

- [ ] Done

---

### Task 12: End-to-end test

**This requires a live Google API token and the template from Task 11.**

**Step 1: Run the estimation agent with `skipSteps: ["slack", "knowledge_base"]`**

Use the admin panel or `scripts/test-run.ts` to trigger a test estimation.

**Step 2: Verify the output**

Open the generated Google Slides URL and check:
- [ ] Correct number of slides (12-20)
- [ ] Cover slide has correct title and "Initial Offer" subtitle
- [ ] Section dividers are blue with orange circle
- [ ] Dark content slides have coal background
- [ ] Light content slides have off-white background
- [ ] Client logo appears on the Executive Summary slide
- [ ] Timeline slide has colored Gantt bars
- [ ] Pricing slide shows cost comparison
- [ ] Bold text formatting is applied correctly
- [ ] No placeholder text remains (`{{...}}`)

**Step 3: Iterate**

Based on the output, adjust the orchestrator prompt, template layouts, or MCP tool code.

- [ ] Done
