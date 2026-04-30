# SPEC-010: Prompt Flow Fix

**Status:** Implemented
**Date:** 2026-02-27

---

# Prompt Flow Fix — Design

## Problems

1. **Duplicate clarifying questions.** Step 1 asks agent to post "key assumptions" → agent frames unknowns as assumptions. Step 2 asks for "top 3-5 unknowns" → agent discovers the same unknowns again, posts the same questions. Wasted turns, confusing Slack thread.

2. **Verbose Slack analysis.** Step 1 says "post a structured analysis" with no length constraint. Agent writes paragraphs. Should be a concise bullet summary.

## Fix

Prompt-only changes in `src/agents/orchestrator.ts`, Steps 1 and 2.

---

## Step 1: Replace (lines 146-156)

**Current:**
```
## Step 1: Analyze the RFP
1. Call search_similar_projects with the core project description (3-5 word query)
2. Analyze the RFP: extract scope, tech stack indicators, complexity, timeline hints
3. Post a structured analysis to Slack with:
   - Project type and complexity
   - Similar past projects found (or note if none)
   - Key assumptions you're making
   - Rough budget range based on similar work
4. Search for relevant Blazity case studies using search_case_studies...
```

**Replace with:**
```
## Step 1: Analyze the RFP
1. Call search_similar_projects with the core project description (3-5 word query)
2. Search for relevant Blazity case studies using search_case_studies. Use the
   RFP's industry and problem type as filters. Note the most relevant case study for Step 3.
3. Analyze the RFP internally: scope, tech stack, complexity, timeline, risks.
   Do NOT post assumptions or unknowns here — save those for Step 2.
4. Post a CONCISE summary to Slack in this exact format (one line per bullet, no paragraphs):

📋 **RFP Analysis**
• **Client:** [who they are — 1 line max]
• **Project:** [what they need — 1 line max]
• **Tech stack:** [recommended technologies, comma-separated]
• **Complexity:** [Low / Medium / High — 1-line reason]
• **Estimate:** [€XX,000 – €XX,000 · X–Y weeks]
• **Similar work:** [most relevant past project name + key metric, or "none found"]

Keep this post SHORT. No paragraphs, no elaboration, no assumptions.
```

Key changes:
- Removed "Key assumptions you're making" — this was the trigger for implicit questions
- Added "Do NOT post assumptions or unknowns here"
- Rigid bullet format with length constraints
- Moved case study search up (before posting) so the summary can reference similar work

---

## Step 2: Replace (lines 158-163)

**Current:**
```
## Step 2: Clarifying Questions (skip if clarificationAnswers is already provided)
1. Identify the top 3-5 unknowns that would most affect the estimate
2. If questions are needed, post them to Slack as a numbered list
3. End the questions post with: "Please reply in this thread to continue ➡️"
4. Call wait_for_reply to get the client's answers
5. Note: if clarificationAnswers were already provided above, skip directly to Step 3
```

**Replace with:**
```
## Step 2: Clarifying Questions

SKIP CONDITIONS — go directly to Step 3 if ANY of these are true:
- clarificationAnswers were already provided in the CONTEXT above
- The RFP clearly specifies: scope, target users, tech preferences, timeline, and budget range
- You have no genuine unknowns that would change the estimate by more than 20%

IF questions are needed:
1. Review ONLY information that is genuinely MISSING from the RFP.
   Do NOT ask about anything already stated in the RFP or covered in your Step 1 analysis.
2. Ask a MAXIMUM of 3 questions — only the ones that would most change the estimate.
   Examples of good questions: deployment preferences, existing systems to integrate with,
   compliance requirements, expected traffic scale.
   Examples of BAD questions: restating scope items as questions, asking for confirmation
   of things already in the RFP, asking about tech stack when the RFP already specifies one.
3. Post questions to Slack as a numbered list (max 3).
   End with: "Please reply in this thread — or I'll proceed with reasonable defaults in 5 minutes ➡️"
4. Call wait_for_reply to get the client's answers.
5. If the client doesn't respond within the timeout, proceed to Step 3 using
   reasonable defaults based on industry standards and your analysis.
```

Key changes:
- Added explicit SKIP CONDITIONS so the agent skips when RFP is clear
- Reduced max questions from 5 to 3
- Added examples of good vs bad questions
- Explicit instruction to NOT repeat Step 1 analysis
- Added "proceed with defaults" fallback instead of hanging forever

---

## Implementation Order

- [x] **Task 1:** Replace Step 1 prompt text in orchestrator.ts with the new concise format
- [x] **Task 2:** Replace Step 2 prompt text in orchestrator.ts with new skip conditions + dedup rules
- [x] **Task 3:** Full build verification (npx tsc --noEmit)

## Files Modified

| File | Changes |
|------|---------|
| `src/agents/orchestrator.ts` | Step 1 and Step 2 prompt text replacement |
