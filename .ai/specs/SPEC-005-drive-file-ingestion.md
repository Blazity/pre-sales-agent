# SPEC-005: Drive File Ingestion

**Status:** Implemented
**Date:** 2026-02-26

---

# Google Drive File Ingestion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When users send `!estimate` with PDF attachments or Google Docs links, download/copy files into a per-estimation Google Drive folder structure so the agent can read the full RFP content (text, tables, diagrams).

**Architecture:** Slack handler downloads attachments from Slack API, uploads them to a Drive `Input/` folder via the Google Drive REST API. The orchestrator prompt tells the agent to read from that folder. All estimation output goes to an `Output/` folder. Plain-text-only messages create a text doc in `Input/` for consistency.

**Tech Stack:** Google Drive REST API v3 (direct fetch, no new npm deps), Slack `files.sharedPublicURL` / private download, existing google-workspace MCP for agent-side reads.

---

### Task 1: Add `GDRIVE_ROOT_FOLDER_ID` to env.ts

**Files:**
- Modify: `src/lib/env.ts:17`

**Step 1: Add the env var**

Add after `GDRIVE_TEMPLATE_ID` line:

```typescript
GDRIVE_ROOT_FOLDER_ID: require("GDRIVE_ROOT_FOLDER_ID"),
```

**Step 2: Build**

Run: `npx tsc --noEmit`
Expected: Pass (will fail at runtime until env var is set, but compiles fine)

**Step 3: Commit**

```bash
git add src/lib/env.ts
git commit -m "feat: add GDRIVE_ROOT_FOLDER_ID env var"
```

---

### Task 2: Create `src/lib/google-drive.ts` — Drive REST API helpers

**Files:**
- Create: `src/lib/google-drive.ts`
- Test: `src/lib/google-drive.test.ts`

**Step 1: Write failing tests**

```typescript
// src/lib/google-drive.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test pure helper logic — no API calls
import {
  buildFolderMetadata,
  buildUploadMetadata,
  extractGoogleDocsId,
} from "./google-drive.js";

describe("Google Drive helpers", () => {
  describe("buildFolderMetadata()", () => {
    it("builds correct metadata for a folder", () => {
      const meta = buildFolderMetadata("My Folder", "parent123");
      assert.equal(meta.name, "My Folder");
      assert.equal(meta.mimeType, "application/vnd.google-apps.folder");
      assert.deepEqual(meta.parents, ["parent123"]);
    });
  });

  describe("buildUploadMetadata()", () => {
    it("builds metadata for a file upload", () => {
      const meta = buildUploadMetadata("doc.pdf", "application/pdf", "folder456");
      assert.equal(meta.name, "doc.pdf");
      assert.equal(meta.mimeType, "application/pdf");
      assert.deepEqual(meta.parents, ["folder456"]);
    });
  });

  describe("extractGoogleDocsId()", () => {
    it("extracts doc ID from a full Google Docs URL", () => {
      const url = "https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit";
      assert.equal(extractGoogleDocsId(url), "1aBcDeFgHiJkLmNoPqRsTuVwXyZ");
    });

    it("extracts doc ID from URL without /edit", () => {
      const url = "https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ";
      assert.equal(extractGoogleDocsId(url), "1aBcDeFgHiJkLmNoPqRsTuVwXyZ");
    });

    it("returns null for non-Google Docs URL", () => {
      assert.equal(extractGoogleDocsId("https://example.com/doc"), null);
    });

    it("returns null for empty string", () => {
      assert.equal(extractGoogleDocsId(""), null);
    });

    it("handles URLs with query params", () => {
      const url = "https://docs.google.com/document/d/1aBcDeFg/edit?usp=sharing";
      assert.equal(extractGoogleDocsId(url), "1aBcDeFg");
    });
  });
});
```

