# SPEC-041: Slack PDF/DOCX OCR Conversion + File Manifest

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Slack-uploaded PDFs/DOCX being unreadable by the agent after SPEC-035 changed the orchestrator to prioritize Drive folder reading over inline rfpText.

**Architecture:** Add OCR conversion (`uploadAndConvertToDriveDoc`) and `FileManifest` building to the Slack file upload path in `ingestEstimationFiles()`, matching what `ingestDriveFolder()` already does. No orchestrator changes needed — the manifest format and reading instructions already handle `convertedDocId`.

**Tech Stack:** `src/lib/file-ingestion.ts`, `src/lib/file-ingestion.test.ts`

**Status:** Implemented
**Date:** 2026-03-16

---

## Root Cause

SPEC-035 (commit `6d3c0f9`) flipped the orchestrator's RFP source priority from `rfpText > inputFolderId` to `inputFolderId > rfpText`. When a user uploads PDFs via Slack, `ingestEstimationFiles` creates a Drive folder (`inputFolderId` is set) and extracts text via Claude (`rfpText` is set). Post-SPEC-035, the orchestrator ignores `rfpText` and tells the agent to read from Drive. But the Slack path never creates text-version Google Docs, so `drive_export_file` returns raw PDF binary (`%PDF-1.4` gibberish).

The Drive folder ingestion path (`ingestDriveFolder`) doesn't have this problem because it calls `uploadAndConvertToDriveDoc` for each PDF and sets `convertedDocId` in the manifest.

---

## Plan

### Task 1: Add OCR conversion and manifest to Slack upload path

**Files:**
- Modify: `src/lib/file-ingestion.ts` (lines 385-514)

**Step 1: Initialize a FileManifest before the Slack file loop**

At line 387, after `const failedFiles: string[] = [];`, add:

```typescript
const slackManifest: FileManifest = {
  files: [],
  totalFiles: slackFiles.length,
  failedFiles: [],
};
```

**Step 2: Capture driveId from uploadFileToDrive**

Change line 409 from:
```typescript
await uploadFileToDrive(file.name, file.mimetype, buffer, inputFolderId);
```
To:
```typescript
const driveId = await uploadFileToDrive(file.name, file.mimetype, buffer, inputFolderId);
```

**Step 3: Add OCR conversion for PDFs after upload**

After line 412 (`logger.info("Uploaded Slack file to Drive"...)`), before the text extraction block, add:

```typescript
// Create text-version Google Doc so the agent can read via drive_export_file
let convertedDocId: string | undefined;
if (file.mimetype === "application/pdf") {
  try {
    convertedDocId = await uploadAndConvertToDriveDoc(
      `${file.name} (text)`, file.mimetype, buffer, inputFolderId,
    );
    logger.info("PDF converted to Doc for text access", { jobId, fileName: file.name, convertedDocId });
  } catch (convertErr) {
    logger.warn("PDF OCR conversion failed, original still available", {
      jobId, fileName: file.name, error: String(convertErr),
    });
  }
}
```

**Step 4: Add OCR conversion for DOCX files**

After the DOCX text extraction block (line 434), add:

```typescript
// Also create a native Google Doc for DOCX so agent can read via drive_export_file
if (classifySlackFile(file.mimetype) === "docx" && !convertedDocId) {
  try {
    convertedDocId = await uploadAndConvertToDriveDoc(
      `${file.name} (text)`, file.mimetype, buffer, inputFolderId,
    );
    logger.info("DOCX converted to Doc for text access", { jobId, fileName: file.name, convertedDocId });
  } catch (convertErr) {
    logger.warn("DOCX conversion failed, original still available", {
      jobId, fileName: file.name, error: String(convertErr),
    });
  }
}
```

Note: declare `let convertedDocId: string | undefined;` BEFORE the PDF block so DOCX can also use it. Move the declaration to right after the `driveId` line.

**Step 5: Build manifest entry for each file**

After the OCR conversion blocks (end of the per-file processing, before the catch), add:

```typescript
const fileType = classifyDriveFileForManifest(file.mimetype);
slackManifest.files.push({
  name: file.name,
  type: fileType,
  driveId,
  convertedDocId,
  sourcePath: file.name,
});
```

**Step 6: Merge Slack manifest with Drive folder manifest**

After the Drive folder ingestion block (around line 476), merge the two manifests:

```typescript
// Merge Slack file manifest with Drive folder manifest
if (fileManifest) {
  // Drive folder manifest exists — merge Slack files into it
  fileManifest.files.push(...slackManifest.files);
  fileManifest.totalFiles += slackManifest.totalFiles;
  fileManifest.failedFiles.push(...slackManifest.failedFiles);
} else if (slackManifest.files.length > 0) {
  fileManifest = slackManifest;
}
```

**Step 7: Run type check and tests**

```bash
npx tsc --noEmit
npm test
```

**Step 8: Commit**

```bash
git add src/lib/file-ingestion.ts
git commit -m "fix(slack-pdf): add OCR conversion and file manifest for Slack uploads"
```

---

### Task 2: Update lessons and verify

**Files:**
- Modify: `.ai/lessons.md`

- [ ] Append lesson about SPEC-035 side effect: "When changing prompt priority for RFP sources, ensure all ingestion paths produce the same Drive structure (text-version Docs + manifest). Slack uploads and Drive folder ingestion must be symmetric."
- [ ] Run `npx tsc --noEmit` and `npm test`
- [ ] Self-review: `grep -c "uploadAndConvertToDriveDoc" src/lib/file-ingestion.ts` — should be 2+ (Slack PDF + DOCX)
- [ ] Update SPEC-041 status to Implemented
- [ ] Push and create PR
