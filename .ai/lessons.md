# Lessons Learned

Review this file at session start. Add new entries when you discover recurring issues.

Format: Context → Problem → Rule → Recovery → Applies to.

---

### MCP servers must never import from `src/`

**Context:** MCP servers run as standalone stdio child processes spawned by the orchestrator.
**Problem:** Importing shared modules from `src/` breaks the stdio transport and causes silent failures.
**Rule:** Every MCP server loads its own `dotenv/config` and duplicates any helpers it needs. No cross-imports.
**Recovery:** If you see import errors in MCP server logs, check for cross-imports. Move the needed code inline into the MCP server file.
**Applies to:** All files in `src/mcp-servers/`.

---

### Pinecone index is locked to voyage-3

**Context:** The knowledge base uses Voyage AI `voyage-3` embeddings (1024-dim, cosine metric).
**Problem:** Changing the embedding model produces incompatible vectors. Old vectors become useless.
**Rule:** If you change the embedding model, you must recreate the Pinecone index and re-seed all data.
**Recovery:** If vectors return garbage, verify the embedding model. If changed, run `npm run seed` to re-index everything.
**Applies to:** `src/mcp-servers/knowledge-base.ts`, `scripts/seed-knowledge-base.ts`.

---

### Google Workspace MCP runs as a local standalone server

**Context:** The Google Workspace MCP server is a local standalone stdio server compiled to `dist/mcp-servers/google-workspace.js`.
**Problem:** Treating it as an external `npx`-fetched MCP package leads to wrong deployment and recovery guidance.
**Rule:** Keep Google Workspace MCP behavior in the local server and build the project before running workflows that spawn MCP servers.
**Recovery:** If Google Workspace MCP spawn fails, verify `npm run build` produced `dist/mcp-servers/google-workspace.js`, required Google env vars are present, and the Vercel runtime can execute the compiled file.
**Applies to:** `src/mcp-servers/google-workspace.ts`, `src/agents/orchestrator.ts`, `package.json`.

---

### GOOGLE_REFRESH_TOKEN leading whitespace

**Context:** The `.env` file's `GOOGLE_REFRESH_TOKEN` value sometimes has a leading space after `=`.
**Problem:** Google OAuth rejects tokens with leading/trailing whitespace, returning a 400 error.
**Rule:** Trim the refresh token value. If auth fails, check for whitespace first.
**Recovery:** Run `echo -n "$GOOGLE_REFRESH_TOKEN" | cat -A` to check for whitespace. Trim in `.env` and restart.
**Applies to:** All Google API calls.

---

### wait_for_reply blocks agent turns

**Context:** The `wait_for_reply` tool polls Slack for human responses for up to 15 minutes (reduced from 30 in SPEC-019). The clarification step can run up to 5 rounds.
**Problem:** Long clarification waits keep an agent run and its MCP child processes active while waiting for a human.
**Rule:** Keep the timeout explicit in `src/mcp-servers/slack-interaction.ts`, `.ai/architecture.md`, and `.ai/mcp-tools.md`; run `npm run check:ai-docs` after changing it.
**Recovery:** If workflow runs pile up during clarification waits, inspect Vercel Workflow run timelines and Slack thread activity before changing the timeout or skip-step behavior.
**Applies to:** `src/mcp-servers/slack-interaction.ts`, `src/agents/orchestrator.ts`.

---

### Google Doc template placeholder tokens

**Context:** The offer template uses `{{PLACEHOLDER}}` tokens that the orchestrator fills.
**Problem:** Adding or renaming tokens requires updating both the template document AND the orchestrator prompt.
**Rule:** Keep the token list in CLAUDE.md and update both sides when changing tokens.
**Recovery:** Diff the template document's `{{TOKENS}}` against the orchestrator prompt's section list. They must match exactly.
**Applies to:** `src/mcp-servers/google-workspace.ts`, `src/agents/orchestrator.ts`.

---

### Always log MCP tool results, not just tool calls

**Context:** The orchestrator event loop only logged `tool_use` blocks from assistant messages.
**Problem:** MCP tool errors (returned in `tool_result` user messages) were invisible in job logs. The TSAC job failed 7 times with empty layout errors but logs showed no errors.
**Rule:** Log both `tool_use` and `tool_result` messages. Tool results reveal MCP errors that are otherwise silent.
**Recovery:** Check job logs for `tool_result` entries. If missing, the orchestrator isn't logging user messages.
**Applies to:** `src/agents/orchestrator.ts`.

---

### Vercel Workflow is the durable run boundary

**Context:** Long-running estimations execute through Vercel Workflow.
**Problem:** Treating runs as local queue jobs leads to the wrong debugging path and misses Workflow run timelines.
**Rule:** Investigate stuck or failed estimations through Vercel Workflow and Function logs first.
**Recovery:** If a run does not start, verify `/api/slack/events`, required Vercel env vars, and workflow deployment. If a run starts but stalls, inspect the Workflow timeline for the failing step and its structured logs.
**Applies to:** `api/slack/events.ts`, `workflows/estimation.ts`, `src/workflows/launcher.ts`.

