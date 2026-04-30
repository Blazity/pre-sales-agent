# Drive Folder Link Ingestion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support Google Drive folder links as RFP input — recursively crawl shared folders, copy files to Input folder, and give the agent access to read them.

**Architecture:** Extend the existing file-ingestion pipeline. Add URL detection for all Drive link types, recursive folder crawling via Drive API, file-type-aware copying (with PDF→Doc OCR conversion), and a structured file manifest that the orchestrator passes to the agent.

**Tech Stack:** Google Drive API v3, Node.js `node:test`, existing `google-drive.ts` and `file-ingestion.ts` modules.

**Spec:** `.ai/specs/SPEC-024-drive-folder-ingestion.md`

---

### Task 1: Add `extractAllDriveLinks()` to `src/lib/google-drive.ts`

**Files:**
- Modify: `src/lib/google-drive.ts:50-65` (after existing URL helpers)
- Test: `src/lib/google-drive.test.ts`

**Step 1: Write the failing tests**

Add to `src/lib/google-drive.test.ts`, after the existing `extractAllGoogleDocsIds` tests. Import `extractAllDriveLinks` in the dynamic import block at line 28-33:

```typescript
// Add to the dynamic import at line 28-33:
const {
  buildFolderMetadata,
  buildUploadMetadata,
  extractGoogleDocsId,
  extractAllGoogleDocsIds,
  extractAllDriveLinks,
} = await import("./google-drive.js");

// Add this describe block after the existing tests:
describe("extractAllDriveLinks()", () => {
  it("extracts folder links", () => {
    const text = "Here: https://drive.google.com/drive/folders/1aBcDeFgHiJk";
    const links = extractAllDriveLinks(text);
    assert.deepEqual(links, [{ type: "folder", id: "1aBcDeFgHiJk" }]);
  });

  it("extracts folder links with /u/N/ path", () => {
    const text = "https://drive.google.com/drive/u/0/folders/1aBcDeFgHiJk";
    const links = extractAllDriveLinks(text);
    assert.deepEqual(links, [{ type: "folder", id: "1aBcDeFgHiJk" }]);
  });

  it("extracts document links", () => {
    const text = "https://docs.google.com/document/d/abc123/edit";
    const links = extractAllDriveLinks(text);
    assert.deepEqual(links, [{ type: "document", id: "abc123" }]);
  });

  it("extracts spreadsheet links", () => {
    const text = "https://docs.google.com/spreadsheets/d/sheet123/edit";
    const links = extractAllDriveLinks(text);
    assert.deepEqual(links, [{ type: "spreadsheet", id: "sheet123" }]);
  });

  it("extracts presentation links", () => {
    const text = "https://docs.google.com/presentation/d/pres456/edit";
    const links = extractAllDriveLinks(text);
    assert.deepEqual(links, [{ type: "presentation", id: "pres456" }]);
  });

  it("extracts drive file links", () => {
    const text = "https://drive.google.com/file/d/file789/view";
    const links = extractAllDriveLinks(text);
    assert.deepEqual(links, [{ type: "file", id: "file789" }]);
  });

  it("extracts open?id= links", () => {
    const text = "https://drive.google.com/open?id=open123";
    const links = extractAllDriveLinks(text);
    assert.deepEqual(links, [{ type: "file", id: "open123" }]);
  });

  it("extracts multiple mixed links", () => {
    const text = `
      Folder: https://drive.google.com/drive/folders/folder1
      Doc: https://docs.google.com/document/d/doc1/edit
      Sheet: https://docs.google.com/spreadsheets/d/sheet1/edit
    `;
    const links = extractAllDriveLinks(text);
    assert.equal(links.length, 3);
    assert.deepEqual(links[0], { type: "folder", id: "folder1" });
    assert.deepEqual(links[1], { type: "document", id: "doc1" });
    assert.deepEqual(links[2], { type: "spreadsheet", id: "sheet1" });
  });

  it("deduplicates same ID appearing multiple times", () => {
    const text = "https://drive.google.com/drive/folders/abc https://drive.google.com/drive/folders/abc";
    const links = extractAllDriveLinks(text);
    assert.equal(links.length, 1);
  });

  it("returns empty array for text with no drive links", () => {
    assert.deepEqual(extractAllDriveLinks("no links here"), []);
  });

  it("handles links with query params and fragments", () => {
    const text = "https://drive.google.com/drive/folders/folder1?usp=sharing#heading";
    const links = extractAllDriveLinks(text);
    assert.deepEqual(links, [{ type: "folder", id: "folder1" }]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/google-drive.test.ts`
