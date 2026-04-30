# SPEC-035: Context Pressure Reduction — RFP via Drive + Disable Session Persistence

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent context window exhaustion that causes the agent to get stuck reading its own JSONL transcript. Two fixes: stop embedding large RFP text in the prompt (use Drive instead), and disable session persistence so the transcript file doesn't exist.

**Architecture:** Remove the inline `rfpText` prompt branch for file-upload jobs (use Drive folder path instead). Set `persistSession: false` in the SDK query options. Keep inline embedding for slash commands and clarification answers (always short).

**Tech Stack:** Claude Agent SDK, Google Drive MCP, orchestrator prompt.

**Status:** Implemented
**Date:** 2026-03-11
**Scope:** `src/agents/orchestrator.ts`

---

## Problem

The CRC estimation job failed because:
1. The extracted RFP text (~40K+ tokens) was embedded directly in the agent's prompt
2. Combined with the system prompt (~4K tokens) and 80 turns of tool results, the 200K context window filled up
3. SDK auto-compaction fired, directing the agent to "read the full transcript at {path}.jsonl"
4. Individual JSONL lines were too large (26K+ tokens per line) for the 25K Read limit
5. The agent burned all remaining turns trying to Read progressively smaller chunks, all failing

This is NOT the same issue as SPEC-032 (MCP tool result size). SPEC-032's 20K char truncation works correctly. The issue is the RFP text embedded inline in the initial prompt, which bloats the context and triggers the failure chain.

## Root Cause Chain

```
Large RFP text embedded in prompt (40K+ tokens)
→ Context window fills up after ~40 turns
→ SDK auto-compaction fires
→ Agent told: "read transcript at {path}.jsonl for details"
→ JSONL lines too large for Read tool (25K token limit)
→ Agent stuck in retry loop
→ Job fails
```

## Design

### Fix 1: Never embed large RFP text in prompt

**Current** (orchestrator.ts, the prompt building section around line 313):
```
if (job.rfpText) {
  rfpSource = `RFP TEXT (extracted from uploaded documents):
  <user-rfp>${job.rfpText}</user-rfp> ...`
}
```

When a job has files (PDFs, Drive links), the file ingestion extracts text AND uploads files to a Drive input folder. Both `rfpText` and `inputFolderId` are set. Currently, the inline text takes priority — the agent gets the full extracted text in the prompt PLUS access to Drive files.

**New behavior:**
- If `inputFolderId` is set → always use the Drive folder path (agent reads via `drive_export_file`). Ignore `rfpText`.
- If only `rfpText` is set (slash command, no files) → embed inline (these are always short, Slack messages).
- Clarification answers (`job.clarificationAnswers`) → always embed inline (always short).

This means changing the priority order in the `rfpSource` construction. Currently: `rfpText > inputFolderId > messageText`. New: `inputFolderId > rfpText > messageText`.

**Concrete change:** Swap the `if (job.rfpText)` and `else if (job.inputFolderId)` branches. When `inputFolderId` exists, use it regardless of whether `rfpText` is also available.

### Fix 2: Disable session persistence

Add `persistSession: false` to the `query()` options. This prevents the SDK from writing the JSONL transcript file. The agent still has full in-memory context — persistence is just a disk backup. Job debug data is already captured in Redis via `job:{id}:logs`.

Without a transcript file, the compaction mechanism can't point the agent to an unreadable file. The agent will work with the compacted summary, which is the correct behavior.

---

## Plan

### Task 1: Reorder RFP source priority in orchestrator prompt

**Files:**
- Modify: `src/agents/orchestrator.ts` (lines ~312-356)

**Step 1: Swap the `if/else if` branches**

Currently the code checks `job.rfpText` first, then `job.inputFolderId`. Swap them so `inputFolderId` takes priority:

```typescript
  if (job.inputFolderId) {
    // Files are in Drive — agent reads them via MCP tools
    const manifestSection = job.fileManifest
      ? `\nFILE MANIFEST (${job.fileManifest.totalFiles} files found):
