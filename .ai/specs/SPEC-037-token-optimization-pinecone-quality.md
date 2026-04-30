# SPEC-037: Token Optimization + Pinecone Data Quality

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce per-job token usage (~13% prompt savings + prevent unbounded context blow-ups) and improve Pinecone KB data quality (score filtering, namespace isolation, stale vector cleanup).

**Architecture:** Cap `wait_for_reply` Slack responses, add minimum score threshold to KB searches, remove redundant Block Kit JSON from prompt, conditionally exclude VBP section, improve seeding quality.

**Tech Stack:** MCP servers (slack-interaction, knowledge-base), orchestrator prompt, seed scripts, Pinecone.

**Status:** Planning
**Date:** 2026-03-12
**Scope:** `src/mcp-servers/slack-interaction.ts`, `src/mcp-servers/knowledge-base.ts`, `src/agents/orchestrator.ts`, `scripts/seed-knowledge-base.ts`, `scripts/seed-case-studies.ts`

---

## Problem

### Token waste

1. **`wait_for_reply` has no truncation** — clients can paste entire RFPs (50KB+) into Slack threads. All text enters the context window without limit.
2. **KB searches return noise** — no similarity score threshold. Results with 0.2 similarity score still consume context and can mislead the agent.
3. **Block Kit JSON repeated 7 times** — each step has a full Block Kit JSON example. The system prompt already defines the patterns. ~460 wasted tokens.
4. **Estimation rules explained twice** — Step 4a restates complexity tier and rate card rules already in the system prompt. ~100 wasted tokens.
5. **VBP section always loaded** — when `value_discovery` is skipped, the VBP prompt (~700 tokens) is still in context with an override instruction to ignore it.

### Pinecone data quality

1. **No minimum chunk size** — chunks like "Yes" or empty-ish text get indexed, wasting vector space.
2. **Case studies in default namespace** — only filtered by `type: "case_study"` metadata. Fragile if more data sources are added.
3. **Orphaned vectors** — deleted Drive files leave stale vectors in the index. No cleanup mechanism for incremental mode.

---

## Design

### A1: Cap `wait_for_reply` at 5,000 chars

**File:** `src/mcp-servers/slack-interaction.ts` (line 79)

Current:
```typescript
const replyText = humanReplies.map((m) => m.text ?? "").join("\n");
```

New:
```typescript
const MAX_REPLY_CHARS = 5000;
let replyText = humanReplies.map((m) => m.text ?? "").join("\n");
if (replyText.length > MAX_REPLY_CHARS) {
  replyText = replyText.slice(0, MAX_REPLY_CHARS) + `\n\n[... truncated, reply was ${replyText.length} chars ...]`;
}
```

5,000 chars ≈ 1,250 tokens. Enough for detailed answers but prevents context blow-up from pasted documents.

### A2: Add score threshold to KB searches

**File:** `src/mcp-servers/knowledge-base.ts`

Add a `MIN_SCORE` constant and filter results before formatting in all three tools:

```typescript
const MIN_SCORE = 0.4;
```

In each tool, after `query()`:
```typescript
const filtered = results.matches.filter((m) => (m.score ?? 0) >= MIN_SCORE);
```

If no results pass the threshold, return the existing "No matching ..." message.

### A3: Remove inline Block Kit JSON from step prompts

**File:** `src/agents/orchestrator.ts`

The system prompt (lines 133-142) already defines Block Kit patterns. Replace inline JSON examples with plain text descriptions:

**Step 1** (lines 383-396) — currently 14 lines of Block Kit JSON → replace with:
```
Post an RFP analysis summary to Slack.
Header: "📋 RFP Analysis Complete"
Body (section with mrkdwn): Key points as a numbered list (project type, tech stack, complexity tier, similar past projects)
Footer (context): "Preparing clarifying questions..."
```

**Step 2** — clarification questions (lines 434-440) and assumption post (lines 473-479) — already have text descriptions. Remove the JSON and keep only the format description with field names.

