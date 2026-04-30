# SPEC-024: Google Drive Folder Link Ingestion

**Status**: Implemented
**Date**: 2026-03-06

## Problem

When a user pastes a Google Drive folder link (e.g. `drive.google.com/drive/folders/FOLDER_ID`) containing client materials (PDFs, Docs, Sheets, images, etc.), the bot ignores it entirely. The URL detection only matches `docs.google.com/document/d/` patterns. The folder link falls through to plain-text mode, where the raw URL string becomes the "RFP text" — producing garbage output.

## Goal

Support Google Drive folder links as RFP input. The bot should recursively crawl the shared folder, copy all files to the estimation's Input folder, and give the agent access to read them during the pipeline.

## Design

### 1. URL Detection (`src/lib/google-drive.ts`)

Add new extraction functions alongside `extractAllGoogleDocsIds()`:

```typescript
// Existing (keep):
// docs.google.com/document/d/DOC_ID

// New patterns to detect:
// drive.google.com/drive/folders/FOLDER_ID
// drive.google.com/drive/u/N/folders/FOLDER_ID
// docs.google.com/spreadsheets/d/SHEET_ID
// docs.google.com/presentation/d/PRES_ID
// drive.google.com/file/d/FILE_ID
// drive.google.com/open?id=FILE_ID
```

Add a unified `extractAllDriveLinks(text)` function that returns typed results:
```typescript
interface DriveLink {
  type: "folder" | "document" | "spreadsheet" | "presentation" | "file";
  id: string;
}
```

### 2. Folder Crawling (`src/lib/google-drive.ts`)

New `listFolderRecursive(folderId, opts)` function:
- Lists files via Drive API v3 `files.list` with `'FOLDER_ID' in parents and trashed = false`
- Recurses into subfolders (mimeType `application/vnd.google-apps.folder`)
- Returns flat list of `{ id, name, mimeType, path, size }`
- Safety limits: `maxDepth: 5`, `maxFiles: 100`
- Uses pagination (`pageToken`) for folders with many files
- `supportsAllDrives=true` and `includeItemsFromAllDrives=true` for shared drives

### 3. File Processing (`src/lib/file-ingestion.ts`)

Add a new `ingestDriveFolder(folderId, inputFolderId, jobId)` function:

For each file found in the crawled folder:

| Source file type | Action | Agent access |
|---|---|---|
| Google Doc | `copyDriveFile()` to Input | `drive_export_file` → text/plain |
| Google Sheet | `copyDriveFile()` to Input | `drive_export_file` → text/csv |
| Google Slides | `copyDriveFile()` to Input | `drive_export_file` → text/plain |
| Uploaded PDF | `copyDriveFile()` to Input + `uploadAndConvertToDriveDoc()` for OCR text version | Agent reads converted Doc via text/plain |
| Image (PNG/JPG/etc) | `copyDriveFile()` to Input | Listed in folder; agent references in context |
| DOCX/XLSX/PPTX | `copyDriveFile()` to Input | Drive auto-converts on copy if possible |
| Other | `copyDriveFile()` to Input | Best effort |

PDF handling detail: uploaded PDFs in Drive can't be exported as text via the API. We use `uploadAndConvertToDriveDoc()` (already exists in `google-drive.ts`) to create a Google Doc version via Drive's built-in OCR. The converted doc lives alongside the original in the Input folder with a `-text` suffix. The orchestrator prompt tells the agent about these converted files.

### 4. Slack Handler (`src/slack/bolt-app.ts`)

Update the message handler:
- Replace the `hasGoogleDocsLinks` check with `extractAllDriveLinks()` to detect all Drive URL types
- When a folder link is detected, call `ingestDriveFolder()` before enqueueing the job
- Post a progress message to Slack: "Found a Google Drive folder. Scanning files..."
- When individual file links (Sheets, Slides, etc.) are detected, copy them to Input folder like we do for Docs
- Handle permission errors (403) with a user-friendly message including the service account email

### 5. Orchestrator Prompt (`src/agents/orchestrator.ts`)

Update the `rfpSource` section for the folder ingestion case:
- Include a manifest of files found: name, type, and whether a text-converted version exists
- Instruct the agent to use `drive_list_files` on the Input folder
- Instruct: for Google Sheets, use `drive_export_file` with `text/csv`; for Slides, use `text/plain`
- Note which files are "converted from PDF" so the agent reads those for text content
- Keep existing behavior for the `rfpText` and plain `inputFolderId` paths

### 6. Error Handling

- **Permission denied (403)**: Post to Slack: "I can't access that folder. Please share it with `[service-account-email]` and try again."
- **Empty folder**: Post to Slack: "The folder is empty or contains no readable files."
- **Partial failures**: Copy what we can, log failures, continue. Post a warning listing failed files.
- **Rate limiting**: Add small delay between API calls if processing >20 files.
- **Timeout**: Cap total ingestion time at 60 seconds. If exceeded, proceed with what's been processed.

## File Manifest

The ingestion result should include a structured manifest for the orchestrator:

```typescript
interface FileManifest {
  files: Array<{
    name: string;
    type: "document" | "spreadsheet" | "presentation" | "pdf" | "image" | "other";
    driveId: string;
    /** ID of text-converted version (for PDFs) */
    convertedDocId?: string;
    /** Relative path within the source folder */
    sourcePath: string;
  }>;
  totalFiles: number;
  failedFiles: string[];
}
```

This manifest is serialized into the orchestrator prompt so the agent knows exactly what's available and how to access each file.

## Implementation Plan

- [x] 1. Add `extractAllDriveLinks()` to `src/lib/google-drive.ts` with regex for all URL patterns
- [x] 2. Add `listFolderRecursive()` to `src/lib/google-drive.ts` with safety limits
- [x] 3. Add `ingestDriveFolder()` to `src/lib/file-ingestion.ts` — crawl, copy, convert PDFs
- [x] 4. Add `FileManifest` type and manifest builder to `src/lib/file-ingestion.ts`
- [x] 5. Update `ingestEstimationFiles()` to call `ingestDriveFolder()` when folder links detected
- [x] 6. Update Slack handler in `src/slack/bolt-app.ts` to detect all Drive link types
- [x] 7. Update orchestrator prompt in `src/agents/orchestrator.ts` to include file manifest
- [x] 8. Add permission error handling with user-friendly Slack message
- [x] 9. Add tests for URL extraction (all patterns), folder crawling (mock), manifest building
- [x] 10. Type-check (`npx tsc --noEmit`) and manual test with a real Drive folder
- [x] 11. Update `.ai/lessons.md` if new pitfalls discovered
