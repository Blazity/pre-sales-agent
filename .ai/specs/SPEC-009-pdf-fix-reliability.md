# SPEC-009: PDF Fix & Reliability

**Status:** Implemented
**Date:** 2026-02-27

---

# PDF Fix & Reliability Phase — Design

## Problem Statement

Slack file downloads repeatedly return ~49KB HTML error pages instead of the actual PDF content. The root cause is that `fetch()` drops the `Authorization` header on cross-origin redirects (Slack → CDN), causing Slack to return a 200 OK HTML login page. The current code only checks `res.ok`, so the HTML body passes through as a "valid" download and gets uploaded to Drive as a broken file.

## Scope

Three workstreams:

1. **PDF download resilience** — fix the immediate bug, prevent recurrence
2. **Structured error alerting** — surface failures to users and ops
3. **Observability + deployment hardening** — consistent logging, memory monitoring, test coverage

---

## Workstream 1: PDF Download Resilience

### 1.1 Content-Type validation on response

**File:** `src/lib/file-ingestion.ts` → `downloadSlackFile()`

After `fetch()` returns, check `Content-Type` header. If it's `text/html` when we expected a binary file, the download is an error page.

```
- Check res.headers.get("content-type")
- If text/html → log diagnostic, throw DownloadValidationError
- Accept: application/pdf, application/octet-stream, binary/octet-stream
```

### 1.2 Size comparison with Slack-reported size

**File:** `src/lib/file-ingestion.ts`, `src/slack/bolt-app.ts`

Slack's message event includes `file.size` (bytes). Pass it through to `downloadSlackFile()` and compare after download.

```
- Add expectedSize param to downloadSlackFile(url, expectedSize?)
- After download: if |actual - expected| > 10% → log warning, trigger retry
- Slack file object: add `size` field to SlackFile interface
- bolt-app.ts: extract f.size from msg.files
```

### 1.3 Validate before upload (reorder operations)

**File:** `src/lib/file-ingestion.ts` → `ingestEstimationFiles()`

Currently: download → upload to Drive → validate PDF. Should be: download → validate → upload.

```
Current (broken):
  line 96: buffer = downloadSlackFile(...)
  line 99: uploadFileToDrive(...)        ← uploads garbage
  line 105: if (!isValidPdf(buffer))     ← catches it too late

Fixed:
  buffer = downloadSlackFile(...)
  if (isPdf && !isValidPdf(buffer)) → retry or skip
  uploadFileToDrive(...)              ← only uploads valid files
```

### 1.4 Retry with backoff on validation failure

**File:** `src/lib/file-ingestion.ts`

When download validation fails, retry up to 2 times with 2s/5s delays. On the retry, re-fetch the `url_private_download` via Slack's `files.info` API to get a fresh URL.

```
- Retry loop: max 3 attempts (1 initial + 2 retries)
- On retry: call Slack files.info to get fresh url_private_download
- Delays: 2000ms, 5000ms
- On permanent failure: log full diagnostic payload
```

### 1.5 Diagnostic payload on permanent failure

When all retries fail, log a structured diagnostic object:

```json
{
  "event": "slack_file_download_permanent_failure",
  "fileName": "...",
  "expectedSize": 245000,
  "actualSize": 49152,
  "contentType": "text/html",
  "headBytes": "<!DOCTYPE html>...",
  "responseHeaders": { ... },
  "attempts": 3,
  "jobId": "..."
}
```

---

## Workstream 2: Structured Error Alerting

### 2.1 User-facing partial failure notification

**File:** `src/lib/file-ingestion.ts`, `src/slack/bolt-app.ts`

When some files fail but others succeed, post a warning to the Slack thread:

```
"⚠️ 1 of 3 files could not be processed (network error). Proceeding with available content."
```

Return a `failedFiles: string[]` array from `ingestEstimationFiles()` so bolt-app can compose the message.

### 2.2 Ops-level error channel

**File:** `src/lib/logger.ts` or new `src/lib/alerting.ts`

Add an `alertOps(message, data)` function that posts to a configurable `SLACK_OPS_CHANNEL_ID`. Use for:

- Job-level crashes (worker catch block)
- MCP server spawn failures
- Drive/Slack API auth failures (expired tokens)
- Queue stalling (no jobs processed in N minutes)

**Env:** Add optional `SLACK_OPS_CHANNEL_ID` to env.ts.

