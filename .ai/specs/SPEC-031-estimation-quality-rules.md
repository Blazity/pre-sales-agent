# SPEC-031: Estimation Quality Rules from User Feedback

**Status**: Implemented
**Date**: 2026-03-11

## Problem

User feedback on the Endeavor Schools estimation identified 6 quality issues:
1. Component work didn't include assumed component count
2. QA was 4 MD for a simple single-page site (should be 1-2 MD, done by devs)
3. Fractional MD values like 1.3 and 0.6 (should use 0.5 steps)
4. CMS webhook estimated at 0.6 MD (minimum 2 MD for simple sites)
5. Multi-step lead form with integrations at 2 MD (should be 3-4 MD given unknowns)
6. Hosting setup split into multiple items (should be consolidated)

## Design

### Code change: Round MD to nearest 0.5
Replace `Number(md.toFixed(1))` with `Math.round(md * 2) / 2` in `buildEstimationRows`. Minimum 0.5 for non-zero values.

### Prompt change: New "Estimation Quality Rules" block
Added to ESTIMATION RULES section after Estimation Independence. Six rules covering component counts, QA scaling, minimum granularity, webhooks, forms with integrations, and infrastructure consolidation.

### Prompt change: Update SIMPLE tier QA note
Change "Keep: basic QA (1-2 MD)" to "Keep: QA by developers (1-2 MD)" to reinforce that simple projects don't get separate QA.

## Files Changed

| File | Change |
|------|--------|
| `src/mcp-servers/google-workspace.ts` | Round MD to nearest 0.5 in `buildEstimationRows` |
| `src/mcp-servers/google-workspace.test.ts` | Update rounding test, add 0.5-step rounding tests |
| `src/agents/orchestrator.ts` | New "Estimation Quality Rules" block, update SIMPLE tier QA |

## Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Incorporate user feedback into estimation quality rules and enforce 0.5 MD step rounding.

**Architecture:** One code change (rounding logic in `buildEstimationRows`), updated tests, and prompt text additions. TDD for the rounding change.

**Tech Stack:** TypeScript, Node test runner

---

### Task 1: Update rounding tests (TDD — write failing tests first)

**Files:**
- Modify: `src/mcp-servers/google-workspace.test.ts:507-516`

**Step 1: Replace the "rounds man-days to one decimal place" test and add new rounding tests**

Find the test (~line 507-516):

```typescript
  it("rounds man-days to one decimal place", () => {
    const rows = buildEstimationRows([
      {
        name: "Dev",
        items: [{ name: "Build it", effort_hours: 100, parallel: false, assumptions: "" }],
      },
    ]);

    assert.equal(rows[0][2], 12.5);
  });
```

Replace with:

```typescript
  it("rounds man-days to nearest 0.5", () => {
    const rows = buildEstimationRows([
      {
        name: "Dev",
        items: [{ name: "Build it", effort_hours: 100, parallel: false, assumptions: "" }],
      },
    ]);

    // 100h / 8 = 12.5 → 12.5 (already on 0.5 boundary)
    assert.equal(rows[0][2], 12.5);
  });

  it("rounds 1.3 MD up to 1.5", () => {
    // 10h / 8 = 1.25 → rounds to 1.5
    const rows = buildEstimationRows([
      {
        name: "Dev",
        items: [{ name: "Task", effort_hours: 10, parallel: false, assumptions: "" }],
      },
    ]);

    assert.equal(rows[0][2], 1.5);
  });

  it("rounds 0.6 MD up to 0.5", () => {
    // 5h / 8 = 0.625 → rounds to 0.5
    const rows = buildEstimationRows([
      {
        name: "Dev",
        items: [{ name: "Task", effort_hours: 5, parallel: false, assumptions: "" }],
      },
    ]);

    assert.equal(rows[0][2], 0.5);
  });

  it("enforces 0.5 minimum for non-zero hours", () => {
    // 2h / 8 = 0.25 → rounds to 0.5 (minimum)
    const rows = buildEstimationRows([
      {
        name: "Dev",
        items: [{ name: "Task", effort_hours: 2, parallel: false, assumptions: "" }],
      },
    ]);

    assert.equal(rows[0][2], 0.5);
  });
```

