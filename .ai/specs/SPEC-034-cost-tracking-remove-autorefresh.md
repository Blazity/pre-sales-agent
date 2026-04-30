# SPEC-034: Per-Job Cost Tracking + Remove Auto-Refresh

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show rough per-job API spend (Claude + Brave Search) in the admin panel, and remove the auto-refresh toggle.

**Architecture:** Capture `total_cost_usd` from the SDK `result` message at query completion + count `web_search` tool calls × $0.005 for Brave. Store in Redis progress hash. Display in admin tables. Delete auto-refresh JS and toggle button.

**Tech Stack:** Claude Agent SDK (`SDKResultMessage`), Redis, Express server-rendered HTML.

**Status:** Implemented
**Date:** 2026-03-11
**Scope:** `src/agents/orchestrator.ts`, `src/admin/routes.ts`

---

## Problem

1. **No cost visibility** — The orchestrator discards the SDK's `result` message which contains `total_cost_usd`, token counts, and per-model cost. There's no way to know how much each estimation costs.
2. **Auto-refresh is unwanted** — The toggle + 3-second polling was added for monitoring active jobs but is no longer needed. Remove it.

## Design

### Cost tracking

**Data source:** The Claude Agent SDK returns an `SDKResultMessage` (type `"result"`) as the final message in the `query()` iterator. It contains:
- `total_cost_usd` — total Claude API cost
- `usage.input_tokens`, `usage.output_tokens` — token counts
- `modelUsage` — per-model breakdown

**Brave Search cost:** Count `web_search` tool calls during the orchestrator loop. Each call costs $0.005 (Brave pricing: $5/1000 queries).

**Storage:** Add fields to the Redis progress hash (`job:{id}:progress`):
- `costClaudeUsd` — string, e.g. "1.23"
- `costBraveUsd` — string, e.g. "0.03"
- `costTotalUsd` — string, e.g. "1.26"
- `inputTokens` — string, e.g. "450000"
- `outputTokens` — string, e.g. "12000"

These are written once when the query completes (or errors). During a running job they're absent.

**Admin display:**
- Add **Cost** column to both Active and Recent job tables
- Active jobs show `—` (cost not available until completion)
- Completed jobs show `$1.26` with hover title showing breakdown
- Log viewer shows breakdown in the progress summary line: `Cost: $1.26 (Claude: $1.23, Brave: $0.03) · 450K in / 12K out tokens`

### Remove auto-refresh

Delete: `autoRefreshScript` const, toggle buttons in both `dashboardHtml` and `logViewerHtml`, `.refresh-btn` CSS rules.

---

## Plan

### Task 1: Capture cost data in orchestrator

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Add Brave call counter before the query loop**

After line 859 (`let turns = 0;`), add:

```typescript
    let braveSearchCalls = 0;
```

**Step 2: Count web_search tool calls inside the loop**

In the `message.type === "assistant"` handler, inside the block that processes `tool_use` blocks (around line 978), after `await jobLog.toolCall(block.name, block.input);`, add:

```typescript
              const shortName = block.name.replace(/^mcp__[^_]+__/, "");
              if (shortName === "web_search") braveSearchCalls++;
```

Note: `detectStep` already strips the MCP prefix on line 35, but `block.name` in the loop is the full name like `mcp__web-research__web_search`. Extract the short name the same way.

Actually, check: `block.name` may already be the short name or the full prefixed name. Look at what the SDK returns. The `detectStep` function on line 35 does `toolName.replace(/^mcp__[^_]+__/, "")`, meaning the raw name includes the prefix. So count using the full name:

```typescript
              if (block.name === "mcp__web-research__web_search") braveSearchCalls++;
```

**Step 3: Handle the `result` message after the loop**

After the `for await` loop ends (after line 1007, before the `finishedAt` line), add result message handling. The `result` message is the last one yielded by the iterator. We need to capture it during iteration.

Add a variable before the loop:

```typescript
    let resultCostUsd = 0;
    let resultInputTokens = 0;
    let resultOutputTokens = 0;
```

Inside the loop, add a new `else if` branch after the `message.type === "user"` block (after line 1006):

```typescript
      } else if (message.type === "result") {
        const r = message as { total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } };
        resultCostUsd = r.total_cost_usd ?? 0;
        resultInputTokens = r.usage?.input_tokens ?? 0;
        resultOutputTokens = r.usage?.output_tokens ?? 0;
      }
```

**Step 4: Store cost data in Redis after the loop**

After the `controller.signal.aborted` check and before the final `redis.hset` for completed status (around line 1017), add:

```typescript
    const costBrave = braveSearchCalls * 0.005;
    const costTotal = resultCostUsd + costBrave;

    await redis.hset(progressKey(jobId), {
      costClaudeUsd: resultCostUsd.toFixed(4),
      costBraveUsd: costBrave.toFixed(4),
      costTotalUsd: costTotal.toFixed(4),
      inputTokens: String(resultInputTokens),
      outputTokens: String(resultOutputTokens),
    });
```

This should go in both the normal completion path AND the cancelled path (the SDK may still return a result message for cancelled jobs). Place it right before the final status update lines.

**Step 5: Also store cost for cancelled/failed jobs**