**Step 3** (lines 536-540) — status update → replace with:
```
Post a status update: "🔍 Research complete — preparing estimation breakdown..."
```

**Step 4a** (lines 588-592) — status update → replace with:
```
Post a status update: "📊 Estimation breakdown ready — writing proposal document..."
```

The agent already knows Block Kit from SLACK FORMATTING RULES. These examples are redundant context.

**Estimated savings:** ~460 tokens per job

### A4: Condense Step 4a estimation references

**File:** `src/agents/orchestrator.ts` (lines 547-576)

The Step 4a prompt restates complexity tier rules and rate card info that's already in the system prompt's ESTIMATION RULES section. Condense:

Current lines 547-553:
```
1. Structure your estimation by Major Area → Action Items.
   Major Areas are high-level project phases/modules (e.g., "Discovery & Architecture",
   "Core Platform", "Integrations", "QA & Launch").
   Each action item should have brief assumptions.
   Follow the guardrails for your complexity tier (from Step 1):
   areas count, items per area, discovery effort, and which infrastructure items to include or skip.
   Do not exceed the tier's item counts without justification.
```

Replace with:
```
1. Structure your estimation by Major Area → Action Items.
   Follow the complexity tier guardrails from ESTIMATION RULES above.
```

Current lines 555-560 duplicate AI factor and rate card references already in the system prompt. Condense to reference.

**Estimated savings:** ~100 tokens per job

### A5: Conditionally exclude VBP section

**File:** `src/agents/orchestrator.ts` (lines 654-706 + 733-737)

When `job.skipSteps?.includes("value_discovery")`, the VBP section (section f "Alternative: Performance Partnership") and VBP review checks are loaded but overridden by a skip instruction. Instead, build the prompt conditionally:

Extract the VBP section into a variable and only include it when value discovery is not skipped.

Same for the VBP review checks (lines 733-737, items 10-13).

**Estimated savings:** ~700 tokens per job (when VBP is skipped)

### B1: Minimum chunk word count

**Files:** `scripts/seed-knowledge-base.ts` (line 79), `scripts/seed-case-studies.ts` (line 62)

Add validation in `chunkText()`:

```typescript
const MIN_CHUNK_WORDS = 10;

function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + CHUNK_WORDS).join(" ");
    if (chunk.trim() && chunk.split(/\s+/).length >= MIN_CHUNK_WORDS) chunks.push(chunk.trim());
    i += CHUNK_WORDS - CHUNK_OVERLAP_WORDS;
  }
  return chunks;
}
```

### B2: Move case studies to named namespace

**Files:** `scripts/seed-case-studies.ts` (line 221), `src/mcp-servers/knowledge-base.ts` (lines 204-210)

Seeding — change:
```typescript
await index.upsert({ records: [{ ... }] });
```
To:
```typescript
await index.namespace("case_studies").upsert({ records: [{ ... }] });
```

Query — change:
```typescript
const results = await index.query({ ... filter });
```
To:
```typescript
const results = await index.namespace("case_studies").query({ ... filter });
```

The `type: "case_study"` filter can be removed from `buildCaseStudyFilter` since namespace provides isolation. Keep industry/problem_type filters.

Also update the full re-index wipe in `seed-knowledge-base.ts` to also wipe `case_studies` namespace (for consistency), and update `seed-case-studies.ts` to wipe the namespace instead of using `deleteMany` with filter.

### B3: Orphan vector cleanup for incremental mode

**File:** `scripts/seed-knowledge-base.ts`

Add a `--cleanup` flag. When used:
1. List all files currently in the Drive folders
2. Build a set of valid file IDs
3. For each vector ID prefix in the state file, check if the source file still exists
4. Delete vectors whose source files are gone

Implementation: After seeding completes, compare `state` keys against the union of `sheetFiles` and `docFiles` IDs. Any state key not in the current file list → delete those vectors and remove from state.

