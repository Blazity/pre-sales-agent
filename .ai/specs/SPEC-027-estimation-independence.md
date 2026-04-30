# SPEC-027: Estimation Independence & Sanity Check

**Status**: Implemented
**Date**: 2026-03-11

## Problem

The orchestrator agent adjusts its effort estimates to fit the client's deadline instead of estimating independently. Man-days ≠ calendar days — effort should be estimated based on scope, then the timeline derived from team capacity.

## Design

### 1. Estimation Independence Rule (ESTIMATION RULES section)

New block after "AI Productivity Factor":

```
Estimation Independence:
Estimate effort (man-days) based ONLY on scope complexity, past estimation data, and AI productivity.
NEVER adjust hours to fit a client deadline. Man-days ≠ calendar days — a 60 MD project with a
3-person team takes ~20 business days, not 60. After estimating effort:
1. Derive the timeline: total MD ÷ team size = calendar weeks (add 15% buffer).
2. Accept the client's deadline. Size the team to fit it.
3. If the required team exceeds your complexity-tier guideline, add a risk note in the offer:
   "Timeline is aggressive — requires full team availability from kickoff."
```

### 2. Step 4a: Reinforce decoupling

After "Estimate effort in hours per action item":

```
   Do NOT factor the client's deadline into your hour estimates.
   Estimate each item's effort as if there were no deadline constraint.
   The timeline is derived AFTER estimation by dividing total effort by team capacity.
```

### 3. Sanity Check (new Step 4a sub-step after sheet creation)

```
4. SANITY CHECK — Compare your estimate against the past estimations found in Step 1:
   - For each Major Area, check if your hours are within 2x of comparable features from past projects.
   - If your total hours diverge >50% from a similar past project, you MUST either:
     a) Justify the difference (e.g., "scope includes X which past project didn't"), OR
     b) Revise the estimate to be closer to the historical data.
   - Log your comparison briefly: "Past [Project]: Xh total. This estimate: Yh. Delta: Z% — [justified/revised]."
   This comparison is internal — do not include it in the offer document.
```

### 4. Calibration Check 21 update

```
21. Timeline matches hours÷capacity math: Does the timeline duration equal total MD ÷ team size
    (with 15% buffer)? The timeline must be derived FROM the estimate, not fitted TO the client's deadline.
```

## Files Changed

| File | Change |
|------|--------|
| `src/agents/orchestrator.ts` | 4 prompt sections: Estimation Independence rule, Step 4a reinforcement, sanity check step, check 21 |

## Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Decouple effort estimation from client deadlines and add a sanity check against past project data.

**Architecture:** Four prompt text edits in `src/agents/orchestrator.ts`. No code logic, no tests — pure prompt engineering. The orchestrator's system prompt is a template literal starting ~line 130.

**Tech Stack:** TypeScript (template literal string edits only)

**IMPORTANT:** This spec depends on SPEC-026 (man-days per item) being merged first. The line numbers below assume SPEC-026 changes are on the branch. If not, wait for SPEC-026 to merge before starting.

---

### Task 1: Add Estimation Independence rule to ESTIMATION RULES

**Files:**
- Modify: `src/agents/orchestrator.ts:228-229`

**Step 1: Add the new block**

Find this text in the orchestrator system prompt (after the AI Productivity Factor block):

```
After estimating hours conservatively, apply 30-40% reduction to development tasks (not discovery, design, or QA). State explicitly: "Hours reflect AI-augmented development workflow (est. 35% productivity gain)."

Page Budget:
```

Insert a new block between the AI Productivity Factor line and the blank line before "Page Budget:". The result should be:

```
After estimating hours conservatively, apply 30-40% reduction to development tasks (not discovery, design, or QA). State explicitly: "Hours reflect AI-augmented development workflow (est. 35% productivity gain)."

Estimation Independence:
Estimate effort (man-days) based ONLY on scope complexity, past estimation data, and AI productivity.
NEVER adjust hours to fit a client deadline. Man-days ≠ calendar days — a 60 MD project with a
3-person team takes ~20 business days, not 60. After estimating effort:
1. Derive the timeline: total MD ÷ team size = calendar weeks (add 15% buffer).
2. Accept the client's deadline. Size the team to fit it.
3. If the required team exceeds your complexity-tier guideline, add a risk note in the offer:
   "Timeline is aggressive — requires full team availability from kickoff."

Page Budget:
```

