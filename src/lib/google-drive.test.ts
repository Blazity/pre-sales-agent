import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// We must set required env vars BEFORE the dynamic import of google-drive.ts,
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
  PINECONE_API_KEY: "pinecone-key",
  VOYAGE_API_KEY: "voyage-key",
};

for (const [k, v] of Object.entries(REQUIRED_ENV_VARS)) {
  if (!process.env[k]) process.env[k] = v;
}

// Now dynamically import the module under test (env vars are already set).
const {
  buildFolderMetadata,
  buildUploadMetadata,
  extractGoogleDocsId,
  extractAllGoogleDocsIds,
  extractAllDriveLinks,
  classifyDriveMimeType,
} = await import("./google-drive.js");

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

  describe("extractAllGoogleDocsIds()", () => {
    it("extracts multiple doc IDs from text", () => {
      const text = "Check https://docs.google.com/document/d/abc123/edit and https://docs.google.com/document/d/def456/edit";
      const ids = extractAllGoogleDocsIds(text);
      assert.deepEqual(ids, ["abc123", "def456"]);
    });

    it("returns empty array for text with no docs links", () => {
      assert.deepEqual(extractAllGoogleDocsIds("no links here"), []);
    });
  });

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
});