Expected: FAIL — `extractAllDriveLinks` is not exported

**Step 3: Implement `extractAllDriveLinks`**

Add to `src/lib/google-drive.ts` after line 65 (after `extractAllGoogleDocsIds`):

```typescript
export interface DriveLink {
  type: "folder" | "document" | "spreadsheet" | "presentation" | "file";
  id: string;
}

export function extractAllDriveLinks(text: string): DriveLink[] {
  const patterns: Array<{ type: DriveLink["type"]; re: RegExp }> = [
    { type: "folder",       re: /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/g },
    { type: "document",     re: /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g },
    { type: "spreadsheet",  re: /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/g },
    { type: "presentation", re: /docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/g },
    { type: "file",         re: /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/g },
    { type: "file",         re: /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/g },
  ];

  const seen = new Set<string>();
  const links: DriveLink[] = [];

  for (const { type, re } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const id = m[1];
      const key = `${type}:${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ type, id });
      }
    }
  }

  return links;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/google-drive.test.ts`
Expected: All PASS

**Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/lib/google-drive.ts src/lib/google-drive.test.ts
git commit -m "feat(drive-folder): add extractAllDriveLinks URL parser"
```

---

### Task 2: Add `downloadDriveFile()` and `listFolderRecursive()` to `src/lib/google-drive.ts`

**Files:**
- Modify: `src/lib/google-drive.ts` (after `copyDriveFile()` at ~line 206)
- Test: `src/lib/google-drive.test.ts`

**Step 1: Write the failing tests**

These functions call the Drive API, so test the pure logic parts. Add to `google-drive.test.ts`:

```typescript
// Add to dynamic import:
const {
  // ...existing imports...
  extractAllDriveLinks,
  classifyDriveMimeType,
} = await import("./google-drive.js");

// Add after extractAllDriveLinks tests:
describe("classifyDriveMimeType()", () => {
  it("classifies Google Docs", () => {
    assert.equal(classifyDriveMimeType("application/vnd.google-apps.document"), "document");
  });

  it("classifies Google Sheets", () => {
    assert.equal(classifyDriveMimeType("application/vnd.google-apps.spreadsheet"), "spreadsheet");
  });

  it("classifies Google Slides", () => {
    assert.equal(classifyDriveMimeType("application/vnd.google-apps.presentation"), "presentation");
  });

  it("classifies PDFs", () => {
    assert.equal(classifyDriveMimeType("application/pdf"), "pdf");
  });

  it("classifies images", () => {
    assert.equal(classifyDriveMimeType("image/png"), "image");
    assert.equal(classifyDriveMimeType("image/jpeg"), "image");
  });

  it("classifies folders", () => {
    assert.equal(classifyDriveMimeType("application/vnd.google-apps.folder"), "folder");
  });

  it("returns other for unknown types", () => {
    assert.equal(classifyDriveMimeType("application/octet-stream"), "other");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/google-drive.test.ts`
Expected: FAIL — `classifyDriveMimeType` not exported

**Step 3: Implement the functions**

Add to `src/lib/google-drive.ts` after `copyDriveFile()`:

```typescript
export type DriveFileType = "document" | "spreadsheet" | "presentation" | "pdf" | "image" | "folder" | "other";

export function classifyDriveMimeType(mimeType: string): DriveFileType {
  if (mimeType === "application/vnd.google-apps.document") return "document";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "spreadsheet";
  if (mimeType === "application/vnd.google-apps.presentation") return "presentation";
  if (mimeType === "application/vnd.google-apps.folder") return "folder";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  return "other";
}

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  type: DriveFileType;
  path: string;
  size?: number;
}

export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive download failed: ${res.status} ${text}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const MAX_FOLDER_DEPTH = 5;
const MAX_FOLDER_FILES = 100;

export async function listFolderRecursive(
  folderId: string,
  opts?: { currentPath?: string; depth?: number; accumulated?: DriveFileEntry[] },
): Promise<DriveFileEntry[]> {
  const currentPath = opts?.currentPath ?? "";
  const depth = opts?.depth ?? 0;
  const accumulated = opts?.accumulated ?? [];

  if (depth > MAX_FOLDER_DEPTH || accumulated.length >= MAX_FOLDER_FILES) {
    return accumulated;
  }

  const token = await getAccessToken();
  let pageToken: string | undefined;

  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    let url = `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name,mimeType,size),nextPageToken&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Drive list failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as {
      files: Array<{ id: string; name: string; mimeType: string; size?: string }>;
      nextPageToken?: string;
    };

    for (const file of data.files) {
      if (accumulated.length >= MAX_FOLDER_FILES) break;

      const type = classifyDriveMimeType(file.mimeType);
      const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;

      if (type === "folder") {
        await listFolderRecursive(file.id, {
          currentPath: filePath,
          depth: depth + 1,
          accumulated,
        });
      } else {
        accumulated.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          type,
          path: filePath,
          size: file.size ? Number(file.size) : undefined,
        });
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken && accumulated.length < MAX_FOLDER_FILES);

  return accumulated;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/google-drive.test.ts`
Expected: All PASS

**Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/lib/google-drive.ts src/lib/google-drive.test.ts
git commit -m "feat(drive-folder): add folder crawling and file type classification"
```

---

### Task 3: Add `FileManifest` type and `ingestDriveFolder()` to `src/lib/file-ingestion.ts`

**Files:**
- Modify: `src/lib/file-ingestion.ts` (add imports, types, and new function after line 375)
- Test: `src/lib/file-ingestion.test.ts`

**Step 1: Write the failing tests**

Add to `file-ingestion.test.ts`. Since `ingestDriveFolder` calls Drive APIs, test the helper `classifyDriveFileForManifest` (a pure function):

```typescript
// Add to dynamic import:
const {
  // ...existing imports...
  classifyDriveFileForManifest,
} = await import("./file-ingestion.js");

// Add describe block:
describe("classifyDriveFileForManifest()", () => {
  it("returns document for Google Docs mimeType", () => {
    assert.equal(classifyDriveFileForManifest("application/vnd.google-apps.document"), "document");
  });

  it("returns spreadsheet for Google Sheets", () => {
    assert.equal(classifyDriveFileForManifest("application/vnd.google-apps.spreadsheet"), "spreadsheet");
  });

  it("returns presentation for Google Slides", () => {
    assert.equal(classifyDriveFileForManifest("application/vnd.google-apps.presentation"), "presentation");
  });

  it("returns pdf for application/pdf", () => {
    assert.equal(classifyDriveFileForManifest("application/pdf"), "pdf");
  });

  it("returns image for image types", () => {
    assert.equal(classifyDriveFileForManifest("image/png"), "image");
    assert.equal(classifyDriveFileForManifest("image/jpeg"), "image");
  });

  it("returns other for unknown types", () => {
    assert.equal(classifyDriveFileForManifest("application/zip"), "other");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/file-ingestion.test.ts`
Expected: FAIL — `classifyDriveFileForManifest` not exported

**Step 3: Implement `FileManifest`, `classifyDriveFileForManifest`, and `ingestDriveFolder`**

Add new imports at top of `src/lib/file-ingestion.ts`:

```typescript
import {
  createDriveFolder,
  uploadFileToDrive,
  copyDriveFile,
  extractAllGoogleDocsIds,
  extractAllDriveLinks,
  listFolderRecursive,
  downloadDriveFile,
  uploadAndConvertToDriveDoc,
  classifyDriveMimeType,
} from "./google-drive.js";
```

Remove from existing imports: `extractAllGoogleDocsIds` is already there. Add the new ones: `extractAllDriveLinks, listFolderRecursive, downloadDriveFile, uploadAndConvertToDriveDoc, classifyDriveMimeType`.

Add after line 244 (after `extractMessageText`):

