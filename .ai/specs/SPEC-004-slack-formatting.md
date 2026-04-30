# SPEC-004: Slack Formatting

**Status:** Planning
**Date:** 2026-03-01

---

## Design


**Date:** 2026-03-01
**Status:** Approved

## Problem

All Slack messages from the bot (both Bolt app responses and agent workflow messages) are inconsistently formatted, lack visual structure, and look plain. Messages use free-form mrkdwn text with no structural enforcement.

## Root Causes

1. The `post_message` MCP tool only accepts a `text` string — no Block Kit `blocks` support
2. The orchestrator prompt gives loose formatting guidelines ("use emojis") but no exact templates
3. The Bolt app initial messages are plain text with no Block Kit
4. The agent constructs messages as free-form prose — style varies per run

## Solution: Block Kit + Templates (Approach B)

### Change 1: Add `blocks` param to `post_message` MCP tool

**File:** `src/mcp-servers/slack-interaction.ts`

Add optional `blocks` param (JSON string). When provided, parse and pass to `chat.postMessage` alongside `text` as fallback.

### Change 2: Block Kit templates in orchestrator prompt

**File:** `src/agents/orchestrator.ts`

Replace free-form Slack instructions with exact Block Kit JSON templates for 5 message types:

- **RFP Analysis** — Header + fields grid (Client, Project, Tech Stack, Complexity, Estimate, Similar work)
- **Clarifying Questions** — Header + numbered section + context footer
- **Document Ready** — Header + link section + context
- **Presentation Ready** — Header + link section
- **Estimation Complete** — Header + divider + link fields + context

### Change 3: Refactor Bolt app messages to Block Kit

**File:** `src/slack/bolt-app.ts`

- "RFP received" → Header + step checklist
- "File upload status" → Context block
- Error/validation one-liners → Keep as plain text

---

## Implementation Plan


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all Slack bot messages visually polished and consistent using Block Kit — both the Bolt app's initial responses and the agent's workflow messages.

**Architecture:** Add `blocks` param to the `post_message` MCP tool, replace free-form Slack instructions in the orchestrator prompt with exact Block Kit JSON templates, and refactor Bolt app messages to use Block Kit.

**Tech Stack:** Slack Block Kit, @slack/web-api, Zod schemas, orchestrator prompt.

**Design doc:** `.ai/specs/SPEC-004-slack-formatting.md (Design section)`

---

### Task 1: Add `blocks` param to `post_message` MCP tool

The MCP tool currently only accepts `text`. Add an optional `blocks` param so the agent can send Block Kit structured messages.

**Files:**
- Modify: `src/mcp-servers/slack-interaction.ts:12-24`

**Step 1: Update the tool schema and handler**

Replace lines 12-24 with:

```typescript
server.tool(
  "post_message",
  "Post a message to a Slack channel thread. Use 'blocks' for rich Block Kit formatting; 'text' is used as notification fallback.",
  {
    channel: z.string(),
    thread_ts: z.string(),
    text: z.string().describe("Plain text fallback shown in notifications and screen readers"),
    blocks: z.string().optional().describe("JSON array of Slack Block Kit blocks for rich formatting"),
  },
  async ({ channel, thread_ts, text, blocks }) => {
    await slack.chat.postMessage({
      channel,
      thread_ts,
      text,
      ...(blocks ? { blocks: JSON.parse(blocks) } : {}),
    });
    return { content: [{ type: "text" as const, text: "Message posted." }] };
  }
);
```

**Step 2: Verify**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/mcp-servers/slack-interaction.ts
git commit -m "feat(slack-formatting): add blocks param to post_message MCP tool"
```

- [ ] Done

---

### Task 2: Replace orchestrator Slack formatting instructions with Block Kit templates

Replace all free-form Slack posting instructions in the orchestrator prompt with exact Block Kit JSON templates.

**Files:**
- Modify: `src/agents/orchestrator.ts:76-78` (system prompt Slack instructions)
- Modify: `src/agents/orchestrator.ts:186-196` (Step 1 analysis post)
- Modify: `src/agents/orchestrator.ts:212-213` (Step 2 questions post)
- Modify: `src/agents/orchestrator.ts:300` (Step 3 doc link post)
- Modify: `src/agents/orchestrator.ts:388` (Step 4 presentation link post)
- Modify: `src/agents/orchestrator.ts:391-392` (Step 5 completion post)

**Step 1: Update the system prompt Slack instructions**

Replace lines 76-78:
```
Always be professional, concise, and structured. When posting to Slack, use clear
formatting with emojis to indicate progress (📋 analysis, ❓ questions, 📄 document,
🎨 presentation, ✅ done).
```

With:
```
Always be professional, concise, and structured.

