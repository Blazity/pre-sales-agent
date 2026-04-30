# SPEC-032: Fix Grid Limit, Add Web Search, Reduce Token Overflow

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three production issues: spreadsheet grid overflow, non-functional web search, and file content token overflow.

**Architecture:** Three independent fixes in MCP servers + orchestrator prompt updates. Grid fix adds `appendDimension` API call before writes. Web search adds Brave Search API as new MCP tool + removes domain whitelist. Token fix lowers truncation limits and switches to plain text exports.

**Tech Stack:** TypeScript, Google Sheets API v4, Brave Search API, Claude Agent SDK MCP servers.

**Status:** Implemented
**Date:** 2026-03-11
**Scope:** `src/mcp-servers/web-research.ts`, `src/mcp-servers/google-workspace.ts`, `src/agents/orchestrator.ts`

---

## Problem

1. **Spreadsheet grid overflow** — Template has 39 rows. When >33 estimation items, summary rows write past row 39 → Sheets API 400.
2. **Web search non-functional** — `fetch_web_page` whitelist blocks all client websites and benchmark sources.
3. **Token overflow** — 50K char truncation + HTML export = ~50K tokens, exceeding 25K read limit.

---

## Plan

### Task 1: Add grid auto-expansion + row cap to sheets_create_estimation

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:1159-1366`
- Test: `src/mcp-servers/google-workspace.test.ts`

**Step 1: Write failing test for row cap**

Add to `google-workspace.test.ts` after the `calculateCalendarDays` describe block (after line 703):

```typescript
describe("sheets_create_estimation row limits", () => {
  it("buildEstimationRows handles >33 items without error", () => {
    const areas = [{
      name: "Large Area",
      items: Array.from({ length: 50 }, (_, i) => ({
        name: `Item ${i + 1}`,
        effort_hours: 8,
        parallel: false,
        assumptions: "Test",
      })),
    }];
    const rows = buildEstimationRows(areas);
    assert.equal(rows.length, 50);
  });
});
```

**Step 2: Run test to verify it passes** (buildEstimationRows itself is fine, it's the API write that fails)

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: PASS (confirms the row builder has no cap — the real fix is in the API call logic)

**Step 3: Add `MAX_ESTIMATION_ROWS` constant and grid expansion logic**

In `src/mcp-servers/google-workspace.ts`, add constant near line 1152 (before `buildEstimationRows`):

```typescript
const MAX_ESTIMATION_ROWS = 100;
```

In the `sheets_create_estimation` handler, after line 1307 (`const dataRows = buildEstimationRows(areas);`), add a cap check:

```typescript
      if (dataRows.length > MAX_ESTIMATION_ROWS) {
        return { content: [{ type: "text" as const, text: `Error: Estimation has ${dataRows.length} items, exceeding the maximum of ${MAX_ESTIMATION_ROWS}. Reduce the number of action items.` }] };
      }
```

After line 1289 (after the clear step, before writing header), add grid expansion:

```typescript
      // 3b. Expand grid if needed (header + data rows + 5 summary rows)
      const requiredRows = 1 + dataRows.length + 5;
      if (requiredRows > existingRows) {
        const expandRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: [{ appendDimension: { sheetId: gid, dimension: "ROWS", length: requiredRows - existingRows } }],
            }),
          },
        );
        if (!expandRes.ok) {
          const text = await expandRes.text();
          return { content: [{ type: "text" as const, text: `Expand grid error: ${text}` }] };
        }
      }