```typescript
if (INCREMENTAL) {
  const currentFileIds = new Set([...sheetFiles.map(f => f.id), ...docFiles.map(f => f.id)]);
  const staleIds = Object.keys(state).filter(id => !currentFileIds.has(id));

  if (staleIds.length > 0) {
    console.log(`\n── Cleaning up ${staleIds.length} stale file(s) ──────────`);
    for (const fileId of staleIds) {
      // Delete summary + feature vectors
      const summaryId = `sheet_${fileId}_summary`;
      const featureIds = Array.from({ length: 50 }, (_, i) => `sheet_${fileId}_feat_${i}`);
      const proposalIds = Array.from({ length: 50 }, (_, i) => `proposal_${fileId}_chunk${i}`);

      try {
        await index.namespace("estimations").deleteMany([summaryId, ...featureIds]);
      } catch { /* namespace may not have this file */ }
      try {
        await index.namespace("proposals").deleteMany(proposalIds);
      } catch { /* namespace may not have this file */ }

      delete state[fileId];
      console.log(`  🗑️  Cleaned up vectors for file ${fileId}`);
    }
  }
}
```

---

## Plan

### Task 1: Cap `wait_for_reply` response size

**Files:**
- Modify: `src/mcp-servers/slack-interaction.ts` (line 79)

**Step 1: Add truncation constant and logic**

At top of file (after line 10), add:
```typescript
const MAX_REPLY_CHARS = 5000;
```

At line 79, change:
```typescript
        const replyText = humanReplies.map((m) => m.text ?? "").join("\n");
```
To:
```typescript
        let replyText = humanReplies.map((m) => m.text ?? "").join("\n");
        if (replyText.length > MAX_REPLY_CHARS) {
          replyText = replyText.slice(0, MAX_REPLY_CHARS) + `\n\n[... truncated, reply was ${replyText.length} chars ...]`;
        }
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/mcp-servers/slack-interaction.ts
git commit -m "fix(token-optimization): cap wait_for_reply at 5000 chars"
```

---

### Task 2: Add score threshold to KB searches

**Files:**
- Modify: `src/mcp-servers/knowledge-base.ts`

**Step 1: Add MIN_SCORE constant (after line 9)**

```typescript
const MIN_SCORE = 0.4;
```

**Step 2: Filter results in `search_past_estimations` (after line 132)**

Change line 137:
```typescript
          text: formatEstimationResults(results.matches as MatchRecord[]),
```
To:
```typescript
          text: formatEstimationResults(
            (results.matches as MatchRecord[]).filter((m) => (m.score ?? 0) >= MIN_SCORE),
          ),
```

**Step 3: Filter results in `search_past_proposals` (after line 161)**

Change line 163:
```typescript
      const formatted = results.matches
```
To:
```typescript
      const filtered = results.matches.filter((m) => (m.score ?? 0) >= MIN_SCORE);
      if (filtered.length === 0) {
        return { content: [{ type: "text" as const, text: "No matching past proposals found." }] };
      }
      const formatted = filtered
```

**Step 4: Filter results in `search_case_studies` (after line 210)**

Change line 212:
```typescript
      const formatted = results.matches
```
To:
```typescript
      const filtered = results.matches.filter((m) => (m.score ?? 0) >= MIN_SCORE);
      if (filtered.length === 0) {
        return { content: [{ type: "text" as const, text: "No matching case studies found." }] };
      }
      const formatted = filtered
```

**Step 5: Run type check**

Run: `npx tsc --noEmit`

**Step 6: Commit**

```bash
git add src/mcp-servers/knowledge-base.ts
git commit -m "fix(token-optimization): add 0.4 minimum score threshold to KB searches"
```

---

### Task 3: Remove inline Block Kit JSON from step prompts

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Replace Step 1 Block Kit JSON (lines ~383-396)**

Find the inline JSON block for the RFP analysis Slack message. Replace the full `blocks: [...]` and `text: "..."` with:

