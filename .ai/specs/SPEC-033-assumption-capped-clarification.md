# SPEC-033: Assumption-Capped Clarification Loop

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the round-count-based clarification exit logic with an assumption-count-based exit, so the agent keeps asking until it has ≤5 assumptions instead of stopping after 2 rounds.

**Architecture:** Prompt-only change in the orchestrator Step 2 section. No code changes.

**Tech Stack:** N/A — prompt engineering only.

**Status:** Implemented
**Date:** 2026-03-11
**Scope:** `src/agents/orchestrator.ts` (Step 2 prompt text, lines ~411-474)

---

## Problem

The current Step 2 clarification loop requires a minimum of 2 rounds before the agent can exit. In practice, the agent hits round 2 and rationalizes areas as "not relevant" or "partially known is fine" to satisfy the exit condition (`round >= 2` + `≤2 UNKNOWN areas`). This results in offers with many assumptions that should have been clarified.

## Design

### New exit logic

- **Minimum:** 1 round (even detailed RFPs need validation)
- **Maximum:** 5 rounds (unchanged)
- **Primary exit condition:** After each round, build an explicit **Assumptions List** — every fact the agent would assume if it stopped now. If ≤5 assumptions, exit. If >5, keep asking about the highest-impact unknowns.
- **Secondary condition:** No vague answers from current round ("TBD", "not sure", "we'll figure it out" require follow-up)
- **Timeout:** `wait_for_reply` timeout → exit immediately, all unknowns become assumptions (unchanged)

### Assumption quality rules

Each assumption must be:
- **Specific** — "Standard OAuth 2.0" not "auth will be handled"
- **Actionable** — directly affects estimation scope or effort
- **One per item** — no bundling multiple unknowns into one assumption

### Slack assumption post (new)

Before proceeding to Step 3, post the final assumption list to Slack (informational, no `wait_for_reply`):
```
📋 Proceeding with these assumptions:
1. [assumption]
2. [assumption]
...
Reply if any are incorrect — otherwise I'll continue.
```

### Knowledge checklist

Keep the 9 areas (A–I) as an internal thinking aid for the agent to ensure broad coverage, but remove them from the exit condition formula. Exit is driven by assumption count only.

---

## Plan

### Task 1: Rewrite Step 2 prompt in orchestrator

**Files:**
- Modify: `src/agents/orchestrator.ts` — the Step 2 block (lines ~411-474)

**Step 1: Replace the entire Step 2 section**

Find the block starting with `## Step 2: Clarifying Questions (Multi-Round)` (line 411) through `After 5 rounds, proceed to Step 3 regardless. Flag any remaining gaps as assumptions.` (line 474).

Replace with:

```
## Step 2: Clarifying Questions (Assumption-Minimizing)
SKIP CONDITION — go directly to Step 3 ONLY if:
- clarificationAnswers were already provided in the CONTEXT above

In ALL other cases, you MUST ask at least one round of questions. Even detailed RFPs have unknowns
around integrations, deployment, design ownership, compliance, or timeline constraints.
Do NOT skip this step just because the RFP looks comprehensive.

Run a multi-round clarification loop (minimum 1 round, maximum 5 rounds):

KNOWLEDGE AREAS — use these as a mental checklist to ensure broad coverage. You do NOT need to
confirm every area — only track them to avoid blind spots:
  A. Scope boundaries — what is included vs out of scope, MVP vs full vision
  B. Integrations — existing systems, APIs, third-party services to connect with
  C. Users & scale — target users, expected traffic/load, growth projections
  D. Tech constraints — preferred stack, existing infrastructure, deployment environment
  E. Design — existing brand guidelines, design system, Figma files, design ownership
  F. Timeline & priorities — hard deadlines, launch dependencies, phasing preferences
  G. Budget expectations — range, approval process, payment structure preferences
  H. Compliance & security — data handling, regulations (GDPR, SOC2, HIPAA), auth requirements
  I. Team & process — client team involvement, review/approval cadence, stakeholders

ROUND LOOP — repeat for round = 1..5:
1. Identify ALL genuine unknowns — anything you are uncertain about. Group questions by topic.
   Do NOT ask about anything already stated in the RFP, already answered in a previous round,
   or covered in your Step 1 analysis. There is no per-round question limit — ask as many as needed.
   Examples of good questions: deployment preferences, existing systems to integrate with,
   compliance requirements, expected traffic scale, user roles, performance expectations.
   Examples of BAD questions: restating scope items as questions, asking for confirmation
   of things already in the RFP, asking about tech stack when the RFP already specifies one.
   First-round questions should be broad (covering multiple knowledge areas).
   Follow-up rounds should drill into vague or incomplete answers from previous rounds.

2. Post questions to Slack using blocks. Label each round clearly:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "❓ Clarifying Questions (ROUND/5)"}},
  {"type": "section", "text": {"type": "mrkdwn", "text": "1. [Question one]\\n2. [Question two]\\n..."}},
  {"type": "context", "elements": [{"type": "mrkdwn", "text": "Reply in this thread — I'll proceed with reasonable defaults if no reply within 15 minutes ➡️"}]}
]
text: "❓ Clarifying questions (round ROUND/5) — please reply in this thread"
   Replace ROUND with the current round number (1, 2, 3…).

3. Call wait_for_reply to get the client's answers.

4. ASSUMPTION GATE — after receiving answers, build your ASSUMPTIONS LIST:
   List every fact you would ASSUME if you stopped asking questions right now.
   Each assumption must be:
   - SPECIFIC: "Standard OAuth 2.0 for auth" not "auth will be handled"
   - ACTIONABLE: directly affects estimation scope, effort, or architecture
   - ONE PER ITEM: do not bundle multiple unknowns into a single assumption
     ("deployment + CI/CD + monitoring" = 3 assumptions, not 1)

   Count your assumptions.

   EXIT CONDITIONS (ALL must be true to exit the loop):
   - You have completed at least 1 round
   - Your assumptions list has AT MOST 5 items
   - No answer from the current round was vague enough to warrant a targeted follow-up
     (e.g., "we'll figure it out later", "not sure", "TBD" — these REQUIRE a follow-up)

   If exit conditions are NOT met → identify the highest-impact unknowns from your
   assumptions list, referencing the client's previous answers, and continue to the
   next round with targeted follow-up questions. Prioritize assumptions that would
   most affect the estimate (scope-defining unknowns > nice-to-know details).
   If exit conditions ARE met → exit the loop and proceed to the assumption post.

5. If wait_for_reply times out (no reply within 15 minutes), exit the loop immediately.
   Proceed using reasonable defaults. All unknowns become assumptions.

After 5 rounds, proceed regardless. All remaining unknowns become assumptions.

ASSUMPTION POST — Before proceeding to Step 3, post your final assumptions to Slack:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "📋 Proceeding with Assumptions"}},
  {"type": "section", "text": {"type": "mrkdwn", "text": "1. [Assumption one]\\n2. [Assumption two]\\n..."}},
  {"type": "context", "elements": [{"type": "mrkdwn", "text": "Reply if any of these are incorrect — otherwise I'll continue with the estimation ➡️"}]}
]
text: "📋 Proceeding with these assumptions"

Do NOT call wait_for_reply after this — it is informational only. Proceed directly to Step 3.
These assumptions MUST also appear in the Assumptions section of the offer document in Step 4.
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors (prompt-only change, no type impact)

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(assumption-capped-clarification): replace round-based exit with assumption-count exit"
```

---

### Task 2: Update TOOL_TO_STEP if needed

**Step 1: Verify no TOOL_TO_STEP changes needed**

The Step 2 tools (`wait_for_reply`, `post_message`) are unchanged. No mapping changes needed.

**Step 2: Skip — no changes required**

---

### Task 3: Final verification and PR

**Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All pass (no code logic changed)

**Step 3: Push branch and create PR**

```bash
git push -u origin feat/assumption-capped-clarification
gh pr create --title "feat: assumption-capped clarification loop" --body "..."
```