---

### Estimation calibration: rate card, AI factor, page budget

**Context:** First real estimation (Assessio) priced 3× too high, produced 19-page document, recommended outdated tech.
**Problem:** Without guardrails, the agent over-staffs teams, inflates hours, writes verbose documents, and guesses vendor pricing.
**Rule:** The system prompt must enforce: (1) explicit rate card in the configured currency, (2) team sizing tiers by project cost, (3) feature-level budget breakdown (not role-level), (4) conservative AI productivity adjustment on development work, (5) page budgets, (6) web-search verification of tech versions, (7) never guess third-party pricing.
**Recovery:** If an offer is overpriced or too long, check the ESTIMATION RULES block in the system prompt. Verify the agent applied the AI factor and respected the page budget. Re-run with tighter constraints if needed.
**Applies to:** `src/agents/orchestrator.ts` (system prompt).

---

### Do the thing, don't suggest the thing

**Context:** User explicitly asks you to perform an action you have the tools/access to do.
**Problem:** Responding with instructions for the user instead of just doing it wastes their time.
**Rule:** If the user asks you to do something and you have the resources to do it (CLI access, env vars, deploy tools), do it. Never tell the user to do it themselves.
**Recovery:** N/A — just do the work.
**Applies to:** All tasks.

---

### KB folders are read-only — agent never writes to them

**Context:** The knowledge base is sourced from two manually-curated Google Drive folders (Sheets for estimations, Docs for proposals).
**Problem:** If the agent writes to these folders or auto-stores estimations in Pinecone, it pollutes the curated knowledge base with unreviewed data.
**Rule:** The agent NEVER writes to `GDRIVE_ESTIMATIONS_FOLDER_ID` or `GDRIVE_PROPOSALS_FOLDER_ID`. The `store_estimation` tool was removed. New entries are added manually by the team, then indexed via `npm run seed`.
**Recovery:** If bad data appears in Pinecone, run `npm run seed` to wipe and rebuild from the curated Drive folders.
**Applies to:** `src/mcp-servers/knowledge-base.ts`, `src/agents/orchestrator.ts`, `scripts/seed-knowledge-base.ts`.

---

### Drive folder ingestion safety limits and access requirements

**Context:** `listFolderRecursive` crawls shared Drive folders to copy files into the estimation Input folder.
**Problem:** Large folders can cause timeouts or quota exhaustion. Shared Drive folders require explicit access for the bot's Google service account.
**Rule:** Folder crawling is capped at 5 levels deep and 100 files max. The source folder must be shared with the bot's service account (or "Anyone with the link"). PDF OCR via `uploadAndConvertToDriveDoc` works for text-based PDFs but may produce poor results for scanned/image-heavy PDFs. `copyDriveFile` requires at least Viewer access on the source file.
**Recovery:** If folder ingestion fails with 403, share the folder with the bot account. If PDFs produce garbage text, check whether the PDF is image-based — the OCR conversion has limited quality for scanned documents.
**Applies to:** `src/lib/google-drive.ts`, `src/lib/file-ingestion.ts`, `src/slack/bolt-app.ts`.

---

### Uploaded .xlsx files in Drive fail Sheets API v4

**Context:** The estimations folder may contain uploaded Excel files alongside native Google Sheets.
**Problem:** Sheets API v4 `includeGridData` returns 400 FAILED_PRECONDITION for non-native spreadsheets (.xlsx uploaded to Drive without conversion).
**Rule:** The seeding script wraps `fetchSheetGridData` in try/catch and skips files that fail. Convert uploaded .xlsx to native Google Sheets format for indexing.
**Recovery:** Open the file in Google Sheets and save as Google Sheets format (File → Save as Google Sheets). Re-run `npm run seed`.
**Applies to:** `scripts/seed-knowledge-base.ts`.

---

### Codex reviews every PR before merge

**Context:** Codex Cloud is configured as an automated PR reviewer via GitHub Actions + AGENTS.md.
**Problem:** Merging without Codex review bypasses the quality gate.
**Rule:** Every PR to `main` must have Codex approval. The GitHub Action triggers `@codex review` automatically. AGENTS.md points Codex to `.ai/skills/code-review/` - do NOT duplicate the checklist.
**Recovery:** If Codex doesn't review, check that the GitHub App is installed and "Code review" is enabled in Codex settings. Manually comment `@codex review` on the PR.
**Applies to:** All pull requests to `main`.

---

### Pre-PR self-review: error propagation, prompt safety, and accounting