```
Post an RFP analysis summary to Slack (use Block Kit per SLACK FORMATTING RULES):
Header: "📋 RFP Analysis Complete"
Body: key points as a numbered list (project type, tech stack, complexity tier, reference to similar past projects if found)
Footer: "Preparing clarifying questions..."
```

**Step 2: Simplify Step 2 Block Kit examples (lines ~434-440 and ~473-479)**

For the clarification questions message, replace the full `blocks: [...]` JSON with:
```
Post questions to Slack using Block Kit:
Header: "❓ Clarifying Questions (ROUND/5)"
Body: numbered questions
Footer: "Reply in this thread — I'll proceed with reasonable defaults if no reply within 15 minutes ➡️"
```

For the assumption post, replace the full `blocks: [...]` JSON with:
```
Post assumptions to Slack using Block Kit:
Header: "📋 Proceeding with Assumptions"
Body: numbered assumptions
Footer: "Reply if any of these are incorrect — otherwise I'll continue with the estimation ➡️"
```

**Step 3: Simplify Step 3 and Step 4a status updates (lines ~536-540 and ~588-592)**

Replace each `blocks: [...] text: "..."` with a single line:
```
Post a Slack status update: "🔍 Research complete — preparing estimation breakdown..."
```

And:
```
Post a Slack status update: "📊 Estimation breakdown ready — writing proposal document..."
```

**Step 4: Run type check**

Run: `npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "fix(token-optimization): replace inline Block Kit JSON with text descriptions"
```

---

### Task 4: Condense Step 4a estimation references

**Files:**
- Modify: `src/agents/orchestrator.ts` (lines ~547-576)

**Step 1: Condense structure instructions (lines 547-553)**

Replace:
```
1. Structure your estimation by Major Area → Action Items.
   Major Areas are high-level project phases/modules (e.g., "Discovery & Architecture",
   "Core Platform", "Integrations", "QA & Launch").
   Each action item should have brief assumptions.
   Follow the guardrails for your complexity tier (from Step 1):
   areas count, items per area, discovery effort, and which infrastructure items to include or skip.
   Do not exceed the tier's item counts without justification.
```

With:
```
1. Structure your estimation by Major Area → Action Items per the ESTIMATION RULES complexity
   tier guardrails above. Each action item should have brief assumptions.
```

**Step 2: Condense effort instructions (lines 555-560)**

Replace:
```
2. Estimate effort in hours per action item using the ESTIMATION RULES rate card.
   Apply the AI productivity factor (30-40% reduction on development tasks).
   The tool converts hours → man-days automatically (÷8).
   Do NOT factor the client's deadline into your hour estimates.
   Estimate each item's effort as if there were no deadline constraint.
   The timeline is derived AFTER estimation by dividing total effort by team capacity.
```

With:
```
2. Estimate effort in hours per action item per the ESTIMATION RULES rate card and AI factor.
   The tool converts hours → man-days automatically (÷8).
   Estimate effort without deadline constraints — timeline is derived after.
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "fix(token-optimization): condense Step 4a estimation references"
```

---

### Task 5: Conditionally exclude VBP section from prompt

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Extract VBP section into a conditional variable**

Find the Step 4b document structure section. The VBP section starts at `f. heading level 1: "Alternative: Performance Partnership"` (line ~654) and ends before `g. page_break` (line ~707).

Also find the VBP review checks (lines ~733-737, items 10-13).

Before the prompt template literal, build conditional sections:

```typescript
  const vbpSkipped = job.skipSteps?.includes("value_discovery");

  const vbpSection = vbpSkipped ? "" : `
   f. heading level 1: "Alternative: Performance Partnership"
      [... existing VBP content ...]
`;

  const vbpChecks = vbpSkipped ? "" : `
VALUE-BASED PRICING CHECKS:
10. Value Projection table: ...
[... existing VBP checks ...]
`;
```

