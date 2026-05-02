# Security Launch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Critical and High launch security issues while preserving the Slack-driven estimation workflow.

**Architecture:** Add deterministic policy checks inside the standalone MCP servers and ingestion/reporting helpers. Keep provider integrations intact, but constrain what the agent can access, fetch, process, and log. Prefer pure exported helpers for security policies so tests do not need real Google, Slack, Anthropic, or network calls.

**Tech Stack:** Node.js 20+, TypeScript ESM, Node test runner, MCP SDK, Google Drive REST API, Slack Bolt/Web API, Anthropic SDK, Vercel Workflow logs.

---

### Task 1: Redact Workflow Observability

**Files:**
- Modify: `src/lib/workflow-reporter.ts`
- Modify: `src/lib/workflow-reporter.test.ts`

- [ ] **Step 1: Add failing redaction tests**

Append these tests to `src/lib/workflow-reporter.test.ts`:

```ts
  it("redacts raw agent text from workflow logs", async () => {
    const events: Array<{ message?: string; data?: Record<string, unknown> }> = [];
    const reporter = createWorkflowReporter("est_123", {
      info: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      warn: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      error: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      debug: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
    });

    await reporter.agentText("SECRET_RFP_TEXT: client wants acquisition strategy");

    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes("SECRET_RFP_TEXT"));
    assert.ok(serialized.includes("agent_text_redacted"));
    assert.ok(serialized.includes("\"textLength\""));
  });

  it("redacts sensitive tool arguments and preserves safe summaries", async () => {
    const events: Array<{ message?: string; data?: Record<string, unknown> }> = [];
    const reporter = createWorkflowReporter("est_123", {
      info: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      warn: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      error: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      debug: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
    });

    await reporter.toolCall("mcp__web-research__fetch_web_page", {
      url: "https://example.com/private?token=SECRET_TOKEN",
      extract_prompt: "extract SECRET_CLIENT_DETAIL",
    });
    await reporter.toolCall("mcp__google-workspace__docs_write_sections", {
      document_id: "doc_SECRET_ID",
      sections: [
        { type: "paragraph", text: "SECRET_PROPOSAL_BODY" },
        { type: "table", rows: [["SECRET_TABLE_VALUE"]] },
      ],
    });

    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes("SECRET_TOKEN"));
    assert.ok(!serialized.includes("SECRET_CLIENT_DETAIL"));
    assert.ok(!serialized.includes("SECRET_PROPOSAL_BODY"));
    assert.ok(!serialized.includes("SECRET_TABLE_VALUE"));
    assert.ok(serialized.includes("example.com"));
    assert.ok(serialized.includes("\"sectionCount\":2"));
  });

  it("redacts raw tool results from workflow logs", async () => {
    const events: Array<{ message?: string; data?: Record<string, unknown> }> = [];
    const reporter = createWorkflowReporter("est_123", {
      info: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      warn: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      error: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
      debug: (_message, data) => { events.push(data as { message?: string; data?: Record<string, unknown> }); },
    });

    await reporter.toolResult("mcp__google-workspace__drive_export_file", "SECRET_DOC_TEXT with confidential budget");
    await reporter.toolResult("mcp__google-workspace__drive_export_file", "Error: Drive API error: forbidden");

    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes("SECRET_DOC_TEXT"));
    assert.ok(serialized.includes("\"resultLength\""));
    assert.ok(serialized.includes("\"status\":\"ok\""));
    assert.ok(serialized.includes("\"status\":\"error\""));
  });
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- src/lib/workflow-reporter.test.ts
```

Expected: FAIL because `agentText`, `toolCall`, and `toolResult` currently log raw excerpts.

- [ ] **Step 3: Implement redaction helpers**

In `src/lib/workflow-reporter.ts`, replace `serializeToolArgs` with these helpers:

```ts
function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function shortToolName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "");
}

function summarizeUrl(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return { url: "invalid" };
  try {
    const url = new URL(value);
    return { protocol: url.protocol.replace(":", ""), hostname: url.hostname };
  } catch {
    return { url: "invalid" };
  }
}

function summarizeToolArgs(name: string, args: unknown): Record<string, unknown> {
  const tool = shortToolName(name);
  const record = toRecord(args);
  if (!record) return { argType: typeof args };

  if (tool === "fetch_web_page") {
    return {
      ...summarizeUrl(record.url),
      hasExtractPrompt: typeof record.extract_prompt === "string" && record.extract_prompt.length > 0,
    };
  }

  if (tool === "docs_write_sections") {
    const sections = Array.isArray(record.sections) ? record.sections : [];
    const sectionTypes = sections
      .map((section) => toRecord(section)?.type)
      .filter((type): type is string => typeof type === "string");
    return {
      hasDocumentId: typeof record.document_id === "string" && record.document_id.length > 0,
      sectionCount: sections.length,
      sectionTypes,
    };
  }

  if (tool === "post_message") {
    return {
      hasChannel: typeof record.channel === "string" && record.channel.length > 0,
      hasThread: typeof record.thread_ts === "string" && record.thread_ts.length > 0,
      hasBlocks: typeof record.blocks === "string" && record.blocks.length > 0,
      textLength: typeof record.text === "string" ? record.text.length : 0,
    };
  }

  const keys = Object.keys(record).sort();
  return { argKeys: keys, argCount: keys.length };
}

function classifyToolResult(result: string): "ok" | "error" | "timeout" {
  const lower = result.slice(0, 120).toLowerCase();
  if (lower.includes("timeout")) return "timeout";
  if (lower.startsWith("error") || lower.includes(" error:") || lower.includes("failed") || lower.includes("forbidden")) {
    return "error";
  }
  return "ok";
}
```

- [ ] **Step 4: Change reporter methods to use summaries**

In `createWorkflowReporter`, replace the `agentText`, `toolCall`, and `toolResult` methods with:

```ts
    agentText(text) {
      return log({
        level: "info",
        type: "agent_text",
        message: "agent_text_redacted",
        data: { textLength: text.length },
      });
    },

    toolCall(name, args) {
      const summary = summarizeToolArgs(name, args);
      return log({
        level: "info",
        type: "tool_call",
        message: `${name}(args_redacted)`,
        data: { tool: shortToolName(name), summary },
      });
    },

    toolResult(name, result) {
      return log({
        level: "info",
        type: "tool_result",
        message: `${name} -> result_redacted`,
        data: {
          tool: shortToolName(name),
          resultLength: result.length,
          status: classifyToolResult(result),
        },
      });
    },
```

- [ ] **Step 5: Run reporter tests**

Run:

```bash
npm test -- src/lib/workflow-reporter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit reporter redaction**

```bash
git add src/lib/workflow-reporter.ts src/lib/workflow-reporter.test.ts
git commit -m "fix: redact workflow observability"
```

### Task 2: Harden Web Page Fetching

**Files:**
- Modify: `src/mcp-servers/web-research.ts`
- Modify: `src/mcp-servers/web-research.test.ts`

- [ ] **Step 1: Add failing URL policy tests**

Change the import in `src/mcp-servers/web-research.test.ts` to include new helpers:

```ts
const {
  htmlToText,
  parseBraveResults,
  validatePublicWebUrl,
  isPublicIpAddress,
  readLimitedText,
} = await import("./web-research.js");
```

Append these tests:

```ts
describe("public web URL policy", () => {
  const resolver = async (hostname: string) => {
    const table: Record<string, string[]> = {
      "example.com": ["93.184.216.34"],
      "localhost": ["127.0.0.1"],
      "private.test": ["10.0.0.5"],
      "metadata.test": ["169.254.169.254"],
      "ipv6-local.test": ["::1"],
    };
    return table[hostname] ?? ["93.184.216.34"];
  };

  it("allows public http and https URLs", async () => {
    await assert.doesNotReject(() => validatePublicWebUrl("https://example.com/page", resolver));
    await assert.doesNotReject(() => validatePublicWebUrl("http://example.com/page", resolver));
  });

  it("rejects non-http protocols and embedded credentials", async () => {
    await assert.rejects(() => validatePublicWebUrl("file:///etc/passwd", resolver), /Only http and https/);
    await assert.rejects(() => validatePublicWebUrl("https://user:pass@example.com", resolver), /credentials/);
  });

  it("rejects localhost, private, link-local, and metadata destinations", async () => {
    await assert.rejects(() => validatePublicWebUrl("http://localhost/admin", resolver), /not allowed/);
    await assert.rejects(() => validatePublicWebUrl("http://private.test/admin", resolver), /not public/);
    await assert.rejects(() => validatePublicWebUrl("http://metadata.test/latest/meta-data", resolver), /not public/);
    await assert.rejects(() => validatePublicWebUrl("http://ipv6-local.test/", resolver), /not public/);
  });

  it("classifies public and non-public IP addresses", () => {
    assert.equal(isPublicIpAddress("93.184.216.34"), true);
    assert.equal(isPublicIpAddress("10.0.0.1"), false);
    assert.equal(isPublicIpAddress("172.16.0.1"), false);
    assert.equal(isPublicIpAddress("192.168.0.1"), false);
    assert.equal(isPublicIpAddress("169.254.169.254"), false);
    assert.equal(isPublicIpAddress("127.0.0.1"), false);
    assert.equal(isPublicIpAddress("::1"), false);
    assert.equal(isPublicIpAddress("fd00::1"), false);
    assert.equal(isPublicIpAddress("fe80::1"), false);
  });
});

