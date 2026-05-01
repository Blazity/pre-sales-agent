# Security Launch Hardening Design

## Goal

Close the Critical and High security findings before OSS launch while preserving the current Slack-driven estimation workflow.

This pass is intentionally launch-blocking scope only. Medium hardening items, including OAuth helper `state`, dependency advisory strategy, and full Vercel Sandbox runtime integration, remain follow-up work.

## Threat Model

The primary attacker is a user who can submit RFP text, Slack files, Google Drive links, or web content that the agent later reads. The attacker may attempt prompt injection to make the agent misuse tools, exfiltrate Google Drive data, fetch internal network resources, inflate costs, or leak client data into logs.

Prompt instructions are not considered a security boundary. Tool code must enforce the boundary deterministically.

## Approach

Use guarded capabilities rather than removing core features. Keep the agent useful for pre-sales work, but make each risky tool enforce policy in code.

The launch hardening has four implementation areas:

1. Google Drive access boundaries.
2. Safe web research fetches.
3. Workflow observability redaction.
4. File size and cost limits.

## Google Drive Access Boundary

The agent must not be able to read, export, search, or modify arbitrary Google Drive content accessible to the OAuth account.

### Requirements

- Keep generated estimation folders as the only write target.
- Validate file and document access before these tools operate:
  - `drive_get_file`
  - `drive_export_file`
  - `docs_get_document`
  - `docs_write_sections`
  - `docs_find_and_replace`
- A file is allowed only when it is inside one of `ALLOWED_FOLDER_IDS`.
- Folder-based writes already guarded by `assertAllowedFolder` must remain guarded:
  - `docs_create_document`
  - `docs_copy_template`
  - `sheets_create_estimation`
- Remove `mcp__google-workspace__drive_search_files` from orchestrator `allowedTools` for launch. Broad Drive search is not required for the current workflow and is too risky for prompt-injected data discovery.
- Keep knowledge-base search as the way to find historical proposal and estimation references.

### Access Check Design

The Google Workspace MCP server should add a reusable helper that:

1. Reads file metadata with `parents`.
2. Allows the file if any parent is in `ALLOWED_FOLDER_IDS`.
3. For nested files, walks parent folders upward until an allowed folder is found or the root is reached.
4. Denies access if no allowed ancestor is found.
5. Allows access when `ALLOWED_FOLDER_IDS` is empty only in test/local compatibility paths where the current behavior intentionally has no boundary.

The helper must avoid importing from `src/` to preserve MCP isolation.

## Web Research Boundary

`web_search` remains available because it calls Brave Search only. `fetch_web_page` becomes a public-web-only fetch tool.

### Requirements

- Allow only `http:` and `https:`.
- Reject URLs with embedded credentials.
- Reject localhost-style hostnames.
- Resolve the hostname before fetch and reject:
  - loopback addresses
  - private IPv4 ranges
  - link-local ranges, including `169.254.0.0/16`
  - IPv6 loopback
  - IPv6 link-local
  - IPv6 unique-local
- Follow redirects manually with a small max redirect count.
- Re-run the same URL and DNS safety checks for every redirect target.
- Use a request timeout.
- Enforce a maximum response size before converting to text.
- Accept only text-like content types needed for research, primarily HTML and plain text.
- Return a short policy error to the agent when blocked.
- Do not forward cookies, auth headers, or caller-controlled headers.

### Launch Defaults

- Max redirects: 5.
- Timeout: 10 seconds.
- Max response bytes: 2 MB.
- User-Agent: keep the existing fixed agent user agent.

## Observability Redaction

Vercel Workflow logs should show operational progress without storing raw client material.

### Requirements

- `agentText()` logs metadata only:
  - event type
  - text length
  - redacted marker
- `toolCall()` logs:
  - tool name
  - sanitized argument summary
  - no full user text, Slack replies, Google Doc text, proposal body, or section content
- `toolResult()` logs:
  - tool name
  - result length
  - coarse status/error classification
  - no result body
- Progress, step, cost, and token metadata remain available.
- Slack user-facing messages remain unchanged because they are intentionally posted to the originating thread.
- Add tests proving known sensitive strings do not appear in reporter output.

### Sanitization Examples

- `fetch_web_page`: log URL protocol and hostname only.
- Google tools: log tool name and masked or omitted file/document IDs.
- `docs_write_sections`: log section count and section types only.
- Slack tools: log channel/thread presence or masked values, not message text.
- Unknown tools: log argument keys and approximate serialized length, not values.

## File Size And Cost Limits

Oversized inputs must not cause memory pressure, slow workflows, or runaway AI/OCR cost.

### Requirements

- Add explicit file ingestion policy constants.
- Enforce size before download when metadata includes a size.
- Enforce size again after download using `buffer.length`.
- Skip oversized files with clear failure entries instead of crashing the workflow.
- Continue processing valid smaller files.
- Preserve generated Google Docs and Sheets behavior.

### Launch Defaults

- PDF max: 30 MB.
- DOCX max: 30 MB.
- Other copied file max: 50 MB.
- Drive folder file count cap: keep 100.
- Web fetch response cap: 2 MB, handled by the web research boundary.

## Testing And Verification

### Unit Tests

Add or update tests for:

- Drive guard allows files under an allowed folder.
- Drive guard blocks files outside allowed folders.
- `drive_search_files` is not exposed to the orchestrator.
- `fetch_web_page` blocks localhost, private, link-local, and metadata-style targets.
- `fetch_web_page` validates redirect targets.
- Workflow reporter redacts sensitive strings in agent text, tool calls, and tool results.
- Slack oversized PDF/DOCX files are skipped before expensive processing.
- Drive folder oversized PDF/DOCX files are skipped.
- Post-download size guards reject oversized buffers.
- Workflows continue when at least one valid file remains.

### Required Gates

Run:

```bash
npm run typecheck
npm test
npm run build
npm run scan:secrets
npm run check:mcp-isolation
npm run audit:high
```

`npm audit --audit-level=moderate` is expected to continue reporting the existing transitive `workflow`/`devalue` advisory until the follow-up dependency hardening pass.

### Later Smoke Test

After implementation and deployment:

1. Deploy to Vercel.
2. Run `npm run doctor:first-launch`.
3. Send one Slack `!estimate` with short text.
4. Send one Slack `!estimate` with a small PDF or DOCX.
5. Confirm Slack thread progress.
6. Confirm Vercel Workflow run completes.
7. Confirm Google Doc and Google Sheet outputs are created.
8. Confirm workflow logs do not contain raw RFP text or document body.

## Out Of Scope

- Fixing the moderate `workflow`/`devalue` audit advisory.
- Adding OAuth `state` to `scripts/get-google-token.ts`.
- Reworking Google OAuth scopes.
- Replacing the current OAuth account model with service accounts.
- Full Vercel Sandbox runtime execution for the agent.
- Building a web admin surface for security policy.