Interpolate `${vbpSection}` and `${vbpChecks}` in the prompt where the VBP content currently sits.

**Step 2: Remove the VBP override from skipInstructions**

The current skip instruction (line ~362):
```typescript
  if (job.skipSteps?.includes("value_discovery")) {
    skipInstructions.push("SKIP Step 3 entirely — do not perform value discovery research. Do NOT include the 'Alternative: Performance Partnership' section in the offer.");
  }
```

Simplify to:
```typescript
  if (job.skipSteps?.includes("value_discovery")) {
    skipInstructions.push("SKIP Step 3 entirely — do not perform value discovery research.");
  }
```

The "Do NOT include VBP section" override is no longer needed since the section won't be in the prompt at all.

**Step 3: Run type check**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "fix(token-optimization): conditionally exclude VBP section when value discovery skipped"
```

---

### Task 6: Minimum chunk word count in seed scripts

**Files:**
- Modify: `scripts/seed-knowledge-base.ts` (line 79)
- Modify: `scripts/seed-case-studies.ts` (line 62)

**Step 1: Add MIN_CHUNK_WORDS constant to seed-knowledge-base.ts (after line 31)**

```typescript
const MIN_CHUNK_WORDS = 10;
```

**Step 2: Update chunkText filter (line 79)**

Change:
```typescript
    if (chunk.trim()) chunks.push(chunk.trim());
```
To:
```typescript
    const trimmed = chunk.trim();
    if (trimmed && trimmed.split(/\s+/).length >= MIN_CHUNK_WORDS) chunks.push(trimmed);
```

**Step 3: Apply same change to seed-case-studies.ts**

Add `const MIN_CHUNK_WORDS = 10;` after line 21.

Change line 62:
```typescript
    if (chunk.trim()) chunks.push(chunk.trim());
```
To:
```typescript
    const trimmed = chunk.trim();
    if (trimmed && trimmed.split(/\s+/).length >= MIN_CHUNK_WORDS) chunks.push(trimmed);