**Step 2: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-independence): add estimation independence rule to prompt"
```

---

### Task 2: Reinforce decoupling in Step 4a

**Files:**
- Modify: `src/agents/orchestrator.ts` (Step 4a, point 2)

**Step 1: Add deadline decoupling lines**

Find this text in Step 4a:

```
2. Estimate effort in hours per action item using the ESTIMATION RULES rate card.
   Apply the AI productivity factor (30-40% reduction on development tasks).
   The tool converts hours → man-days automatically (÷8).
```

Replace with:

```
2. Estimate effort in hours per action item using the ESTIMATION RULES rate card.
   Apply the AI productivity factor (30-40% reduction on development tasks).
   The tool converts hours → man-days automatically (÷8).
   Do NOT factor the client's deadline into your hour estimates.
   Estimate each item's effort as if there were no deadline constraint.
   The timeline is derived AFTER estimation by dividing total effort by team capacity.
```

**Step 2: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-independence): reinforce deadline decoupling in Step 4a"
```

---

### Task 3: Add sanity check step after sheet creation

**Files:**
- Modify: `src/agents/orchestrator.ts` (Step 4a, after point 4)

**Step 1: Insert sanity check as new point 5**

Find this text in Step 4a:

```
4. Note the total hours and total EUR (hours × blended rate from rate card)
   for use in the offer document's Investment Summary.

5. Post a brief status update to Slack:
```

Replace with (renumber the Slack post to 6):

```
4. Note the total hours and total EUR (hours × blended rate from rate card)
   for use in the offer document's Investment Summary.

5. SANITY CHECK — Compare your estimate against the past estimations found in Step 1:
   - For each Major Area, check if your hours are within 2x of comparable features from past projects.
   - If your total hours diverge >50% from a similar past project, you MUST either:
     a) Justify the difference (e.g., "scope includes X which past project didn't"), OR
     b) Revise the estimate to be closer to the historical data.
   - Log your comparison briefly: "Past [Project]: Xh total. This estimate: Yh. Delta: Z% — [justified/revised]."
   This comparison is internal — do not include it in the offer document.

6. Post a brief status update to Slack:
```

**Step 2: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-independence): add sanity check step against past estimations"
```

---

### Task 4: Strengthen calibration check 21

**Files:**
- Modify: `src/agents/orchestrator.ts` (ESTIMATION CALIBRATION CHECKS section)

**Step 1: Replace check 21**

Find this text:

```
21. Timeline matches hours÷capacity math: Does the timeline duration equal total hours ÷ team weekly capacity (with buffer)?
```

Replace with:

```
21. Timeline matches hours÷capacity math: Does the timeline duration equal total MD ÷ team size (with 15% buffer)? The timeline must be derived FROM the estimate, not fitted TO the client's deadline.
```

**Step 2: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(estimation-independence): strengthen check 21 to enforce estimation-first timeline"
```

---

### Task 5: Verify and finalize

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors (prompt changes are just string edits inside a template literal).

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (no test changes needed — this is prompt-only).

**Step 3: Update spec checkboxes**

In `.ai/specs/SPEC-027-estimation-independence.md`, mark all tasks `[x]` and set status to "Implemented".
In `.ai/specs/README.md`, update SPEC-027 status from "Planning" to "Implemented".

**Step 4: Commit**

```bash
git add .ai/specs/SPEC-027-estimation-independence.md .ai/specs/README.md
git commit -m "docs(estimation-independence): mark SPEC-027 as implemented"
```

---

- [x] Task 1: Add Estimation Independence rule to ESTIMATION RULES
- [x] Task 2: Reinforce decoupling in Step 4a
- [x] Task 3: Add sanity check step after sheet creation
- [x] Task 4: Strengthen calibration check 21
- [x] Task 5: Verify and finalize