describe("readLimitedText()", () => {
  it("rejects responses over the byte limit", async () => {
    const response = new Response("x".repeat(12), {
      headers: { "content-type": "text/plain" },
    });

    await assert.rejects(() => readLimitedText(response, 10), /Response exceeded 10 bytes/);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- src/mcp-servers/web-research.test.ts
```

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Add DNS, IP, URL, and fetch constants**

At the top of `src/mcp-servers/web-research.ts`, add:

```ts
import { lookup } from "node:dns/promises";
import net from "node:net";
```

After `MAX_TEXT_LENGTH`, add:

```ts
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TEXT_CONTENT_TYPES = ["text/html", "text/plain", "application/xhtml+xml"];
```

- [ ] **Step 4: Implement public-web policy helpers**

Add these exports above `const server = new McpServer(...)`:

```ts
type HostResolver = (hostname: string) => Promise<string[]>;

async function resolveHostname(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isIpv4InRange(ip: string, start: string, end: string): boolean {
  const value = ipv4ToNumber(ip);
  return value >= ipv4ToNumber(start) && value <= ipv4ToNumber(end);
}

export function isPublicIpAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    return ![
      ["0.0.0.0", "0.255.255.255"],
      ["10.0.0.0", "10.255.255.255"],
      ["100.64.0.0", "100.127.255.255"],
      ["127.0.0.0", "127.255.255.255"],
      ["169.254.0.0", "169.254.255.255"],
      ["172.16.0.0", "172.31.255.255"],
      ["192.0.0.0", "192.0.0.255"],
      ["192.168.0.0", "192.168.255.255"],
      ["198.18.0.0", "198.19.255.255"],
      ["224.0.0.0", "255.255.255.255"],
    ].some(([start, end]) => isIpv4InRange(ip, start, end));
  }

  if (family === 6) {
    const normalized = ip.toLowerCase();
    return !(
      normalized === "::1" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }

  return false;
}

export async function validatePublicWebUrl(rawUrl: string, resolver: HostResolver = resolveHostname): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("This hostname is not allowed.");
  }

  const addresses = net.isIP(hostname) ? [hostname] : await resolver(hostname);
  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
    throw new Error("URL resolved to an address that is not public.");
  }
  return url;
}

function assertTextContentType(response: Response): void {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !TEXT_CONTENT_TYPES.some((allowed) => contentType.includes(allowed))) {
    throw new Error(`Unsupported content-type: ${contentType}`);
  }
}

export async function readLimitedText(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(`Response exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}
```

- [ ] **Step 5: Implement safe fetch with redirect checks**

Add this helper:

```ts
async function fetchPublicWebPage(rawUrl: string): Promise<Response> {
  let current = await validatePublicWebUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(current, {
        headers: { "User-Agent": "PreSalesAgent/0.1" },
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return response;
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error(`Too many redirects; max is ${MAX_REDIRECTS}.`);
        }
        current = await validatePublicWebUrl(new URL(location, current).toString());
        continue;
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Too many redirects; max is ${MAX_REDIRECTS}.`);
}
```

- [ ] **Step 6: Use safe fetch in `fetch_web_page`**

Replace the existing `fetch(url, { headers: ... })` and `res.text()` path with:

```ts
      const res = await fetchPublicWebPage(url);

      if (!res.ok) {
        return {
          content: [{
            type: "text" as const,
            text: `Fetch failed: ${res.status} ${res.statusText}`,
          }],
        };
      }

      assertTextContentType(res);
      const html = await readLimitedText(res);
      const pageText = htmlToText(html);