The cost write should happen regardless of job outcome. Place it after the loop but before the status-conditional block. The `resultCostUsd` will be 0 if the SDK didn't return a result (e.g., crash), which is fine.

**Step 6: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(cost-tracking): capture Claude + Brave API cost from SDK result message"
```

---

### Task 2: Add Cost column to admin panel

**Files:**
- Modify: `src/admin/routes.ts`

**Step 1: Add cost fields to JobProgress interface (line 9-20)**

Add optional fields:

```typescript
  costClaudeUsd?: string;
  costBraveUsd?: string;
  costTotalUsd?: string;
  inputTokens?: string;
  outputTokens?: string;
```

**Step 2: Add a `formatCost` helper**

After the `progressBar` function (after line 63), add:

```typescript
function formatCost(p: JobProgress): string {
  if (!p.costTotalUsd) return "—";
  const total = parseFloat(p.costTotalUsd);
  const claude = parseFloat(p.costClaudeUsd ?? "0");
  const brave = parseFloat(p.costBraveUsd ?? "0");
  return `<span title="Claude: $${claude.toFixed(2)} · Brave: $${brave.toFixed(2)}">$${total.toFixed(2)}</span>`;
}
```

**Step 3: Add Cost column to Active Jobs table (line 153)**

Change header row:
```
<th>Name</th><th>Started</th><th>Step</th><th>Progress</th><th>Turns</th><th>Cost</th><th>Elapsed</th><th>Actions</th>
```

Add `<td>${formatCost(p)}</td>` after the Turns `<td>` in the active jobs row (line 161, after `<td>${p.turnsCompleted}</td>`).

**Step 4: Add Cost column to Recent Jobs table (line 177)**

Change header row:
```
<th>Name</th><th>Started</th><th>Status</th><th>Progress</th><th>Turns</th><th>Cost</th><th>Duration</th><th>Actions</th>
```

Add `<td>${formatCost(p)}</td>` after the Turns `<td>` in the recent jobs row (line 185, after `<td>${p.turnsCompleted}</td>`).

**Step 5: Add cost breakdown to log viewer progress line (line 222)**

Update the progress summary to include cost info. Change the existing `<p>` with step/turns/duration to also include:

```typescript
    const costInfo = progress.costTotalUsd
      ? ` · Cost: $${parseFloat(progress.costTotalUsd).toFixed(2)} (Claude: $${parseFloat(progress.costClaudeUsd ?? "0").toFixed(2)}, Brave: $${parseFloat(progress.costBraveUsd ?? "0").toFixed(2)}) · ${formatTokens(progress.inputTokens)} in / ${formatTokens(progress.outputTokens)} out`
      : "";
```

Add a `formatTokens` helper:

```typescript
function formatTokens(t?: string): string {
  if (!t) return "0";
  const n = parseInt(t);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
```

Append `${costInfo}` to the progress summary `<p>` tag.

**Step 6: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/admin/routes.ts
git commit -m "feat(cost-tracking): add Cost column to admin panel tables"
```

---

### Task 3: Remove auto-refresh

**Files:**
- Modify: `src/admin/routes.ts`

**Step 1: Delete `autoRefreshScript` const (lines 89-119)**

Remove the entire block.

**Step 2: Delete refresh toggle button from `dashboardHtml` (lines 137-141)**

Change:
```typescript
    <div style="display:flex;align-items:center;gap:12px">
      <h1 style="flex:1">Estimation Agent — Admin</h1>
      <button id="refreshToggle" class="refresh-btn">Auto-refresh</button>
    </div>
    ${autoRefreshScript}`;
```
To:
```typescript
    <h1>Estimation Agent — Admin</h1>`;
```

**Step 3: Delete refresh toggle from `logViewerHtml` (lines 217-221)**

Change:
```typescript
    <div style="display:flex;align-items:center;gap:12px">
      <h1 style="flex:1">${title} ${status}</h1>
      <button id="refreshToggle" class="refresh-btn">Auto-refresh</button>
    </div>
    ${autoRefreshScript}
```
To:
```typescript
    <h1>${title} ${status}</h1>
```

**Step 4: Remove `.refresh-btn` CSS rules (lines 75-77)**

Delete:
```css
  .refresh-btn { background:none; border:1px solid #555; color:#ccc; padding:4px 12px; border-radius:4px; cursor:pointer; font-size:12px; }
  .refresh-btn:hover { border-color:#888; }
  .refresh-btn.active { border-color:#4CAF50; color:#4CAF50; }
```

**Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/admin/routes.ts
git commit -m "fix(cost-tracking): remove auto-refresh toggle from admin panel"
```

---

### Task 4: Final verification

**Step 1: Run full type check**

Run: `npx tsc --noEmit`

**Step 2: Run all tests**

Run: `npm test`

**Step 3: Verify no stale references**

- `grep -r "autoRefresh\|refreshToggle\|refresh-btn" src/` — should find nothing
- `grep -r "costClaudeUsd\|costTotalUsd" src/` — should find in orchestrator + admin routes

**Step 4: Push and create PR**

```bash
git push -u origin feat/cost-tracking
gh pr create --title "feat: per-job cost tracking + remove auto-refresh" --body "..."
```