### 2.3 Severity tagging

Add `severity` field to structured logs:

- `warn`: partial failure, workflow continues (e.g., 1 file failed)
- `error`: job-level failure (e.g., orchestrator crash)
- `fatal`: system-level failure (e.g., Redis down, can't start)

---

## Workstream 3: Observability & Deployment Hardening

### 3.1 Consistent jobId propagation

**Files:** All files in `src/lib/`, `src/agents/orchestrator.ts`

Ensure every log line within a job includes `jobId`. Use `logger.withContext({ jobId })` pattern — create a child logger at job start and pass it through.

### 3.2 Timing metrics for key operations

Already partially done with `logger.startTimer()`. Ensure coverage for:

- [ ] Slack file download (per file)
- [ ] PDF validation
- [ ] Claude PDF extraction (already done)
- [ ] Drive folder creation
- [ ] Drive file upload (per file)
- [ ] MCP server spawn
- [ ] Full job duration (orchestrator)

### 3.3 Health endpoint enhancement

**File:** `src/index.ts`

Enhance `/health` to return:

```json
{
  "status": "ok",
  "redis": "connected",
  "queueDepth": 2,
  "lastJobCompletedAt": "2026-02-27T10:30:00Z",
  "uptimeSeconds": 3600
}
```

### 3.4 Memory monitoring

**File:** `src/queue/worker.ts`

After each job completes (success or failure), log `process.memoryUsage()`:

```json
{
  "event": "job_completed_memory",
  "jobId": "...",
  "rss_mb": 245,
  "heapUsed_mb": 180,
  "heapTotal_mb": 256
}
```

### 3.5 Test coverage for download validation

**File:** `src/lib/file-ingestion.test.ts`

New test cases:

- [ ] `downloadSlackFile` returns HTML → throws DownloadValidationError
- [ ] `downloadSlackFile` returns wrong Content-Type → throws
- [ ] `downloadSlackFile` returns mismatched size → triggers retry
- [ ] Retry succeeds on second attempt with fresh URL
- [ ] All retries fail → returns diagnostic payload
- [ ] `ingestEstimationFiles` skips broken file, continues with others
- [ ] `ingestEstimationFiles` returns failedFiles in result

### 3.6 Graceful shutdown verification

**File:** `src/queue/worker.ts`, `src/index.ts`

Verify that SIGTERM:
1. Stops accepting new jobs
2. Waits for in-progress jobs to complete (with timeout)
3. Closes MCP child processes
4. Closes Redis connection
5. Exits cleanly

---

## Implementation Order

<!-- TODO markers for plan execution -->

- [x] **Task 1:** Fix download validation — content-type check, size comparison, validate-before-upload
- [x] **Task 2:** Add retry logic with fresh URL fetch via files.info
- [x] **Task 3:** Add diagnostic payload logging on permanent failure
- [x] **Task 4:** Update SlackFile interface and bolt-app to pass file.size
- [x] **Task 5:** Add failedFiles tracking and user-facing partial failure messages
- [x] **Task 6:** Add ops alerting channel (SLACK_OPS_CHANNEL_ID + alertOps function)
- [x] **Task 7:** Add consistent jobId propagation via child loggers
- [x] **Task 8:** Add timing metrics to uncovered operations
- [x] **Task 9:** Enhance /health endpoint
- [x] **Task 10:** Add memory monitoring after job completion
- [x] **Task 11:** Write unit tests for download validation and retry logic
- [x] **Task 12:** Verify graceful shutdown behavior
- [x] **Task 13:** Full build verification (npx tsc --noEmit + node --test)

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/file-ingestion.ts` | Content-type validation, size check, validate-before-upload, retry logic, failedFiles tracking |
| `src/lib/file-ingestion.test.ts` | New test cases for validation and retry |
| `src/slack/bolt-app.ts` | Pass file.size, show partial failure warnings |
| `src/lib/env.ts` | Add optional SLACK_OPS_CHANNEL_ID |
| `src/lib/alerting.ts` | New: ops alerting to Slack channel |
| `src/lib/logger.ts` | Add severity field |
| `src/queue/worker.ts` | Memory monitoring, jobId child logger |
| `src/agents/orchestrator.ts` | jobId child logger propagation |
| `src/index.ts` | Enhanced /health endpoint |