Run: `npx tsc --noEmit` — Expected: FAIL (module doesn't exist)

**Step 2: Implement google-drive.ts**

```typescript
// src/lib/google-drive.ts
import { env } from "./env.js";
import { logger } from "./logger.js";

// ── Token cache ──────────────────────────────────────────────────────────────
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

// ── Pure helpers (tested without API calls) ──────────────────────────────────

export function buildFolderMetadata(name: string, parentId: string) {
  return {
    name,
    mimeType: "application/vnd.google-apps.folder" as const,
    parents: [parentId],
  };
}

export function buildUploadMetadata(name: string, mimeType: string, parentId: string) {
  return { name, mimeType, parents: [parentId] };
}

const GDOC_URL_RE = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/;

export function extractGoogleDocsId(url: string): string | null {
  const match = url.match(GDOC_URL_RE);
  return match ? match[1] : null;
}

export function extractAllGoogleDocsIds(text: string): string[] {
  const ids: string[] = [];
  const re = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

// ── Drive API calls ──────────────────────────────────────────────────────────

export async function createDriveFolder(name: string, parentId: string): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildFolderMetadata(name, parentId)),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive createFolder failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  logger.info("Created Drive folder", { name, parentId, folderId: data.id });
  return data.id;
}

export async function uploadFileToDrive(
  name: string,
  mimeType: string,
  buffer: Buffer,
  parentId: string,
): Promise<string> {
  const token = await getAccessToken();

  const metadata = JSON.stringify(buildUploadMetadata(name, mimeType, parentId));

  // Multipart upload: metadata + file content
  const boundary = "estimation_agent_boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive upload failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  logger.info("Uploaded file to Drive", { name, mimeType, parentId, fileId: data.id });
  return data.id;
}

export async function copyDriveFile(fileId: string, name: string, parentId: string): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/copy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, parents: [parentId] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive copy failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  logger.info("Copied Drive file", { sourceId: fileId, name, parentId, newId: data.id });
  return data.id;
}
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass including new google-drive tests

**Step 4: Commit**

```bash
git add src/lib/google-drive.ts src/lib/google-drive.test.ts
git commit -m "feat: add Google Drive REST API helpers"
```

---

### Task 3: Create `src/lib/file-ingestion.ts` — orchestrates Slack download + Drive upload

**Files:**
- Create: `src/lib/file-ingestion.ts`
- Test: `src/lib/file-ingestion.test.ts`

**Step 1: Write failing tests**

```typescript
// src/lib/file-ingestion.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildEstimationFolderName,
  classifySlackFile,
  extractMessageText,
} from "./file-ingestion.js";