```

**Important ordering note:** The `dataRows` are built in step 5 (line 1307) which is AFTER the clear step (line 1277). But the grid expansion needs `dataRows.length`. Move the `buildEstimationRows` call BEFORE the clear step. Specifically:

1. Move `const dataRows = buildEstimationRows(areas);` to right after the unmerge block (after line 1271)
2. Add the cap check immediately after
3. Add the grid expansion after the clear step (it uses `existingRows` which comes from metadata)

The final order should be:
- Copy template → Get metadata → Unmerge → **Build data rows + cap check** → Clear → **Expand grid if needed** → Write header → Write data → Write summary

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Run all tests**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: All pass

**Step 6: Commit**

```bash
git add src/mcp-servers/google-workspace.ts src/mcp-servers/google-workspace.test.ts
git commit -m "fix(grid-websearch-tokenoverflow): auto-expand sheet grid + 100-row cap"
```

---

### Task 2: Add `web_search` tool using Brave Search API

**Files:**
- Modify: `src/mcp-servers/web-research.ts`
- Test: `src/mcp-servers/web-research.test.ts`

**Step 1: Write failing test for `web_search` helper**

First, extract the Brave API call into a testable function. Add tests to `web-research.test.ts`:

```typescript
describe("parseBraveResults()", () => {
  it("extracts title, url, description from Brave API response", () => {
    const apiResponse = {
      web: {
        results: [
          { title: "Example", url: "https://example.com", description: "A description" },
          { title: "Another", url: "https://another.com", description: "More text" },
        ],
      },
    };
    const results = parseBraveResults(apiResponse);
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], { title: "Example", url: "https://example.com", description: "A description" });
  });

  it("returns empty array when no results", () => {
    assert.deepEqual(parseBraveResults({ web: { results: [] } }), []);
    assert.deepEqual(parseBraveResults({}), []);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/mcp-servers/web-research.test.ts`
Expected: FAIL — `parseBraveResults is not a function`

**Step 3: Implement `parseBraveResults` and `web_search` tool**

In `src/mcp-servers/web-research.ts`, add the helper (before the server definition, around line 61):

```typescript
interface BraveResult {
  title: string;
  url: string;
  description: string;
}

export function parseBraveResults(data: Record<string, unknown>): BraveResult[] {
  const web = data?.web as { results?: Array<{ title?: string; url?: string; description?: string }> } | undefined;
  if (!web?.results) return [];
  return web.results.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description ?? "",
  }));
}
```

Add the tool registration after the `fetch_web_page` tool (before the `isTestRun` check, around line 135):

```typescript
server.tool(
  "web_search",
  "Search the web using Brave Search API. Returns titles, URLs, and snippets. Use this to discover pages, then fetch_web_page to read specific ones.",
  {
    query: z.string().describe("Search query"),
    count: z.number().int().min(1).max(10).default(5).describe("Number of results to return (default 5, max 10)"),
  },
  async ({ query, count }) => {
    try {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY;
      if (!apiKey) {
        return { content: [{ type: "text" as const, text: "Error: BRAVE_SEARCH_API_KEY not configured" }] };
      }

      const params = new URLSearchParams({ q: query, count: String(count) });
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
      });

      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: "text" as const, text: `Brave Search error: ${res.status} ${text}` }] };
      }

      const data = await res.json();
      const results = parseBraveResults(data);

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No results found." }] };
      }

      const formatted = results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
        .join("\n\n");

      return { content: [{ type: "text" as const, text: formatted }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);
```

**Step 4: Update test imports**

In `web-research.test.ts` line 4, update the import:

```typescript
const { isAllowedUrl, htmlToText, parseBraveResults } = await import("./web-research.js");
```

**Step 5: Run tests**

Run: `npx tsx --test src/mcp-servers/web-research.test.ts`
Expected: All pass (existing + new parseBraveResults tests)

**Step 6: Commit**

```bash
git add src/mcp-servers/web-research.ts src/mcp-servers/web-research.test.ts
git commit -m "feat(grid-websearch-tokenoverflow): add web_search tool with Brave Search API"
```

---

### Task 3: Remove domain whitelist from `fetch_web_page`

**Files:**
- Modify: `src/mcp-servers/web-research.ts:8-31, 65-84`
- Modify: `src/mcp-servers/web-research.test.ts:1-38`

**Step 1: Remove `ALLOWED_HOSTS` and `isAllowedUrl`**

In `web-research.ts`:
- Delete lines 10-31 (`ALLOWED_HOSTS`, `isAllowedUrl` function)
- In `fetch_web_page` tool (line 67), update the description to:
  ```
  "Fetch a web page and extract its text content. Optionally summarize with a prompt."
  ```
- Delete lines 77-84 (the `isAllowedUrl` check block in the tool handler)

**Step 2: Update tests**

In `web-research.test.ts`:
- Remove the entire `describe("isAllowedUrl()")` block (lines 6-38)
- Remove `isAllowedUrl` from the import on line 4:
  ```typescript
  const { htmlToText, parseBraveResults } = await import("./web-research.js");
  ```

**Step 3: Run tests**

Run: `npx tsx --test src/mcp-servers/web-research.test.ts`
Expected: All pass

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/mcp-servers/web-research.ts src/mcp-servers/web-research.test.ts
git commit -m "feat(grid-websearch-tokenoverflow): remove domain whitelist from fetch_web_page"
```

---

### Task 4: Reduce truncation limits in google-workspace.ts

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:193-194, 305-307`

**Step 1: Lower truncation from 50K to 20K chars**

In `src/mcp-servers/google-workspace.ts`, find both occurrences of `const maxLen = 50_000;`:

At line 193 (inside `drive_get_file`):
```typescript
      const maxLen = 20_000;
```

At line 305 (inside `drive_export_file`):
```typescript
      const maxLen = 20_000;
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Run tests**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: All pass (truncation tests don't assert specific limits)

**Step 4: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "fix(grid-websearch-tokenoverflow): reduce export truncation from 50K to 20K chars"
```

---

### Task 5: Update orchestrator prompt and MCP config

**Files:**
- Modify: `src/agents/orchestrator.ts:107, 234, 478-488, 586, 916-921, 933-956`

**Step 1: Update web-research MCP description in system prompt (line 107)**

Change:
```
- web-research MCP: fetch pages from blazity.com, nextjs.org, vercel.com, github.com/blazity — with optional AI extraction
```
To:
```
- web-research MCP: web_search (Brave Search API — discover pages by query) and fetch_web_page (fetch any URL with optional AI extraction)
```

**Step 2: Update complexity tier COMPLEX items count (line 234)**

Change:
```
  - Action items per area: 4-8 (total 25-40 items)
```
To:
```
  - Action items per area: 4-8 (total 25-50 items)
```

**Step 3: Add quality note after the complexity tiers (after line 240)**

After the line `(e.g., "30 MD exceeds Simple range because of 3 external API integrations").`, add:

```
Maximum 100 action items regardless of tier. Focus on meaningful, well-scoped items — do not pad the estimate with trivial tasks just to fill rows.
```

**Step 4: Update Step 3 web search instructions (lines 478-488)**

Change Step 3 section 1 (line 478-483):
```
1. RESEARCH THE CLIENT'S BUSINESS
   Use web_search to find the client's website and key business information.
   Then use fetch_web_page to visit relevant pages and extract:
```
(keep the bullet list below unchanged)

Change Step 3 section 2 (lines 486-488):
```
   Use web_search to find published data on typical improvements for this project type.
   Use fetch_web_page on the most relevant results from credible sources: Forrester, Gartner, McKinsey, Deloitte,
```
(keep rest unchanged)

**Step 5: Change past proposal export from HTML to plain text (line 586)**

Change:
```
2. If yes, read the most relevant past offer using drive_export_file(doc_id, "text/html")
```
To:
```
2. If yes, read the most relevant past offer using drive_export_file(doc_id, "text/plain")
```

**Step 6: Add `BRAVE_SEARCH_API_KEY` to web-research MCP env (around line 920)**

In the `"web-research"` MCP config, change:
```typescript
            env: {
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
            },
```
To:
```typescript
            env: {
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
              BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY ?? "",
            },
```

**Step 7: Add `web_search` to allowedTools (after line 947)**

After the line `"mcp__web-research__fetch_web_page",`, add:
```typescript
          "mcp__web-research__web_search",
```

**Step 8: Add `web_search` to TOOL_TO_STEP (around line 17-32)**

Add these entries to `TOOL_TO_STEP`:
```typescript
  web_search: 1,
  fetch_web_page: 3,
```

**Step 9: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 10: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(grid-websearch-tokenoverflow): update orchestrator for web_search + prompt fixes"
```

---

### Task 6: Update .env.example and docs

**Files:**
- Modify: `.env.example`
- Modify: `.ai/mcp-tools.md`

**Step 1: Add BRAVE_SEARCH_API_KEY to .env.example**

After the `VOYAGE_API_KEY=...` line (line 24), add:
```
# Brave Search (web research)
BRAVE_SEARCH_API_KEY=...
```

**Step 2: Update mcp-tools.md web-research section**

Change the web-research table (lines 38-42) to:
```markdown
## web-research

| Tool | Description |
|------|-------------|
| `web_search` | Search the web via Brave Search API. Returns titles, URLs, and snippets |
| `fetch_web_page` | Fetch any URL and extract text content, with optional AI summarization |
```

**Step 3: Commit**

```bash
git add .env.example .ai/mcp-tools.md
git commit -m "docs(grid-websearch-tokenoverflow): update env example and MCP tools reference"
```

---

### Task 7: Final verification

**Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All pass

**Step 3: Verify no regressions in orchestrator**

Quick sanity check: search for stale references to the old whitelist or old token limits:
- `grep -r "ALLOWED_HOSTS" src/` — should find nothing
- `grep -r "50_000" src/` — should find nothing
- `grep -r "isAllowedUrl" src/` — should find nothing
- `grep -r "text/html" src/agents/` — should find nothing

**Step 4: Update lessons.md if needed**

If any new pitfalls were discovered during implementation, append to `.ai/lessons.md`.

**Step 5: Push branch and create PR**

```bash
git push -u origin feat/grid-websearch-tokenoverflow
gh pr create --title "fix: grid expansion, Brave web search, token overflow" --body "..."
```
