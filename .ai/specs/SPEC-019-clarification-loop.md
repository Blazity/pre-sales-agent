# SPEC-019: Multi-Round Clarification Loop

## Problem

Step 2 (Clarification) is limited to 3 questions in a single round with no follow-ups. The agent fires questions, waits once, and moves on — even if answers are vague or reveal new unknowns. This produces offers with avoidable assumptions.

## Design

### Approach: Prompt-driven multi-round loop

The agent SDK already supports calling `post_message` + `wait_for_reply` multiple times. The 3-question single-round behavior is purely a prompt constraint. Rewrite Step 2 to instruct the agent to loop until it has full certainty, with a 5-round soft cap.

### Prompt rewrite (Step 2)

Replace current Step 2 in orchestrator prompt with:

1. **No question limit per round.** Ask as many as needed, grouped by topic.
2. **Evaluation gate after each reply.** After receiving answers, explicitly assess: "Do I have enough to produce an accurate offer?" If not, ask targeted follow-ups referencing the client's previous answers.
3. **Soft cap: 5 rounds.** After 5 Q&A rounds, proceed regardless. Fill gaps with reasonable assumptions and flag them in the offer document.
4. **Round labeling in Slack.** Each round shows progress: "Clarifying Questions (1/5)", "Follow-up (2/5)" so the client knows the agent won't loop forever.
5. **Timeout: 15 minutes per round.** If no reply within 15 min, proceed with defaults and note which assumptions were made due to missing answers.
6. **Remove the 20% impact threshold.** The agent should ask about anything it's uncertain about, not just high-impact unknowns.

### MCP change

Reduce `wait_for_reply` deadline from 30 minutes to 15 minutes in `slack-interaction.ts`.

### What stays the same

- Skip conditions: clarificationAnswers already provided, or RFP is exhaustively clear
- `post_message` and `wait_for_reply` tool APIs unchanged
- No new tools, no orchestrator code changes, no job schema changes
- Steps 1, 3–6 untouched

## Files

- `src/agents/orchestrator.ts` — rewrite Step 2 prompt block (~lines 242–266)
- `src/mcp-servers/slack-interaction.ts` — change deadline from 30min to 15min (~line 63)

## Plan

- [x] Read `.ai/lessons.md` for relevant pitfalls
- [x] Rewrite Step 2 prompt in orchestrator: remove 3-question limit, add multi-round loop with evaluation gate, 5-round soft cap, round labels, 15-min timeout messaging
- [x] Remove the 20% impact skip threshold from the prompt
- [x] Update `wait_for_reply` deadline from `30 * 60 * 1000` to `15 * 60 * 1000` in `slack-interaction.ts`
- [x] Update the Slack timeout hint in the prompt from "5 minutes" to "15 minutes"
- [x] Verify: `npx tsc --noEmit`
- [x] Verify: `npm test`
- [x] Update `.ai/lessons.md` if new pitfalls discovered