**Step 2: Run tests to confirm failures**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: FAIL — "rounds 1.3 MD up to 1.5" will fail (current code produces 1.3).

**Step 3: Commit**

```bash
git add src/mcp-servers/google-workspace.test.ts
git commit -m "test(estimation-quality): add 0.5 MD step rounding tests"
```

---

### Task 2: Implement 0.5 MD step rounding

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:1165-1166`

**Step 1: Replace the rounding logic in buildEstimationRows**

Find (~line 1165-1166):

```typescript
      const md = item.effort_hours / 8;
      const mdNum = Number.isInteger(md) ? md : Number(md.toFixed(1));
```

Replace with:

```typescript
      const md = item.effort_hours / 8;
      const mdNum = md === 0 ? 0 : Math.max(0.5, Math.round(md * 2) / 2);
```

**Step 2: Run tests**

Run: `npx tsx --test src/mcp-servers/google-workspace.test.ts`
Expected: PASS — all rounding tests green.

**Step 3: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "feat(estimation-quality): round MD values to nearest 0.5 step"
```

---

### Task 3: Add Estimation Quality Rules to orchestrator prompt

**Files:**
- Modify: `src/agents/orchestrator.ts`

**Step 1: Add new block after Estimation Independence**

Find the end of the Estimation Independence block:

```
3. If the required team exceeds your complexity-tier guideline, add a risk note in the offer:
   "Timeline is aggressive — requires full team availability from kickoff."

Page Budget:
```

Insert between them:

```
3. If the required team exceeds your complexity-tier guideline, add a risk note in the offer:
   "Timeline is aggressive — requires full team availability from kickoff."

Estimation Quality Rules:

1. COMPONENT COUNTS: When estimating UI/component work (e.g., "component library from Figma"),
   state the assumed number of components in the assumptions column
   (e.g., "~15 universal components from Figma design system").

2. QA SCALING: Scale QA effort to project complexity.
   - SIMPLE projects: QA is done by developers (no separate QA line item). Budget 1-2 MD total.
   - MEDIUM projects: 2-4 MD QA.
   - COMPLEX projects: dedicated QA role, 5-10+ MD.

3. MINIMUM GRANULARITY: Estimate in 0.5 MD steps minimum. Never use values like 0.6, 1.3, 2.7.
   Use: 0.5, 1, 1.5, 2, 2.5, etc. The tool rounds to nearest 0.5 automatically.

4. WEBHOOK / CACHE INVALIDATION: CMS webhook + cache invalidation is not trivial.
   Minimum 2 MD for simple sites, 3-5 MD for complex setups.

5. FORMS WITH INTEGRATIONS: Multi-step forms with 3rd party integrations, real-time validation,
   and conditional rendering carry integration risk. Minimum 3-4 MD even for simple projects.
   If field count and types are unknown, add a risk note in assumptions.

6. INFRASTRUCTURE CONSOLIDATION: Group related infra items into single action items:
   - "Vercel configuration (staging + production)" instead of separate items for each environment
   - "CI/CD + deployment pipeline" instead of splitting CI and CD

Page Budget:
```

**Step 2: Update SIMPLE tier QA note**

Find in the SIMPLE tier block:

```
  - Keep: basic QA (1-2 MD), deployment, responsive implementation
```

Replace with:

```
  - Keep: QA by developers (1-2 MD), deployment, responsive implementation
```

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-quality): add estimation quality rules from user feedback"
```

---

### Task 4: Type-check, test, and finalize

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Update spec and index**

Mark all tasks `[x]` in this spec. Set status to "Implemented".
In `.ai/specs/README.md`, update SPEC-031 status to "Implemented".

```bash
git add .ai/specs/SPEC-031-estimation-quality-rules.md .ai/specs/README.md
git commit -m "docs(estimation-quality): mark SPEC-031 as implemented"
```

---

- [x] Task 1: Update rounding tests (TDD)
- [x] Task 2: Implement 0.5 MD step rounding
- [x] Task 3: Add Estimation Quality Rules to orchestrator prompt
- [x] Task 4: Type-check, test, and finalize