<user-file-manifest>
${job.fileManifest.files.map((f) => {
  let line = `- ${f.sourcePath} (${f.type}) [Drive ID: ${f.driveId}]`;
  if (f.convertedDocId) line += ` → text version: ${f.convertedDocId}`;
  return line;
}).join("\n")}
${job.fileManifest.failedFiles.length > 0 ? `\nFailed to copy: ${job.fileManifest.failedFiles.join(", ")}` : ""}
</user-file-manifest>

READING INSTRUCTIONS:
- Google Docs: use drive_export_file(driveId, "text/plain")
- Google Sheets: use drive_export_file(driveId, "text/csv") to get tabular data
- Google Slides: use drive_export_file(driveId, "text/plain") for text content
- PDFs: use drive_export_file on the "text version" ID (converted via OCR)
- Images: noted for context but cannot be read as text
- Start by reading the most relevant-looking files first (RFPs, briefs, requirements docs)`
      : "";

    rfpSource = `RFP SOURCE:
The client's RFP documents have been uploaded to Google Drive.
- Input folder ID: ${job.inputFolderId}
- Output folder ID: ${job.outputFolderId}

Use drive_list_files to list the Input folder, then drive_export_file to read each file.
${manifestSection}
${job.messageText ? `\nThe client also wrote: <user-message>${job.messageText}</user-message>` : ""}`;
  } else if (job.rfpText) {
    rfpSource = `RFP TEXT (extracted from uploaded documents):
<user-rfp>
${job.rfpText}
</user-rfp>
${job.messageText ? `\nThe client also wrote: <user-message>${job.messageText}</user-message>` : ""}`;
  } else {
    rfpSource = `RFP TEXT:
<user-rfp>
${job.messageText ?? "No RFP text provided."}
</user-rfp>`;
  }
```

The key change: `if (job.inputFolderId)` is now the FIRST branch. When both `rfpText` and `inputFolderId` exist, `inputFolderId` wins. The `rfpText` branch only fires for slash commands where there are no uploaded files.

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "fix(context-pressure): prioritize Drive folder over inline rfpText in prompt"
```

---

### Task 2: Disable session persistence

**Files:**
- Modify: `src/agents/orchestrator.ts` (the `query()` options, around line 900)

**Step 1: Add `persistSession: false` to query options**

In the `options` object passed to `query()`, add:

```typescript
        persistSession: false,
```

Add it alongside the existing options like `maxTurns`, `mcpServers`, etc.

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors. If `persistSession` is not in the type definition, check the SDK types — it should be in `ClaudeAgentOptions` or `Options`.

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "fix(context-pressure): disable session persistence to prevent JSONL read loops"
```

---

### Task 3: Final verification

**Step 1: Run full type check**

Run: `npx tsc --noEmit`

**Step 2: Run all tests**

Run: `npm test`

**Step 3: Verify the changes**

- `grep -r "job.rfpText" src/agents/orchestrator.ts` — should appear in the `else if` branch, NOT the first `if`
- `grep -r "persistSession" src/agents/orchestrator.ts` — should find `persistSession: false`

**Step 4: Update lessons.md**

Append to `.ai/lessons.md`:

```markdown
---

### Large RFP text must not be embedded inline in the agent prompt

**Context:** CRC estimation extracted ~40K+ tokens from PDF and embedded them directly in the agent prompt.
**Problem:** The large initial prompt + 80 turns of tool results exhausted the 200K context window. SDK compaction directed the agent to read its JSONL transcript, but individual lines exceeded the 25K token Read limit. The agent got stuck in a retry loop.
**Rule:** When `inputFolderId` is available, always use the Drive folder path — never embed `rfpText` inline. The agent reads the RFP via `drive_export_file` (already truncated to 20K chars). Only embed text for slash commands (always short).
**Recovery:** If a job fails with "File content exceeds maximum allowed tokens" on a `.jsonl` file, the agent is trying to read its own transcript. Reduce context pressure: check that rfpText is not embedded inline, and verify `persistSession: false` is set.
**Applies to:** `src/agents/orchestrator.ts`.
```

**Step 5: Push and create PR**

```bash
git push -u origin feat/context-pressure-reduction
gh pr create --title "fix: prevent context exhaustion from inline RFP text" --body "..."
```