```typescript
// ── File manifest types ─────────────────────────────────────────────────────

export type ManifestFileType = "document" | "spreadsheet" | "presentation" | "pdf" | "image" | "other";

export function classifyDriveFileForManifest(mimeType: string): ManifestFileType {
  const driveType = classifyDriveMimeType(mimeType);
  if (driveType === "folder") return "other";
  return driveType;
}

export interface FileManifestEntry {
  name: string;
  type: ManifestFileType;
  driveId: string;
  convertedDocId?: string;
  sourcePath: string;
}

export interface FileManifest {
  files: FileManifestEntry[];
  totalFiles: number;
  failedFiles: string[];
}
```

Add `ingestDriveFolder` after the manifest types:

```typescript
// ── Drive folder ingestion ──────────────────────────────────────────────────

export async function ingestDriveFolder(opts: {
  folderId: string;
  inputFolderId: string;
  jobId: string;
}): Promise<FileManifest> {
  const { folderId, inputFolderId, jobId } = opts;

  logger.info("Starting Drive folder ingestion", { jobId, folderId });

  const entries = await listFolderRecursive(folderId);
  logger.info("Folder crawl complete", { jobId, totalFiles: entries.length });

  const manifest: FileManifest = {
    files: [],
    totalFiles: entries.length,
    failedFiles: [],
  };

  for (const entry of entries) {
    try {
      const fileType = classifyDriveFileForManifest(entry.mimeType);
      const manifestEntry: FileManifestEntry = {
        name: entry.name,
        type: fileType,
        driveId: "",
        sourcePath: entry.path,
      };

      // Copy the file to Input folder
      const copyName = entry.path.replace(/\//g, " - ");
      const copiedId = await copyDriveFile(entry.id, copyName, inputFolderId);
      manifestEntry.driveId = copiedId;

      // For PDFs: also create an OCR-converted Google Doc version
      if (fileType === "pdf") {
        try {
          const buffer = await downloadDriveFile(entry.id);
          const convertedId = await uploadAndConvertToDriveDoc(
            `${entry.name} (text)`,
            "application/pdf",
            buffer,
            inputFolderId,
          );
          manifestEntry.convertedDocId = convertedId;
          logger.info("PDF converted to Doc for text access", { jobId, fileName: entry.name, convertedId });
        } catch (convertErr) {
          logger.warn("PDF OCR conversion failed, original still available", {
            jobId, fileName: entry.name, error: String(convertErr),
          });
        }
      }

      manifest.files.push(manifestEntry);
      logger.info("Copied Drive file to Input", { jobId, fileName: entry.name, type: fileType });
    } catch (err) {
      logger.error("Failed to process Drive file", { jobId, fileName: entry.name, error: String(err) });
      manifest.failedFiles.push(entry.name);
    }
  }

  return manifest;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/file-ingestion.test.ts`
Expected: All PASS

**Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/lib/file-ingestion.ts src/lib/file-ingestion.test.ts
git commit -m "feat(drive-folder): add folder ingestion with PDF OCR conversion"
```

---

### Task 4: Update `ingestEstimationFiles()` and `extractMessageText()` to handle Drive links

**Files:**
- Modify: `src/lib/file-ingestion.ts:239-375` (update `extractMessageText` and `ingestEstimationFiles`)
- Test: `src/lib/file-ingestion.test.ts`

**Step 1: Write the failing tests**

Add to `file-ingestion.test.ts` inside the existing `extractMessageText` describe block:

```typescript
it("strips Google Drive folder URLs from the text", () => {
  const text = "!estimate Check https://drive.google.com/drive/folders/abc123 for materials";
  const result = extractMessageText(text);
  assert.ok(!result.includes("drive.google.com"));
  assert.ok(result.includes("Check"));
  assert.ok(result.includes("for materials"));
});

it("strips Google Sheets URLs from the text", () => {
  const text = "!estimate Budget here https://docs.google.com/spreadsheets/d/sheet1/edit";
  const result = extractMessageText(text);
  assert.ok(!result.includes("docs.google.com"));
});

