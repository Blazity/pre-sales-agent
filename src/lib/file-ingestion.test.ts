import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// We must set required env vars BEFORE the dynamic import of file-ingestion.ts,
// which transitively imports env.ts (which eagerly validates process.env).
// ESM static imports are hoisted before module-level code runs, so we use
// dynamic import() to control the timing.

const REQUIRED_ENV_VARS: Record<string, string> = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  SLACK_BOT_TOKEN: "xoxb-test",
  SLACK_SIGNING_SECRET: "signing-secret",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
  GDRIVE_TEMPLATE_ID: "template-doc-id",
  GDRIVE_ROOT_FOLDER_ID: "root-folder-id",
  GSHEETS_TEMPLATE_ID: "template-sheet-id",
  PINECONE_API_KEY: "pinecone-key",
  VOYAGE_API_KEY: "voyage-key",
};

for (const [k, v] of Object.entries(REQUIRED_ENV_VARS)) {
  if (!process.env[k]) process.env[k] = v;
}

// Now dynamically import the module under test (env vars are already set).
const {
  buildEstimationFolderName,
  classifySlackFile,
  extractMessageText,
  downloadSlackFile,
  DownloadValidationError,
  isValidPdf,
  classifyDriveFileForManifest,
  FILE_SIZE_LIMITS,
  getFileSizeLimit,
  isFileWithinSizeLimit,
  assertBufferWithinSizeLimit,
} = await import("./file-ingestion.js");

// ── Helper: create a mock Response ──────────────────────────────────────────

function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  contentType?: string;
  body?: string | Buffer;
  headers?: Record<string, string>;
}): Response {
  const {
    ok = true,
    status = 200,
    contentType = "application/pdf",
    body = "",
    headers = {},
  } = opts;

  const allHeaders = new Headers({ "content-type": contentType, ...headers });
  const bodyBuffer = typeof body === "string" ? Buffer.from(body) : body;

  return {
    ok,
    status,
    headers: allHeaders,
    arrayBuffer: async () => bodyBuffer.buffer.slice(
      bodyBuffer.byteOffset,
      bodyBuffer.byteOffset + bodyBuffer.byteLength,
    ),
    text: async () => typeof body === "string" ? body : body.toString("utf-8"),
  } as unknown as Response;
}

// ── Pure helper tests ───────────────────────────────────────────────────────

describe("File ingestion helpers", () => {
  describe("buildEstimationFolderName()", () => {
    it("builds folder name from text and date", () => {
      const name = buildEstimationFolderName("Build a SaaS platform for contracts", "2026-02-26");
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

    it("defaults to Estimation when text is empty", () => {
      const name = buildEstimationFolderName("", "2026-02-26");
      assert.ok(name.includes("Estimation"));
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

    it("strips query strings and fragments from Drive URLs", () => {
      const text = "!estimate Check https://drive.google.com/drive/folders/abc123?usp=sharing here";
      const result = extractMessageText(text);
      assert.ok(!result.includes("usp=sharing"));
      assert.ok(!result.includes("drive.google.com"));
      assert.ok(result.includes("Check"));
      assert.ok(result.includes("here"));
    });
  });

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
});

// ── Download validation tests ───────────────────────────────────────────────

describe("downloadSlackFile()", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Restore fetch after each test
    globalThis.fetch = originalFetch;
  });

  it("throws DownloadValidationError when response is HTML", async () => {
    globalThis.fetch = mock.fn(async () =>
      mockResponse({
        contentType: "text/html; charset=utf-8",
        body: "<!DOCTYPE html><html><body>Login page</body></html>",
      })
    ) as typeof fetch;

    await assert.rejects(
      () => downloadSlackFile("https://files.slack.com/test.pdf"),
      (err: Error) => {
        assert.ok(err instanceof DownloadValidationError);
        assert.ok(err.message.includes("text/html"));
        assert.equal(err.diagnostic.contentType, "text/html; charset=utf-8");
        assert.ok(err.diagnostic.headBytes.includes("DOCTYPE"));
        return true;
      },
    );
  });

  it("throws on non-OK HTTP status", async () => {
    globalThis.fetch = mock.fn(async () =>
      mockResponse({ ok: false, status: 403 })
    ) as typeof fetch;

    await assert.rejects(
      () => downloadSlackFile("https://files.slack.com/test.pdf"),
      /Slack file download failed: 403/,
    );
  });

  it("throws DownloadValidationError on size mismatch > 10%", async () => {
    const pdfContent = Buffer.from("%PDF-1.4 small content");

    globalThis.fetch = mock.fn(async () =>
      mockResponse({
        contentType: "application/pdf",
        body: pdfContent,
      })
    ) as typeof fetch;

    await assert.rejects(
      () => downloadSlackFile("https://files.slack.com/test.pdf", {
        expectedSize: 100000,
        fileName: "test.pdf",
        jobId: "job_1",
      }),
      (err: Error) => {
        assert.ok(err instanceof DownloadValidationError);
        assert.ok(err.message.includes("size mismatch"));
        assert.equal(err.diagnostic.expectedSize, 100000);
        assert.equal(err.diagnostic.actualSize, pdfContent.length);
        return true;
      },
    );
  });

  it("returns buffer for valid PDF response", async () => {
    const pdfContent = Buffer.from("%PDF-1.4 valid pdf content here");

    globalThis.fetch = mock.fn(async () =>
      mockResponse({
        contentType: "application/pdf",
        body: pdfContent,
      })
    ) as typeof fetch;

    const result = await downloadSlackFile("https://files.slack.com/test.pdf", {
      expectedSize: pdfContent.length,
      fileName: "test.pdf",
    });

    assert.ok(Buffer.isBuffer(result));
    assert.equal(result.length, pdfContent.length);
  });

  it("accepts application/octet-stream content type", async () => {
    const pdfContent = Buffer.from("%PDF-1.4 valid pdf content here");

    globalThis.fetch = mock.fn(async () =>
      mockResponse({
        contentType: "application/octet-stream",
        body: pdfContent,
      })
    ) as typeof fetch;

    const result = await downloadSlackFile("https://files.slack.com/test.pdf");
    assert.ok(Buffer.isBuffer(result));
  });

  it("passes without size check when expectedSize is not provided", async () => {
    const smallPdf = Buffer.from("%PDF-1.4 tiny");

    globalThis.fetch = mock.fn(async () =>
      mockResponse({ contentType: "application/pdf", body: smallPdf })
    ) as typeof fetch;

    const result = await downloadSlackFile("https://files.slack.com/test.pdf");
    assert.equal(result.length, smallPdf.length);
  });
});

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

// ── isValidPdf tests ────────────────────────────────────────────────────────

describe("isValidPdf()", () => {
  it("returns true for valid PDF buffer", () => {
    assert.ok(isValidPdf(Buffer.from("%PDF-1.4 content")));
  });

  it("returns false for HTML content", () => {
    assert.ok(!isValidPdf(Buffer.from("<!DOCTYPE html>")));
  });

  it("returns false for empty buffer", () => {
    assert.ok(!isValidPdf(Buffer.alloc(0)));
  });

  it("returns false for short buffer", () => {
    assert.ok(!isValidPdf(Buffer.from("%PD")));
  });
});