describe("File ingestion helpers", () => {
  describe("buildEstimationFolderName()", () => {
    it("builds folder name from text and date", () => {
      const name = buildEstimationFolderName("Build a SaaS platform for contracts", "2026-02-26");
      // Should use first ~50 chars of text as project name
      assert.ok(name.includes("2026-02-26"));
      assert.ok(name.length <= 80);
    });

    it("sanitises special characters", () => {
      const name = buildEstimationFolderName("Build a platform / with slashes & stuff", "2026-02-26");
      assert.ok(!name.includes("/"));
    });

    it("handles short text", () => {
      const name = buildEstimationFolderName("SaaS", "2026-02-26");
      assert.ok(name.includes("SaaS"));
    });
  });

  describe("classifySlackFile()", () => {
    it("classifies PDF files", () => {
      assert.equal(classifySlackFile("application/pdf"), "pdf");
    });

    it("classifies Google Docs links as gdoc", () => {
      assert.equal(classifySlackFile("application/vnd.google-apps.document"), "gdoc");
    });

    it("classifies DOCX files", () => {
      assert.equal(
        classifySlackFile("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "docx"
      );
    });

    it("classifies images", () => {
      assert.equal(classifySlackFile("image/png"), "image");
      assert.equal(classifySlackFile("image/jpeg"), "image");
    });

    it("returns other for unknown types", () => {
      assert.equal(classifySlackFile("application/octet-stream"), "other");
    });
  });

  describe("extractMessageText()", () => {
    it("strips !estimate prefix and returns remaining text", () => {
      assert.equal(extractMessageText("!estimate Build a SaaS"), "Build a SaaS");
    });

    it("returns empty for just the command", () => {
      assert.equal(extractMessageText("!estimate"), "");
    });

    it("strips Google Docs URLs from the text", () => {
      const text = "!estimate Check this RFP https://docs.google.com/document/d/abc123/edit please";
      const result = extractMessageText(text);
      assert.ok(!result.includes("docs.google.com"));
      assert.ok(result.includes("Check this RFP"));
    });
  });
});
```

Run: `npx tsc --noEmit` — Expected: FAIL

**Step 2: Implement file-ingestion.ts**

```typescript
// src/lib/file-ingestion.ts
import { env } from "./env.js";
import { logger } from "./logger.js";
import {
  createDriveFolder,
  uploadFileToDrive,
  copyDriveFile,
  extractAllGoogleDocsIds,
} from "./google-drive.js";

// ── Slack file download ──────────────────────────────────────────────────────

export async function downloadSlackFile(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function buildEstimationFolderName(text: string, date: string): string {
  const sanitised = text.replace(/[\/\\:*?"<>|]/g, "").trim();
  const projectName = sanitised.slice(0, 50).trim() || "Estimation";
  return `${projectName} - ${date}`;
}

export function classifySlackFile(mimetype: string): "pdf" | "gdoc" | "docx" | "image" | "other" {
  if (mimetype === "application/pdf") return "pdf";
  if (mimetype.includes("google-apps.document")) return "gdoc";
  if (mimetype.includes("wordprocessingml.document")) return "docx";
  if (mimetype.startsWith("image/")) return "image";
  return "other";
}

export function extractMessageText(text: string): string {
  return text
    .replace(/^!estimate\s*/i, "")
    .replace(/https?:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9_-]+(\/[^\s]*)?/g, "")
    .trim();
}

// ── Main ingestion function ──────────────────────────────────────────────────

export interface SlackFile {
  name: string;
  mimetype: string;
  url_private_download: string;
}

export interface IngestionResult {
  estimationFolderId: string;
  inputFolderId: string;
  outputFolderId: string;
  /** Any remaining user text after stripping URLs */
  messageText: string;
  /** Number of files uploaded to Input/ */
  filesUploaded: number;
}

export async function ingestEstimationFiles(opts: {
  messageText: string;
  slackFiles: SlackFile[];
  jobId: string;
}): Promise<IngestionResult> {
  const { messageText, slackFiles, jobId } = opts;
  const date = new Date().toISOString().slice(0, 10);
  const cleanText = extractMessageText(messageText);

  // 1. Create folder structure
  const folderName = buildEstimationFolderName(cleanText, date);
  const estimationFolderId = await createDriveFolder(folderName, env.GDRIVE_ROOT_FOLDER_ID);
  const inputFolderId = await createDriveFolder("Input", estimationFolderId);
  const outputFolderId = await createDriveFolder("Output", estimationFolderId);

  logger.info("Created estimation Drive folders", {
    jobId, estimationFolderId, inputFolderId, outputFolderId,
  });

  let filesUploaded = 0;

  // 2. Upload Slack file attachments to Input/
  for (const file of slackFiles) {
    try {
      const buffer = await downloadSlackFile(file.url_private_download);
      await uploadFileToDrive(file.name, file.mimetype, buffer, inputFolderId);
      filesUploaded++;
      logger.info("Uploaded Slack file to Drive", { jobId, fileName: file.name });
    } catch (err) {
      logger.error("Failed to upload Slack file", { jobId, fileName: file.name, error: String(err) });
    }
  }

  // 3. Copy Google Docs linked in the message text to Input/
  const docIds = extractAllGoogleDocsIds(messageText);
  for (const docId of docIds) {
    try {
      await copyDriveFile(docId, `RFP-doc-${docId.slice(0, 8)}`, inputFolderId);
      filesUploaded++;
      logger.info("Copied Google Doc to Drive Input", { jobId, docId });
    } catch (err) {
      logger.error("Failed to copy Google Doc", { jobId, docId, error: String(err) });
    }
  }

  // 4. If there's meaningful text beyond the command + URLs, save it too
  if (cleanText.length > 10) {
    try {
      const textBuffer = Buffer.from(cleanText, "utf-8");
      await uploadFileToDrive("message-text.txt", "text/plain", textBuffer, inputFolderId);
      filesUploaded++;
    } catch (err) {
      logger.error("Failed to upload message text", { jobId, error: String(err) });
    }
  }

  return {
    estimationFolderId,
    inputFolderId,
    outputFolderId,
    messageText: cleanText,
    filesUploaded,
  };
}
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/lib/file-ingestion.ts src/lib/file-ingestion.test.ts
git commit -m "feat: add file ingestion — Slack download + Drive upload"
```

---

### Task 4: Update `EstimationJob` interface in orchestrator.ts

**Files:**
- Modify: `src/agents/orchestrator.ts:11-17`

**Step 1: Update the interface**

Replace the current `EstimationJob` interface with:

```typescript
export interface EstimationJob {
  jobId: string;
  channelId: string;
  threadTs: string;
  clarificationAnswers?: string;
  /** Folder IDs when files were ingested to Drive */
  inputFolderId?: string;
  outputFolderId?: string;
  estimationFolderId?: string;
  /** Plain text RFP — used as fallback when no files attached */
  rfpText?: string;
  /** Short summary text from the user's Slack message */
  messageText?: string;
}
```

**Step 2: Build**

Run: `npx tsc --noEmit`
Expected: Compilation errors in files referencing `rfpText` as required — fix in next tasks

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat: update EstimationJob to support Drive folder IDs"
```

---

### Task 5: Update orchestrator prompt to read from Drive

**Files:**
- Modify: `src/agents/orchestrator.ts:36-97` (prompt section)
- Modify: `src/agents/orchestrator.ts:147-157` (allowedTools)

**Step 1: Update the prompt builder**

Replace the static prompt template with logic that switches based on whether Drive folders are available:

```typescript
// Build the RFP source section of the prompt
const rfpSource = job.inputFolderId
  ? `RFP SOURCE:
The client's RFP documents have been uploaded to Google Drive.
- Input folder ID: ${job.inputFolderId}
- Output folder ID: ${job.outputFolderId}

IMPORTANT: Before analyzing, you MUST use drive_list_files to list everything in the Input folder,
then use drive_get_file to read each file. Read ALL files — PDFs, documents, text files — to
get the complete RFP picture. Do NOT skip any files.
${job.messageText ? `\nThe client also wrote: "${job.messageText}"` : ""}`
  : `RFP TEXT:
---
${job.rfpText ?? job.messageText ?? "No RFP text provided."}
---`;
```

Update Step 3 in the prompt to use the Output folder:

```
## Step 3: Create the Google Doc Offer
1. Fetch the offer template from Google Drive (document ID: ...)
2. Create a new Google Doc IN THE OUTPUT FOLDER (folder ID: ${job.outputFolderId ?? "root"}) with title: "Offer - [Project Name] - [Date]"
```

**Step 2: Add `drive_list_files` to allowedTools**

Add to the allowedTools array:
```typescript
"mcp__google-workspace__drive_list_files",
```

**Step 3: Build and test**

Run: `npx tsc --noEmit`
Expected: Pass

**Step 4: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat: orchestrator reads RFP from Drive Input folder"
```

---

### Task 6: Update Slack handler to call file ingestion

**Files:**
- Modify: `src/slack/bolt-app.ts:72-120` (message handler)

**Step 1: Update the message handler**

The handler needs to:
1. Check for `message.files` array
2. Check for Google Docs links in text
3. If files or links present: call `ingestEstimationFiles()`
4. Enqueue with folder IDs instead of raw rfpText

```typescript
app.message(/^!estimate/i, async ({ message, say }) => {
  const skipSubtypes = new Set(["bot_message", "message_changed", "message_deleted", "channel_join", "channel_leave"]);
  if (message.subtype && skipSubtypes.has(message.subtype)) return;

  const msg = message as {
    text: string;
    ts: string;
    channel: string;
    user: string;
    files?: Array<{ name: string; mimetype: string; url_private_download: string }>;
  };

  const rawText = msg.text.replace(/^!estimate\s*/i, "").trim();

  if (!rawText && (!msg.files || msg.files.length === 0)) {
    await say({
      text: "Please provide RFP details after `!estimate` — paste text, attach a PDF, or share a Google Doc link.",
      thread_ts: msg.ts,
    });
    return;
  }

  await say({
    text: [
      "*RFP received!* Starting the estimation workflow...",
      "",
      "I'll post updates in this thread as I work through:",
      "1. RFP Analysis",
      "2. Clarifying Questions (if needed)",
      "3. Google Docs Offer",
      "4. Gamma Visual Presentation",
    ].join("\n"),
    thread_ts: msg.ts,
  });

  const slackFiles = (msg.files ?? []).map((f) => ({
    name: f.name,
    mimetype: f.mimetype,
    url_private_download: f.url_private_download,
  }));

  const hasFiles = slackFiles.length > 0;
  const hasGoogleDocsLinks = /docs\.google\.com\/document\/d\//.test(msg.text);

  let jobPayload: Parameters<typeof enqueueEstimation>[0];

  if (hasFiles || hasGoogleDocsLinks) {
    // File-based flow: upload to Drive, pass folder IDs
    const { ingestEstimationFiles } = await import("../lib/file-ingestion.js");
    const tempJobId = `est_${Date.now()}`;

    try {
      const result = await ingestEstimationFiles({
        messageText: msg.text,
        slackFiles,
        jobId: tempJobId,
      });

      jobPayload = {
        channelId: msg.channel,
        threadTs: msg.ts,
        inputFolderId: result.inputFolderId,
        outputFolderId: result.outputFolderId,
        estimationFolderId: result.estimationFolderId,
        messageText: result.messageText,
      };

      await say({
        text: `Uploaded ${result.filesUploaded} file(s) to Google Drive. Analyzing...`,
        thread_ts: msg.ts,
      });
    } catch (err) {
      logger.error("File ingestion failed, falling back to text-only", { error: String(err) });
      jobPayload = {
        rfpText: rawText,
        channelId: msg.channel,
        threadTs: msg.ts,
      };
    }
  } else {
    // Text-only flow (backward compat)
    if (rawText.length < 20) {
      await say({
        text: "Please provide more RFP details. Minimum 20 characters, or attach a PDF / Google Doc link.",
        thread_ts: msg.ts,
      });
      return;
    }
    jobPayload = {
      rfpText: rawText,
      channelId: msg.channel,
      threadTs: msg.ts,
    };
  }

  const jobId = await enqueueEstimation(jobPayload);

  logger.info("Estimation job enqueued", {
    jobId,
    user: msg.user,
    channel: msg.channel,
    hasFiles,
    hasGoogleDocsLinks,
    rfpLength: rawText.length,
  });
});
```

**Step 2: Build**

Run: `npx tsc --noEmit`
Expected: Pass

**Step 3: Commit**

```bash
git add src/slack/bolt-app.ts
git commit -m "feat: Slack handler uploads files to Drive before enqueueing"
```

---

### Task 7: Update existing tests for new EstimationJob shape

**Files:**
- Modify: `src/agents/orchestrator.test.ts`
- Modify: `src/slack/bolt-app.test.ts`

**Step 1: Update orchestrator.test.ts makeJob()**

Update the `makeJob` helper to reflect the new optional fields:

```typescript
function makeJob(overrides: Partial<EstimationJob> = {}): EstimationJob {
  return {
    jobId: "est_1234567890",
    channelId: "C0123456789",
    threadTs: "1700000000.000000",
    rfpText: "We need a SaaS platform for managing freelancer contracts.",
    ...overrides,
  };
}
```

Add tests for new fields:

```typescript
it("supports Drive folder IDs for file-based flow", () => {
  const job = makeJob({
    rfpText: undefined,
    inputFolderId: "folder_input_123",
    outputFolderId: "folder_output_456",
    estimationFolderId: "folder_est_789",
    messageText: "Check this RFP",
  });
  assert.equal(job.inputFolderId, "folder_input_123");
  assert.equal(job.outputFolderId, "folder_output_456");
  assert.ok(!job.rfpText);
});
```

**Step 2: Update bolt-app.test.ts**

Add tests for the new `extractMessageText` behavior if not already covered by `file-ingestion.test.ts`.

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/agents/orchestrator.test.ts src/slack/bolt-app.test.ts
git commit -m "test: update tests for Drive-based EstimationJob"
```

---

### Task 8: Full build + verification

**Step 1: Build**

Run: `npm run build`
Expected: Clean compilation, exit 0

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Final commit and push**

```bash
git push origin master
```

---

## Notes

- The `@googleapis/mcp-server-google-workspace` package referenced in orchestrator.ts does not exist on npm. This needs to be replaced with a working package (e.g. `@presto-ai/google-workspace-mcp` or similar) in a separate task — it affects the agent's ability to read from Drive and create docs.
- The `GDRIVE_ROOT_FOLDER_ID` env var must be set before testing. Create a "Estimations" folder in your Google Drive and copy its folder ID from the URL.
- Slack bot needs `files:read` OAuth scope to download file attachments. Check the Slack app manifest.
