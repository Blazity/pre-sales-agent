# SPEC-029: Complexity-Aware Estimation Tiers

**Status**: Implemented
**Date**: 2026-03-11

## Problem

The agent over-scopes and over-estimates simple projects. A landing page gets 7 Major Areas, 30+ action items, and enterprise-grade infrastructure (architecture phase, component library, security audit). There's no guidance telling the agent that a simple info site needs a different estimation structure than an enterprise migration.

## Design

Add a "Project Complexity Classification" block to ESTIMATION RULES with tier-specific guardrails for structure (areas, items) and effort (discovery, total MD). The agent classifies the project in Step 1 and follows the tier's bounds in Step 4a.

### Prompt Changes

1. New "Project Complexity Classification" block after Rate Card, before Team Sizing
2. Add "typically" to Team Sizing budget ranges (tier is now driven by complexity, not just budget)
3. Update Step 1 point 4 to include classification
4. Update Step 1 Slack summary complexity field to use tier names
5. Update Step 4a to reference tier guardrails

## Files Changed

| File | Change |
|------|--------|
| `src/agents/orchestrator.ts` | 5 prompt text edits |

## Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the estimation agent classify project complexity and follow tier-specific guardrails for scope and effort.

**Architecture:** Five prompt text edits in the orchestrator system prompt template literal. No code logic, no tests. Pure prompt engineering.

**Tech Stack:** TypeScript (template literal string edits only)

---

### Task 1: Add Project Complexity Classification block

**Files:**
- Modify: `src/agents/orchestrator.ts` (ESTIMATION RULES section)

**Step 1: Insert new block after Rate Card**

Find this text:

```
Add 10% PM overhead to the total (not a separate line item).

Team Sizing (AI-augmented):
```

Replace with:

```
Add 10% PM overhead to the total (not a separate line item).

Project Complexity Classification:

Classify the project BEFORE estimating. State the tier in your Step 1 Slack summary.

SIMPLE — Landing page, info site, brochure site, single-purpose microsite.
  Few or no integrations. Static or lightweight CMS. No auth. No complex data flows.
  - Major Areas: 3-4
  - Action items per area: 2-4 (total 8-15 items)
  - Discovery: 1-2 MD max
  - Total estimate range: 10-30 MD
  - Skip: dedicated architecture phase, component library, performance testing, security audit
  - Keep: basic QA (1-2 MD), deployment, responsive implementation

MEDIUM — Multi-page app with CMS, 2-3 integrations, forms, moderate interactivity.
  - Major Areas: 4-6
  - Action items per area: 3-6 (total 15-25 items)
  - Discovery: 3-5 MD
  - Total estimate range: 30-80 MD
  - Standard: CI/CD, staging environment, cross-browser QA, basic monitoring

COMPLEX — Enterprise migration, e-commerce platform, multi-tenant SaaS, heavy integrations (5+).
  Auth, role-based access, complex data flows, performance-critical.
  - Major Areas: 5-8
  - Action items per area: 4-8 (total 25-40 items)
  - Discovery: 5-10 MD
  - Total estimate range: 80-200+ MD
  - Full: architecture phase, component library, performance testing, security audit, monitoring, load testing

If your estimate falls outside the tier's MD range, you MUST add a one-line justification
(e.g., "30 MD exceeds Simple range because of 3 external API integrations").

Team Sizing (AI-augmented):
```

**Step 2: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(complexity-tiers): add project complexity classification to estimation rules"
```

---

### Task 2: Update Team Sizing to reference tiers

**Files:**
- Modify: `src/agents/orchestrator.ts` (Team Sizing section)

**Step 1: Add "typically" to budget ranges**

Find:

```
Team Sizing (AI-augmented):
- Simple (<100k EUR): 1 senior/architect + AI agent. Add 1 mid only if scope demands parallel workstreams.
- Medium (100-200k EUR): 1 architect (part-time) + 1-2 seniors + 1 mid + designer.
- Complex (>200k EUR): 1 architect + 2-3 seniors + 1-2 mids + designer + QA.
```

Replace with:

```
Team Sizing (AI-augmented):
- Simple (typically <100k EUR): 1 senior/architect + AI agent. Add 1 mid only if scope demands parallel workstreams.
- Medium (typically 100-200k EUR): 1 architect (part-time) + 1-2 seniors + 1 mid + designer.
- Complex (typically >200k EUR): 1 architect + 2-3 seniors + 1-2 mids + designer + QA.
```

**Step 2: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(complexity-tiers): align team sizing with complexity tiers"
```

---

### Task 3: Update Step 1 to include classification

**Files:**
- Modify: `src/agents/orchestrator.ts` (Step 1, point 4 and Slack summary)

**Step 1: Update Step 1 point 4 to include tier classification**

Find:

```
4. Analyze the RFP internally: scope, tech stack, complexity, timeline, risks.
   Do NOT post assumptions or unknowns here — save those for Step 2.
```

Replace with:

```
4. Analyze the RFP internally: scope, tech stack, complexity, timeline, risks.
   Classify the project as SIMPLE, MEDIUM, or COMPLEX per the Project Complexity Classification rules.
   Do NOT post assumptions or unknowns here — save those for Step 2.
```

**Step 2: Update Slack summary complexity field**

Find:

```
    {"type": "mrkdwn", "text": "*Complexity:*\n[Low / Medium / High — 1 line reason]"},
```

Replace with:

```
    {"type": "mrkdwn", "text": "*Complexity:*\n[SIMPLE / MEDIUM / COMPLEX — 1 line reason]"},
```

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(complexity-tiers): classify project complexity in Step 1"
```

---

### Task 4: Update Step 4a to reference tier guardrails

**Files:**
- Modify: `src/agents/orchestrator.ts` (Step 4a)

**Step 1: Add tier reference after action items guidance**

Find:

```
1. Structure your estimation by Major Area → Action Items.
   Major Areas are high-level project phases/modules (e.g., "Discovery & Architecture",
   "Core Platform", "Integrations", "QA & Launch").
   Each Major Area should have 3-8 specific action items with brief assumptions.
```

Replace with:

```
1. Structure your estimation by Major Area → Action Items.
   Major Areas are high-level project phases/modules (e.g., "Discovery & Architecture",
   "Core Platform", "Integrations", "QA & Launch").
   Follow the guardrails for your complexity tier (from Step 1):
   areas count, items per area, discovery effort, and which infrastructure items to include or skip.
   Do not exceed the tier's item counts without justification.
```

**Step 2: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(complexity-tiers): reference tier guardrails in Step 4a"
```

---

### Task 5: Type-check, verify, and finalize

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Update spec and index**

Mark all tasks `[x]` in this spec. Set status to "Implemented".
In `.ai/specs/README.md`, update SPEC-029 status to "Implemented".

```bash
git add .ai/specs/SPEC-029-complexity-aware-estimation.md .ai/specs/README.md
git commit -m "docs(complexity-tiers): mark SPEC-029 as implemented"
```

---

- [x] Task 1: Add Project Complexity Classification block
- [x] Task 2: Update Team Sizing to reference tiers
- [x] Task 3: Update Step 1 to include classification
- [x] Task 4: Update Step 4a to reference tier guardrails
- [x] Task 5: Type-check, verify, and finalize