SLACK FORMATTING RULES:
When posting to Slack, ALWAYS use the blocks parameter with Block Kit JSON for rich formatting.
The text parameter is only a plain-text fallback for notifications — keep it to one short sentence.
Use these Block Kit patterns:
- header block for message titles (with emoji prefix)
- section block with "mrkdwn" for body content
- section block with "fields" array for key-value grids (max 2 columns, up to 10 fields)
- context block for footer notes and metadata
- divider block to separate sections
Bold key labels with *asterisks* in mrkdwn text. Keep each field value to 1 line.
```

**Step 2: Replace Step 1 analysis post instruction**

Replace lines 186-196 (from `4. Post a CONCISE summary` through `Keep this post SHORT. No paragraphs, no elaboration, no assumptions.`):

```
4. Post a CONCISE summary to Slack using blocks. Use this exact Block Kit structure:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "📋 RFP Analysis"}},
  {"type": "section", "fields": [
    {"type": "mrkdwn", "text": "*Client:*\n[who they are — 1 line]"},
    {"type": "mrkdwn", "text": "*Project:*\n[what they need — 1 line]"},
    {"type": "mrkdwn", "text": "*Tech Stack:*\n[technologies, comma-separated]"},
    {"type": "mrkdwn", "text": "*Complexity:*\n[Low / Medium / High — 1 line reason]"},
    {"type": "mrkdwn", "text": "*Estimate:*\n[€XX,000 – €XX,000 · X–Y weeks]"},
    {"type": "mrkdwn", "text": "*Similar Work:*\n[past project + key metric, or 'none found']"}
  ]}
]
text: "📋 RFP Analysis: [client] — [project type]"

Keep field values to ONE line each. No paragraphs.
```

**Step 3: Replace Step 2 questions post instruction**

Replace lines 212-213 (from `3. Post questions to Slack` through the `End with:` line):

```
3. Post questions to Slack using blocks:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "❓ Clarifying Questions"}},
  {"type": "section", "text": {"type": "mrkdwn", "text": "1. [Question one]\n2. [Question two]\n3. [Question three]"}},
  {"type": "context", "elements": [{"type": "mrkdwn", "text": "Reply in this thread — or I'll proceed with reasonable defaults in 5 minutes ➡️"}]}
]
text: "❓ Clarifying questions — please reply in this thread"
```

**Step 4: Replace Step 3 doc link post instruction**

Replace line 300 (`Post the Google Doc URL to Slack with a 2-line summary.`):

```
Post the Google Doc URL to Slack using blocks:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "📄 Offer Document Ready"}},
  {"type": "section", "text": {"type": "mrkdwn", "text": "*<GOOGLE_DOC_URL|Offer - [Project Name] - [Date]>*\n[1-line summary of the offer scope and estimate]"}},
  {"type": "context", "elements": [{"type": "mrkdwn", "text": "Review the document and reply with any feedback."}]}
]
text: "📄 Offer document ready — [Google Doc URL]"
```

**Step 5: Replace Step 4 presentation link post instruction**

Replace line 388 (`4. Post the Google Slides URL to Slack with a 1-line summary.`):

```
4. Post the Google Slides URL to Slack using blocks:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "🎨 Presentation Ready"}},
  {"type": "section", "text": {"type": "mrkdwn", "text": "*<GOOGLE_SLIDES_URL|[Client] x Blazity — Initial Offer>*\n[1-line summary]"}}
]
text: "🎨 Presentation ready — [Google Slides URL]"
```

**Step 6: Replace Step 5 completion post instruction**

Replace lines 391-392:
```
1. Call store_estimation with a summary of this project
2. Post a final "✅ Estimation complete!" message to Slack with both links
```

With:
```
1. Call store_estimation with a summary of this project
2. Post a final completion message to Slack using blocks:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "✅ Estimation Complete"}},
  {"type": "divider"},
  {"type": "section", "fields": [
    {"type": "mrkdwn", "text": "*📄 Offer:*\n<GOOGLE_DOC_URL|View Document>"},
    {"type": "mrkdwn", "text": "*🎨 Presentation:*\n<GOOGLE_SLIDES_URL|View Slides>"}
  ]},
  {"type": "context", "elements": [{"type": "mrkdwn", "text": "Both documents are in the shared Google Drive folder."}]}
]
text: "✅ Estimation complete — offer and presentation ready"
```

**Step 7: Verify**

```bash
npx tsc --noEmit
```

**Step 8: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(slack-formatting): replace free-form Slack instructions with Block Kit templates"
```

- [ ] Done

---

### Task 3: Refactor Bolt app messages to use Block Kit

Update the Bolt app's own messages (not the agent's) to use Block Kit for consistency.