it("strips Google Drive file URLs from the text", () => {
  const text = "!estimate RFP: https://drive.google.com/file/d/file123/view";
  const result = extractMessageText(text);
  assert.ok(!result.includes("drive.google.com"));
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/file-ingestion.test.ts`
Expected: FAIL — new URL patterns not stripped

**Step 3: Update `extractMessageText`**

Replace the `extractMessageText` function in `src/lib/file-ingestion.ts`:

```typescript
export function extractMessageText(text: string): string {
  return text
    .replace(/^!estimate\s*/i, "")
    .replace(/https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[a-zA-Z0-9_-]+(\/[^\s]*)?/g, "")
    .replace(/https?:\/\/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders|file\/d)\/[a-zA-Z0-9_-]+(\/[^\s]*)?/g, "")
    .replace(/https?:\/\/drive\.google\.com\/open\?id=[a-zA-Z0-9_-]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/file-ingestion.test.ts`
Expected: All PASS

**Step 5: Update `ingestEstimationFiles` to handle Drive folder links**

Modify `ingestEstimationFiles` in `src/lib/file-ingestion.ts`. Add Drive link detection and folder ingestion after the existing Google Docs copying block (after line 352). Update the `IngestionResult` interface to include the manifest:

```typescript
export interface IngestionResult {
  estimationFolderId: string;
  inputFolderId: string;
  outputFolderId: string;
  messageText: string;
  filesUploaded: number;
  extractedRfpText: string;
  failedFiles: string[];
  /** Manifest of files from Drive folder ingestion */
  fileManifest?: FileManifest;
}
```

In `ingestEstimationFiles`, after the existing `docIds` loop (after line 352), add:

```typescript
  // Handle Drive folder links — crawl and copy all files
  const driveLinks = extractAllDriveLinks(messageText);
  const folderLinks = driveLinks.filter((l) => l.type === "folder");
  let fileManifest: FileManifest | undefined;

  if (folderLinks.length > 0) {
    try {
      // Ingest from the first folder link (most common case)
      fileManifest = await ingestDriveFolder({
        folderId: folderLinks[0].id,
        inputFolderId,
        jobId,
      });
      filesUploaded += fileManifest.files.length;
      failedFiles.push(...fileManifest.failedFiles);
      logger.info("Drive folder ingestion complete", {
        jobId,
        totalFiles: fileManifest.totalFiles,
        copied: fileManifest.files.length,
        failed: fileManifest.failedFiles.length,
      });
    } catch (err) {
      logger.error("Drive folder ingestion failed", { jobId, error: String(err) });
      failedFiles.push(`Folder: ${folderLinks[0].id}`);
    }
  }

  // Handle individual non-folder Drive links (Sheets, Slides, files)
  const individualLinks = driveLinks.filter(
    (l) => l.type !== "folder" && l.type !== "document", // documents already handled above
  );
  for (const link of individualLinks) {
    try {
      await copyDriveFile(link.id, `RFP-${link.type}-${link.id.slice(0, 8)}`, inputFolderId);
      filesUploaded++;
      logger.info("Copied Drive link to Input", { jobId, type: link.type, id: link.id });
    } catch (err) {
      logger.error("Failed to copy Drive link", { jobId, type: link.type, id: link.id, error: String(err) });
    }
  }
```

Update the return statement to include `fileManifest`:

```typescript
  return {
    estimationFolderId,
    inputFolderId,
    outputFolderId,
    messageText: cleanText,
    filesUploaded,
    extractedRfpText,
    failedFiles,
    fileManifest,
  };
```

**Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/lib/file-ingestion.ts src/lib/file-ingestion.test.ts
git commit -m "feat(drive-folder): integrate folder ingestion into estimation pipeline"
```

---

### Task 5: Update Slack handler to detect all Drive link types

**Files:**
- Modify: `src/slack/bolt-app.ts:113-178`

**Step 1: Update imports**

At the top of `bolt-app.ts`, the file-ingestion module is dynamically imported at line 119. We need the new `extractAllDriveLinks` from `google-drive.ts`. Add this import at the top of the file (after line 9):

```typescript
import { extractAllDriveLinks } from "../lib/google-drive.js";
```

**Step 2: Replace the `hasGoogleDocsLinks` detection**

In the `app.message` handler, replace line 114:

```typescript
// OLD:
const hasGoogleDocsLinks = /docs\.google\.com\/document\/d\//.test(msg.text);

// NEW:
const driveLinks = extractAllDriveLinks(msg.text);
const hasDriveLinks = driveLinks.length > 0;
```

**Step 3: Update the condition that triggers file ingestion**

Replace line 118:

```typescript
// OLD:
if (hasFiles || hasGoogleDocsLinks) {

// NEW:
if (hasFiles || hasDriveLinks) {
```

**Step 4: Add progress message for folder ingestion**

After the `say()` call at line 95-103 (the "RFP received" message), add a folder-specific progress message inside the ingestion block:

```typescript
if (hasFiles || hasDriveLinks) {
  const hasFolderLink = driveLinks.some((l) => l.type === "folder");
  if (hasFolderLink) {
    await say({
      text: "Found a Google Drive folder link. Scanning files...",
      blocks: [
        { type: "context", elements: [{ type: "mrkdwn", text: "📂 Found a Google Drive folder link. Scanning and copying files..." }] },
      ],
      thread_ts: msg.ts,
    });
  }

  // ... rest of ingestion code (unchanged)
```

**Step 5: Update the logger call at line 182-189**

Replace `hasGoogleDocsLinks` with `hasDriveLinks` in the log:

```typescript
logger.info("Estimation job enqueued", {
  jobId,
  user: msg.user,
  channel: msg.channel,
  hasFiles,
  hasDriveLinks,
  driveLinksCount: driveLinks.length,
  rfpLength: rawText.length,
});
```

**Step 6: Add permission error handling**

Wrap the `ingestEstimationFiles` call to catch 403 errors specifically. In the `catch` block at line 157-164, add:

```typescript
} catch (err) {
  const errMsg = String(err);
  if (errMsg.includes("403") || errMsg.includes("forbidden") || errMsg.includes("not found")) {
    await say({
      text: "I can't access that Google Drive folder. Please share it with the bot's Google account and try again.",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "⚠️ I can't access that Google Drive link. Please make sure:\n• The folder/file is shared with the bot's Google account\n• Or set the sharing to \"Anyone with the link\"" } },
      ],
      thread_ts: msg.ts,
    });
    return;
  }
  logger.error("File ingestion failed, falling back to text-only", { error: errMsg });
  jobPayload = {
    rfpText: rawText,
    channelId: msg.channel,
    threadTs: msg.ts,
  };
}
```

**Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add src/slack/bolt-app.ts
git commit -m "feat(drive-folder): detect all Drive link types in Slack handler"
```

---

### Task 6: Update orchestrator prompt to include file manifest

**Files:**
- Modify: `src/agents/orchestrator.ts:228-253`
- Modify: `src/queue/producer.ts` (add `fileManifest` to job interface)

**Step 1: Add `fileManifest` to the job payload**

In `src/queue/producer.ts`, find the `EstimationJob` interface and add:

```typescript
fileManifest?: import("../lib/file-ingestion.js").FileManifest;
```

In `src/agents/orchestrator.ts`, the `EstimationJob` interface (line 43-60) also needs the field:

```typescript
/** Manifest of files ingested from a Drive folder */
fileManifest?: {
  files: Array<{
    name: string;
    type: string;
    driveId: string;
    convertedDocId?: string;
    sourcePath: string;
  }>;
  totalFiles: number;
  failedFiles: string[];
};
```

**Step 2: Update the `rfpSource` construction**

In `src/agents/orchestrator.ts`, update the `rfpSource` block (lines 228-253). Modify the `job.inputFolderId` branch to include the manifest:

```typescript
  } else if (job.inputFolderId) {
    const manifestSection = job.fileManifest
      ? `\nFILE MANIFEST (${job.fileManifest.totalFiles} files found):
${job.fileManifest.files.map((f) => {
  let line = `- ${f.sourcePath} (${f.type}) [Drive ID: ${f.driveId}]`;
  if (f.convertedDocId) line += ` → text version: ${f.convertedDocId}`;
  return line;
}).join("\n")}
${job.fileManifest.failedFiles.length > 0 ? `\nFailed to copy: ${job.fileManifest.failedFiles.join(", ")}` : ""}

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
  }
```

**Step 3: Pass `fileManifest` through the job enqueue**

In `src/slack/bolt-app.ts`, update the `jobPayload` construction inside the ingestion success block to include the manifest:

```typescript
jobPayload = {
  channelId: msg.channel,
  threadTs: msg.ts,
  inputFolderId: result.inputFolderId,
  outputFolderId: result.outputFolderId,
  estimationFolderId: result.estimationFolderId,
  messageText: result.messageText,
  rfpText: result.extractedRfpText || undefined,
  fileManifest: result.fileManifest,
};
```

**Step 4: Update the Slack progress message to show manifest summary**

After the existing `say()` at line 142-148, add a manifest summary when available:

```typescript
if (result.fileManifest && result.fileManifest.files.length > 0) {
  const typeCounts = new Map<string, number>();
  for (const f of result.fileManifest.files) {
    typeCounts.set(f.type, (typeCounts.get(f.type) ?? 0) + 1);
  }
  const summary = Array.from(typeCounts.entries())
    .map(([type, count]) => `${count} ${type}(s)`)
    .join(", ");
  await say({
    text: `Found ${result.fileManifest.files.length} files in Drive folder: ${summary}`,
    blocks: [
      { type: "context", elements: [{ type: "mrkdwn", text: `📂 Found *${result.fileManifest.files.length} files* in Drive folder: ${summary}` }] },
    ],
    thread_ts: msg.ts,
  });
}
```

**Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/agents/orchestrator.ts src/queue/producer.ts src/slack/bolt-app.ts
git commit -m "feat(drive-folder): pass file manifest to orchestrator prompt"
```

---

### Task 7: Update the producer interface and add ALLOWED_FOLDER_IDS for shared folders

**Files:**
- Modify: `src/queue/producer.ts`
- Modify: `src/agents/orchestrator.ts:690-696` (allowedFolders)

**Step 1: Verify `fileManifest` flows through BullMQ serialization**

BullMQ serializes job data as JSON. The `FileManifest` interface is plain objects and arrays — no classes or functions. Confirm the producer's `enqueueEstimation` function accepts and passes through the new field. Check the producer file and update its interface if needed.

Read `src/queue/producer.ts` and add `fileManifest` to the interface if not already done in Task 6.

**Step 2: Add shared folder to ALLOWED_FOLDER_IDS**

In `src/agents/orchestrator.ts` at line 690-696, the `allowedFolders` array restricts which folders the MCP server can access. The Input folder is already included. No change needed here — the copied files live in the Input folder which is already allowed.

However, verify that the `assertAllowedFolder` check in the google-workspace MCP only validates `drive_list_files` folder operations, not individual file reads. Read `src/mcp-servers/google-workspace.ts` line 44-48 — the check only applies to `drive_list_files` (line 62). Individual file reads via `drive_export_file` and `drive_get_file` are unrestricted. This is correct behavior since we copy files to the Input folder.

**Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit (if any changes)**

```bash
git add src/queue/producer.ts src/agents/orchestrator.ts
git commit -m "feat(drive-folder): ensure manifest flows through job queue"
```

---

### Task 8: Full type-check and integration test

**Files:**
- All modified files

**Step 1: Run full type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Manual smoke test (if possible)**

If a Redis instance and Google credentials are available locally:
1. Start the dev server: `npm run dev`
2. In Slack, send: `!estimate https://drive.google.com/drive/folders/REAL_FOLDER_ID here's the client materials`
3. Verify: bot posts "Scanning files..." message, then file manifest summary, then proceeds with estimation

**Step 4: Update spec status**

In `.ai/specs/SPEC-024-drive-folder-ingestion.md`, check off completed items.
In `.ai/specs/README.md`, update status from "Planning" to "Implemented".

**Step 5: Update lessons learned**

If any new pitfalls were discovered during implementation, append to `.ai/lessons.md`.

Known things to document:
- Shared Drive folders require the folder to be shared with the bot's Google service account
- PDF OCR conversion via `uploadAndConvertToDriveDoc` works for text-based PDFs but may produce poor results for scanned/image-heavy PDFs
- `listFolderRecursive` has safety limits: 5 levels deep, 100 files max
- The `copyDriveFile` API requires at least Viewer access on the source file

**Step 6: Final commit**

```bash
git add .ai/specs/ .ai/lessons.md
git commit -m "feat(drive-folder): complete implementation and update docs"
```