```

Keep the existing extraction and truncation logic after `pageText`.

- [ ] **Step 7: Run web research tests**

Run:

```bash
npm test -- src/mcp-servers/web-research.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit web fetch hardening**

```bash
git add src/mcp-servers/web-research.ts src/mcp-servers/web-research.test.ts
git commit -m "fix: harden web research fetches"
```

### Task 3: Guard Google Drive Reads And Mutations

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts`
- Modify: `src/mcp-servers/google-workspace.test.ts`
- Modify: `src/agents/orchestrator.ts`
- Modify: `src/agents/orchestrator.test.ts`

- [ ] **Step 1: Add failing Drive access guard tests**

Update the dynamic import in `src/mcp-servers/google-workspace.test.ts` to include:

```ts
  fileHasAllowedAncestor,
```

Append these tests:

```ts
describe("fileHasAllowedAncestor()", () => {
  it("allows a file with a direct allowed parent", async () => {
    const fetchMock = async (url: string) => {
      assert.ok(url.includes("/drive/v3/files/file_1"));
      return new Response(JSON.stringify({ id: "file_1", parents: ["folder_allowed"] }), { status: 200 });
    };

    const allowed = await fileHasAllowedAncestor("file_1", ["folder_allowed"], "token", fetchMock as typeof fetch);
    assert.equal(allowed, true);
  });

  it("allows a file with an allowed ancestor folder", async () => {
    const parents: Record<string, string[]> = {
      file_1: ["folder_child"],
      folder_child: ["folder_allowed"],
    };
    const fetchMock = async (url: string) => {
      const id = url.match(/files\/([^?]+)/)?.[1] ?? "";
      return new Response(JSON.stringify({ id, parents: parents[id] ?? [] }), { status: 200 });
    };

    const allowed = await fileHasAllowedAncestor("file_1", ["folder_allowed"], "token", fetchMock as typeof fetch);
    assert.equal(allowed, true);
  });

  it("blocks a file outside allowed folders", async () => {
    const parents: Record<string, string[]> = {
      file_1: ["folder_other"],
      folder_other: [],
    };
    const fetchMock = async (url: string) => {
      const id = url.match(/files\/([^?]+)/)?.[1] ?? "";
      return new Response(JSON.stringify({ id, parents: parents[id] ?? [] }), { status: 200 });
    };

    const allowed = await fileHasAllowedAncestor("file_1", ["folder_allowed"], "token", fetchMock as typeof fetch);
    assert.equal(allowed, false);
  });
});
```

- [ ] **Step 2: Add failing orchestrator allowed-tools test**

Add imports to `src/agents/orchestrator.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
```

Append this test:

```ts
describe("orchestrator tool allowlist", () => {
  it("does not expose broad Drive search to the agent", () => {
    const currentFile = fileURLToPath(import.meta.url);
    const source = fs.readFileSync(path.join(path.dirname(currentFile), "orchestrator.ts"), "utf-8");
    assert.ok(!source.includes("\"mcp__google-workspace__drive_search_files\""));
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- src/mcp-servers/google-workspace.test.ts src/agents/orchestrator.test.ts
```

Expected: FAIL because `fileHasAllowedAncestor` does not exist and `drive_search_files` is still allowed.

- [ ] **Step 4: Implement Drive ancestor guard helpers**

In `src/mcp-servers/google-workspace.ts`, add these helpers below `assertAllowedFolder`:

```ts
interface DriveParentsResponse {
  id: string;
  parents?: string[];
}

async function fetchFileParents(fileId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,parents&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive metadata error: ${res.status} ${text}`);
  }
  const data = await res.json() as DriveParentsResponse;
  return data.parents ?? [];
}

export async function fileHasAllowedAncestor(
  fileId: string,
  allowedFolderIds: string[],
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (allowedFolderIds.length === 0) return true;

  const queue = [fileId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const parents = await fetchFileParents(current, token, fetchImpl);
    if (parents.some((parent) => allowedFolderIds.includes(parent))) return true;
    queue.push(...parents.filter((parent) => !visited.has(parent)));
  }

  return false;
}

async function assertAllowedFile(fileId: string, token: string): Promise<void> {
  const allowed = await fileHasAllowedAncestor(fileId, ALLOWED_FOLDER_IDS, token);
  if (!allowed) {
    throw new Error(`File ${fileId} is not inside an allowed folder.`);
  }
}
```

- [ ] **Step 5: Apply file guard to read/mutate tools**

In each listed tool, call `const token = await getAccessToken();` and then `await assertAllowedFile(<id>, token);` before the Google API operation:

```ts
await assertAllowedFile(file_id, token);
```

Apply that exact pattern in:

- `drive_get_file` before metadata fetch.
- `drive_export_file` before metadata fetch.
- `docs_get_document` before export fetch.
- `docs_write_sections` before chart creation and `executeSections`.
- `docs_find_and_replace` before `documents:batchUpdate`.

Use `document_id` for docs tools:

```ts
await assertAllowedFile(document_id, token);
```

- [ ] **Step 6: Remove Drive search from agent allowlist**

In `src/agents/orchestrator.ts`, remove:

```ts
  drive_search_files: 1,
```

and remove:

```ts
          "mcp__google-workspace__drive_search_files",
```

Keep the MCP server tool registered. It is not exposed to the agent.

- [ ] **Step 7: Run Drive and orchestrator tests**

Run:

```bash
npm test -- src/mcp-servers/google-workspace.test.ts src/agents/orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Drive guard**

```bash
git add src/mcp-servers/google-workspace.ts src/mcp-servers/google-workspace.test.ts src/agents/orchestrator.ts src/agents/orchestrator.test.ts
git commit -m "fix: guard google drive tool access"
```

### Task 4: Add File Size And Cost Limits

**Files:**
- Modify: `src/lib/file-ingestion.ts`
- Modify: `src/lib/file-ingestion.test.ts`

- [ ] **Step 1: Add failing size policy tests**

Update the dynamic import in `src/lib/file-ingestion.test.ts` to include:

```ts
  FILE_SIZE_LIMITS,
  getFileSizeLimit,
  isFileWithinSizeLimit,
  assertBufferWithinSizeLimit,
```

Append these tests:

```ts
describe("file size policy", () => {
  it("uses a 30 MB limit for PDFs and DOCX files", () => {
    assert.equal(getFileSizeLimit("application/pdf"), 30 * 1024 * 1024);
    assert.equal(
      getFileSizeLimit("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      30 * 1024 * 1024,
    );
  });

  it("uses a 50 MB limit for other copied files", () => {
    assert.equal(getFileSizeLimit("image/png"), FILE_SIZE_LIMITS.otherBytes);
    assert.equal(FILE_SIZE_LIMITS.otherBytes, 50 * 1024 * 1024);
  });

  it("checks metadata sizes before download", () => {
    assert.equal(isFileWithinSizeLimit("application/pdf", 30 * 1024 * 1024), true);
    assert.equal(isFileWithinSizeLimit("application/pdf", 30 * 1024 * 1024 + 1), false);
  });

  it("checks downloaded buffer sizes after download", () => {
    const oversized = Buffer.alloc(30 * 1024 * 1024 + 1);
    assert.throws(
      () => assertBufferWithinSizeLimit(oversized, "application/pdf", "large.pdf"),
      /large\.pdf exceeds the 30 MB limit/,
    );
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- src/lib/file-ingestion.test.ts
```

Expected: FAIL because size policy helpers do not exist.

- [ ] **Step 3: Implement size policy helpers**

In `src/lib/file-ingestion.ts`, add below retry constants:

```ts
export const FILE_SIZE_LIMITS = {
  pdfBytes: 30 * 1024 * 1024,
  docxBytes: 30 * 1024 * 1024,
  otherBytes: 50 * 1024 * 1024,
} as const;

function formatMb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

export function getFileSizeLimit(mimeType: string): number {
  if (mimeType === "application/pdf") return FILE_SIZE_LIMITS.pdfBytes;
  if (classifySlackFile(mimeType) === "docx") return FILE_SIZE_LIMITS.docxBytes;
  return FILE_SIZE_LIMITS.otherBytes;
}

export function isFileWithinSizeLimit(mimeType: string, sizeBytes?: number): boolean {
  if (sizeBytes === undefined) return true;
  return sizeBytes <= getFileSizeLimit(mimeType);
}

export function assertBufferWithinSizeLimit(buffer: Buffer, mimeType: string, fileName: string): void {
  const limit = getFileSizeLimit(mimeType);
  if (buffer.length > limit) {
    throw new Error(`${fileName} exceeds the ${formatMb(limit)} MB limit.`);
  }
}
```

- [ ] **Step 4: Enforce post-download limit in `downloadSlackFile`**

After:

```ts
  const buffer = Buffer.from(await res.arrayBuffer());
```

add:

```ts
  assertBufferWithinSizeLimit(buffer, contentType ?? "application/octet-stream", opts?.fileName ?? "Slack file");
```

- [ ] **Step 5: Enforce Slack metadata pre-download limit**

At the start of the Slack file loop in `ingestEstimationFiles`, before `downloadSlackFileWithRetry`, add:

```ts
      if (!isFileWithinSizeLimit(file.mimetype, file.size)) {
        const limit = getFileSizeLimit(file.mimetype);
        logger.warn("Skipping oversized Slack file", {
          jobId,
          fileName: file.name,
          sizeBytes: file.size,
          limitBytes: limit,
        });
        failedFiles.push(`${file.name} (exceeds ${formatMb(limit)} MB limit)`);
        slackManifest.failedFiles.push(file.name);
        continue;
      }
```

After `downloadSlackFileWithRetry`, add:

```ts
      assertBufferWithinSizeLimit(buffer, file.mimetype, file.name);
```

- [ ] **Step 6: Enforce Drive folder metadata and post-download limits**

In `ingestDriveFolder`, after `const fileType = classifyDriveFileForManifest(entry.mimeType);`, add:

```ts
      if (!isFileWithinSizeLimit(entry.mimeType, entry.size)) {
        const limit = getFileSizeLimit(entry.mimeType);
        logger.warn("Skipping oversized Drive file", {
          jobId,
          fileName: entry.name,
          sizeBytes: entry.size,
          limitBytes: limit,
        });
        manifest.failedFiles.push(`${entry.name} (exceeds ${formatMb(limit)} MB limit)`);
        continue;
      }
```

Inside the PDF conversion block, after:

```ts
          const buffer = await downloadDriveFile(entry.id);
```

add:

```ts
          assertBufferWithinSizeLimit(buffer, entry.mimeType, entry.name);
```

- [ ] **Step 7: Run file ingestion tests**

Run:

```bash
npm test -- src/lib/file-ingestion.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit file size limits**

```bash
git add src/lib/file-ingestion.ts src/lib/file-ingestion.test.ts
git commit -m "fix: limit ingested file sizes"
```

### Task 5: Final Security Verification

**Files:**
- Modify: `docs/security.md`

- [ ] **Step 1: Update security docs with launch gates**

Replace the baseline commands block in `docs/security.md` with:

````md
Baseline commands:

```bash
npm run typecheck
npm test
npm run build
npm run scan:secrets
npm run check:mcp-isolation
npm run audit:high
```

`npm audit --audit-level=moderate` currently reports a transitive `workflow`/`devalue` advisory. Track that as dependency hardening, but do not block this Critical/High launch pass on it unless a patched compatible `workflow` release is available.
````

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- src/lib/workflow-reporter.test.ts src/mcp-servers/web-research.test.ts src/mcp-servers/google-workspace.test.ts src/agents/orchestrator.test.ts src/lib/file-ingestion.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full gates**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run scan:secrets
npm run check:mcp-isolation
npm run audit:high
```

Expected:

- TypeScript: PASS.
- Tests: PASS.
- Build: PASS.
- Secret scan: PASS.
- MCP isolation: PASS.
- High audit: PASS. It may print the existing moderate `devalue` advisory while exiting successfully.

- [ ] **Step 4: Confirm working tree and commit docs**

Run:

```bash
git status --short
```

Expected: only `docs/security.md` is uncommitted.

Commit:

```bash
git add docs/security.md
git commit -m "docs: update security launch gates"
```

- [ ] **Step 5: Report smoke-test checklist**

In the final implementation response, include this later manual smoke-test checklist:

```md
Later Vercel smoke test:
1. Deploy to Vercel.
2. Run `npm run doctor:first-launch`.
3. Send one Slack `!estimate` with short text.
4. Send one Slack `!estimate` with a small PDF or DOCX.
5. Confirm Slack thread progress.
6. Confirm Vercel Workflow completion.
7. Confirm Google Doc and Google Sheet outputs.
8. Confirm Vercel Workflow logs do not contain raw RFP text or document body.
```

Do not mark the smoke test complete unless it has actually been run against the deployed app.