```

**Step 4: Commit**

```bash
git add scripts/seed-knowledge-base.ts scripts/seed-case-studies.ts
git commit -m "fix(pinecone-quality): skip chunks under 10 words during seeding"
```

---

### Task 7: Move case studies to named namespace

**Files:**
- Modify: `scripts/seed-case-studies.ts` (line 221)
- Modify: `src/mcp-servers/knowledge-base.ts` (lines 96-104, 204-210)
- Modify: `scripts/seed-knowledge-base.ts` (lines 278-292, full wipe section)

**Step 1: Update seeding to use namespace (seed-case-studies.ts line 221)**

Change:
```typescript
      await index.upsert({
```
To:
```typescript
      await index.namespace("case_studies").upsert({
```

**Step 2: Update deletion to use namespace (seed-case-studies.ts lines 182-184)**

Change:
```typescript
    await index.deleteMany({ filter: { type: { $eq: "case_study" } } });
```
To:
```typescript
    await index.namespace("case_studies").deleteAll();
```

**Step 3: Simplify buildCaseStudyFilter (knowledge-base.ts lines 96-104)**

Change:
```typescript
export function buildCaseStudyFilter(
  industry?: string,
  problem_type?: string,
): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [{ type: { $eq: "case_study" } }];
  if (industry) conditions.push({ industry: { $eq: industry } });
  if (problem_type) conditions.push({ problem_type: { $eq: problem_type } });
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}
```
To:
```typescript
export function buildCaseStudyFilter(
  industry?: string,
  problem_type?: string,
): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown>[] = [];
  if (industry) conditions.push({ industry: { $eq: industry } });
  if (problem_type) conditions.push({ problem_type: { $eq: problem_type } });
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}
```

**Step 4: Update query to use namespace (knowledge-base.ts lines 204-210)**

Change:
```typescript
      const results = await index.query({
        vector: embedding,
        topK: top_k,
        includeMetadata: true,
        filter,
      });
```
To:
```typescript
      const results = await index.namespace("case_studies").query({
        vector: embedding,
        topK: top_k,
        includeMetadata: true,
        ...(filter ? { filter } : {}),
      });
```

**Step 5: Add case_studies namespace wipe in full re-index (seed-knowledge-base.ts)**

After the proposals namespace wipe (line ~291), add:
```typescript
    try {
      await index.namespace("case_studies").deleteAll();
      console.log("  ✅ case_studies namespace cleared");
    } catch {
      console.log("  ℹ️  case_studies namespace empty or not found");
    }
```

**Step 6: Run type check**

Run: `npx tsc --noEmit`

**Step 7: Commit**

```bash
git add scripts/seed-case-studies.ts src/mcp-servers/knowledge-base.ts scripts/seed-knowledge-base.ts
git commit -m "fix(pinecone-quality): move case studies to named namespace"
```

---

### Task 8: Add orphan vector cleanup for incremental seeding

**Files:**
- Modify: `scripts/seed-knowledge-base.ts`

**Step 1: Add cleanup logic after seeding completes (after line ~417, before state save)**

After the doc processing loop ends, before `if (INCREMENTAL) { saveState(state)`:

```typescript
  // ── Orphan cleanup (incremental only) ─────────────────────────────────────
  if (INCREMENTAL) {
    const currentFileIds = new Set([...sheetFiles.map((f) => f.id), ...docFiles.map((f) => f.id)]);
    const staleFileIds = Object.keys(state).filter((id) => !currentFileIds.has(id));

    if (staleFileIds.length > 0) {
      console.log(`\n── Cleaning up ${staleFileIds.length} stale file(s) ────────`);
      for (const fileId of staleFileIds) {
        const sheetIds = [`sheet_${fileId}_summary`, ...Array.from({ length: 50 }, (_, i) => `sheet_${fileId}_feat_${i}`)];
        const docIds = Array.from({ length: 50 }, (_, i) => `proposal_${fileId}_chunk${i}`);

        try { await index.namespace("estimations").deleteMany(sheetIds); } catch { /* ignore */ }
        try { await index.namespace("proposals").deleteMany(docIds); } catch { /* ignore */ }

        delete state[fileId];
        console.log(`  🗑️  Removed vectors for deleted file ${fileId}`);
      }
    }
  }
```

**Step 2: Commit**

```bash
git add scripts/seed-knowledge-base.ts
git commit -m "fix(pinecone-quality): clean up orphaned vectors for deleted Drive files"
```

---

### Task 9: Final verification

**Step 1: Run full type check**

Run: `npx tsc --noEmit`

**Step 2: Run all tests**

Run: `npm test`

**Step 3: Verify changes**

- `grep -r "MAX_REPLY_CHARS" src/mcp-servers/slack-interaction.ts` — should find the constant
- `grep -r "MIN_SCORE" src/mcp-servers/knowledge-base.ts` — should find the constant and filter usage
- `grep -r "MIN_CHUNK_WORDS" scripts/` — should find in both seed scripts
- `grep -r "case_studies" scripts/ src/mcp-servers/knowledge-base.ts` — should find namespace references
- Verify no inline Block Kit JSON remains in step descriptions (only in system prompt rules and completion message)

**Step 4: Self-review checklist**

- Error propagation: all MCP tool handlers still catch and return errors (no re-throw needed)
- Prompt safety: no new user data interpolated into prompts
- Score threshold: 0.4 is a reasonable default — watch first few runs for false negatives

**Step 5: Push and create PR**

```bash
git push -u origin feat/token-optimization
gh pr create --title "fix: token optimization + Pinecone data quality" --body "..."
```

**Step 6: Re-seed Pinecone after merge**

After merging, run a full re-seed to apply namespace changes:
```bash
npx tsx scripts/seed-knowledge-base.ts
npx tsx scripts/seed-case-studies.ts
```