**Context:** SPEC-024 PR took 3 Codex review rounds to pass because of recurring patterns that should have been caught before pushing.
**Problem:** Three categories of bugs kept appearing:
1. **Swallowed errors** — catch blocks that log+ignore instead of re-throwing, hiding failures from upstream handlers (e.g. 403 errors never reaching the Slack permission handler).
2. **Prompt injection** — user-controlled data (filenames, paths) interpolated into the orchestrator prompt without boundary tags, and boundary tags not declared in the system prompt's untrusted-input list.
3. **Incomplete accounting** — counts/totals that don't cover all code paths (e.g. failed-file count excluding standalone Drive link failures).
**Rule:** Before pushing a PR, self-review every change against this checklist:
- Every `catch` block: does the error need to propagate? If an upstream handler (Slack, queue) needs to react, re-throw.
- Every string interpolation into the orchestrator prompt: is it wrapped in boundary tags? Is that tag listed in the system prompt's `SECURITY — INPUT BOUNDARY RULES`?
- Every counter/total: does it account for ALL sources that contribute to it? Trace every `.push()` and `+=` to verify the denominator matches.
- Every regex that strips URLs: does it consume query strings (`?usp=sharing`) and fragments (`#section`)?
**Recovery:** If Codex flags these patterns, they are almost always valid. Fix immediately.
**Applies to:** All PRs, especially those touching `orchestrator.ts`, error handling, or user-facing messages.

---

### AGENTS.md must include current repo-specific facts

**Context:** Agent reviewers can produce false positives when branch names, package scripts, runtime architecture, or deployment targets drift from reality.
**Problem:** Stale repo facts waste review time and can make automated guidance less trustworthy.
**Rule:** Keep the "Repository Facts" section in `AGENTS.md` current and run `npm run check:ai-docs` after changing agent-facing docs.
**Recovery:** When an agent produces a false positive based on an incorrect repo fact, correct `AGENTS.md`, related `.ai/` docs, and the drift checker if needed.
**Applies to:** `AGENTS.md`, `CLAUDE.md`, `.ai/`.

---

### Prompt refactoring: update ALL sections that reference changed concepts

**Context:** SPEC-025 replaced the budget table with Investment Summary and renamed VBP to Performance Partnership.
**Problem:** The main Step 4 prompt was updated, but SECTION DEPTH and STYLING instructions still referenced "Budget table", "Value-Based Partnership", and "Why Value-Based Pricing" — stale references that would confuse the agent.
**Rule:** When renaming a concept in the prompt (e.g., "Budget table" → "Investment Summary"), search for ALL occurrences across the entire prompt string — not just the primary section. Common places to miss: SECTION DEPTH guidelines, STYLING instructions, ESTIMATION RULES, review checklist.
**Recovery:** Run a text search for the old term across the full orchestrator prompt. Update every occurrence.
**Applies to:** `src/agents/orchestrator.ts` (system prompt).

---

### Template merged cells survive values.clear

**Context:** The estimation Sheets template has merged cell ranges (column A for area names, column C for effort, summary rows).
**Problem:** `values.clear` clears content but does NOT remove merge structure. Writing to non-anchor cells of a merge is silently dropped by the Sheets API, causing empty effort cells and missing summary rows.
**Rule:** Always unmerge all cells after copying a Sheets template before writing data. Use `batchUpdate` with `unmergeCells` requests.
**Recovery:** If sheet data is missing after writes, check for merged cells in the template. Add an unmerge step between copy and data write.
**Applies to:** `src/mcp-servers/google-workspace.ts` (sheets_create_estimation tool).

---

### Large RFP text must not be embedded inline in the agent prompt

**Context:** CRC estimation extracted ~40K+ tokens from PDF and embedded them directly in the agent prompt.
**Problem:** The large initial prompt + 80 turns of tool results exhausted the 200K context window. SDK compaction directed the agent to read its JSONL transcript, but individual lines exceeded the 25K token Read limit. The agent got stuck in a retry loop.
**Rule:** When `inputFolderId` is available, always use the Drive folder path — never embed `rfpText` inline. The agent reads the RFP via `drive_export_file` (already truncated to 20K chars). Only embed text for slash commands (always short).
**Recovery:** If a job fails with "File content exceeds maximum allowed tokens" on a `.jsonl` file, the agent is trying to read its own transcript. Reduce context pressure: check that rfpText is not embedded inline, and verify `persistSession: false` is set.
**Applies to:** `src/agents/orchestrator.ts`.

---

### All ingestion paths must produce symmetric Drive structures

**Context:** SPEC-035 changed the orchestrator to prioritize `inputFolderId` over `rfpText`. The Drive folder path (`ingestDriveFolder`) already created text-version Google Docs via `uploadAndConvertToDriveDoc` and built a `FileManifest`. The Slack upload path did not.
**Problem:** Slack-uploaded PDFs/DOCX were unreadable — `drive_export_file` returned raw binary (`%PDF-1.4` gibberish) because no text-version Doc existed.
**Rule:** When changing prompt priority or RFP source selection, verify ALL ingestion paths produce the same Drive structure (text-version Docs + manifest). Slack uploads and Drive folder ingestion must be symmetric.
**Recovery:** If the agent can't read uploaded files, check whether the ingestion path created a `convertedDocId` entry in the manifest. If not, the OCR conversion step is missing.
**Applies to:** `src/lib/file-ingestion.ts`.