**Files:**
- Modify: `src/slack/bolt-app.ts:95-106` (RFP received message)
- Modify: `src/slack/bolt-app.ts:145-148` (file upload status)
- Modify: `src/slack/bolt-app.ts:206-209` (slash command response)
- Modify: `src/slack/bolt-app.ts:211-214` (slash command thread message)

**Step 1: Update the "RFP received" message**

Replace lines 95-106:
```typescript
    await say({
      text: [
        "*RFP received!* Starting the estimation workflow...",
        "",
        "I'll post updates in this thread as I work through:",
        "1. RFP Analysis",
        "2. Clarifying Questions (if needed)",
        "3. Google Docs Offer",
        "4. Google Slides Presentation",
      ].join("\n"),
      thread_ts: msg.ts,
    });
```

With:
```typescript
    await say({
      text: "RFP received! Starting the estimation workflow...",
      blocks: [
        { type: "header", text: { type: "plain_text", text: "📋 RFP Received" } },
        { type: "section", text: { type: "mrkdwn", text: "Starting the estimation workflow. I'll post updates in this thread:" } },
        { type: "section", text: { type: "mrkdwn", text: "1️⃣ RFP Analysis\n2️⃣ Clarifying Questions _(if needed)_\n3️⃣ Google Docs Offer\n4️⃣ Google Slides Presentation" } },
      ],
      thread_ts: msg.ts,
    });
```

**Step 2: Update the file upload status message**

Replace lines 145-148:
```typescript
        await say({
          text: `Uploaded ${result.filesUploaded} file(s) to Google Drive.${extractNote} Analyzing...`,
          thread_ts: msg.ts,
        });
```

With:
```typescript
        await say({
          text: `Uploaded ${result.filesUploaded} file(s) to Google Drive.${extractNote} Analyzing...`,
          blocks: [
            { type: "context", elements: [{ type: "mrkdwn", text: `📎 Uploaded *${result.filesUploaded} file(s)* to Google Drive.${extractNote} Analyzing...` }] },
          ],
          thread_ts: msg.ts,
        });
```

**Step 3: Update the slash command response**

Replace lines 206-209:
```typescript
    await respond({
      text: "📋 *Estimation workflow started!* Check this channel for updates in a thread.",
      response_type: "in_channel",
    });
```

With:
```typescript
    await respond({
      text: "Estimation workflow started! Check this channel for updates in a thread.",
      response_type: "in_channel",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "📋 *Estimation workflow started!* Check this channel for updates in a thread." } },
      ],
    });
```

**Step 4: Update the slash command thread message**

Replace lines 211-214:
```typescript
    const posted = await app.client.chat.postMessage({
      channel: command.channel_id,
      text: `📋 *New Estimation Request* from <@${command.user_id}>\n\n${rfpText.slice(0, 200)}${rfpText.length > 200 ? "..." : ""}`,
    });
```

With:
```typescript
    const posted = await app.client.chat.postMessage({
      channel: command.channel_id,
      text: `New Estimation Request from <@${command.user_id}>`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: "📋 New Estimation Request" } },
        { type: "section", text: { type: "mrkdwn", text: `From <@${command.user_id}>` } },
        { type: "section", text: { type: "mrkdwn", text: `>${rfpText.slice(0, 300)}${rfpText.length > 300 ? "..." : ""}` } },
      ],
    });
```

**Step 5: Verify**

```bash
npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add src/slack/bolt-app.ts
git commit -m "feat(slack-formatting): refactor Bolt app messages to use Block Kit"
```

- [ ] Done

---

### Task 4: Verify end-to-end with a test run

Run the estimation pipeline to confirm Slack messages render with Block Kit formatting.

**Step 1: Build**

```bash
npm run build
```

**Step 2: Run test**

```bash
npx tsx scripts/test-run.ts
```

Note: This runs with `skipSteps: ["presentation", "knowledge_base", "slack"]` so Slack messages won't actually be sent. To fully verify, either:
- Temporarily remove `"slack"` from `skipSteps` in `test-run.ts` and provide a real channel/thread, OR
- Deploy to the dev environment and trigger via `!estimate` in Slack

**Step 3: If testing locally without Slack**

Verify the MCP tool accepts the blocks param by checking `npx tsc --noEmit` passes and reviewing the orchestrator prompt for correct Block Kit JSON structure.

- [ ] Done

---

## Verification

After all tasks:

1. `npx tsc --noEmit` passes
2. `post_message` MCP tool accepts optional `blocks` param
3. Orchestrator prompt has exact Block Kit JSON templates for all 5 message types
4. Bolt app messages use Block Kit for "RFP received", file upload, and slash command
5. Error/validation one-liners remain as plain text (no over-engineering)
