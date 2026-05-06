import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "dotenv";
// quiet: true — dotenv 17+ writes a startup tip to stdout, which corrupts
// the MCP JSON-RPC handshake on this server's stdio transport.
config({ quiet: true });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const ALLOWED_FOLDER_IDS = (process.env.ALLOWED_FOLDER_IDS ?? "").split(",").filter(Boolean);
const GSHEETS_TEMPLATE_ID = (process.env.GSHEETS_TEMPLATE_ID ?? "").trim();

// ── Token cache ──────────────────────────────────────────────────────────────
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

function assertAllowedFolder(folderId: string): void {
  if (ALLOWED_FOLDER_IDS.length > 0 && !ALLOWED_FOLDER_IDS.includes(folderId)) {
    throw new Error(`Folder ${folderId} is not in the allowed folder list.`);
  }
}

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

// ── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer({ name: "google-workspace", version: "1.0.0" });

// ── Drive: list files in a folder ────────────────────────────────────────────
server.tool(
  "drive_list_files",
  "List files inside a Google Drive folder. Returns file names, IDs, and MIME types.",
  {
    folder_id: z.string().describe("The Google Drive folder ID"),
    page_size: z.number().int().min(1).max(100).default(50).describe("Max files to return"),
  },
  async ({ folder_id, page_size }) => {
    try {
      assertAllowedFolder(folder_id);
      const token = await getAccessToken();
      const q = encodeURIComponent(`'${folder_id}' in parents and trashed = false`);
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=${page_size}&fields=files(id,name,mimeType,size,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: "text" as const, text: `Drive API error: ${text}` }] };
      }
      const data = (await res.json()) as { files: Array<{ id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }> };
      const formatted = data.files
        .map((f) => `- ${f.name} (${f.mimeType}) [id: ${f.id}]${f.size ? ` ${Math.round(Number(f.size) / 1024)}KB` : ""}`)
        .join("\n");
      return { content: [{ type: "text" as const, text: formatted || "No files found in folder." }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

// ── Drive: get file metadata ─────────────────────────────────────────────────
server.tool(
  "drive_get_file",
  "Get metadata for a specific Google Drive file by its ID.",
  {
    file_id: z.string().describe("The Google Drive file ID"),
  },
  async ({ file_id }) => {
    try {
      const token = await getAccessToken();
      await assertAllowedFile(file_id, token);
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file_id}?fields=id,name,mimeType,size,modifiedTime,webViewLink,parents&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: "text" as const, text: `Drive API error: ${text}` }] };
      }
      const data = await res.json();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

// ── Drive: search files ──────────────────────────────────────────────────────
server.tool(
  "drive_search_files",
  "Search Google Drive for files matching a query string.",
  {
    query: z.string().describe("Search query (file name or content keywords)"),
    page_size: z.number().int().min(1).max(50).default(10).describe("Max results"),
  },
  async ({ query, page_size }) => {
    try {
      const token = await getAccessToken();
      const q = encodeURIComponent(`name contains '${query.replace(/'/g, "\\'")}' and trashed = false`);
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=${page_size}&fields=files(id,name,mimeType,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: "text" as const, text: `Drive API error: ${text}` }] };
      }
      const data = (await res.json()) as { files: Array<{ id: string; name: string; mimeType: string; webViewLink?: string }> };
      const formatted = data.files
        .map((f) => `- ${f.name} (${f.mimeType}) [id: ${f.id}]${f.webViewLink ? `\n  ${f.webViewLink}` : ""}`)
        .join("\n");
      return { content: [{ type: "text" as const, text: formatted || "No files found." }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

// ── Drive: export file content (for Google Docs/Sheets) ──────────────────────
server.tool(
  "drive_export_file",
  "Export a Google Docs/Sheets/Slides file to plain text or another format. Use this to READ the content of Google Docs or uploaded PDFs.",
  {
    file_id: z.string().describe("The Google Drive file ID"),
    mime_type: z.enum([
      "text/plain",
      "text/html",
      "application/pdf",
      "text/csv",
    ]).default("text/plain").describe("Export MIME type (text/plain for Google Docs, text/csv for Sheets)"),
  },
  async ({ file_id, mime_type }) => {
    try {
      const token = await getAccessToken();
      await assertAllowedFile(file_id, token);

      // First check the file type to determine export vs download
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file_id}?fields=mimeType,name&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!metaRes.ok) {
        const text = await metaRes.text();
        return { content: [{ type: "text" as const, text: `Metadata error: ${text}` }] };
      }
      const meta = (await metaRes.json()) as { mimeType: string; name: string };

      let contentRes: Response;
      if (meta.mimeType.startsWith("application/vnd.google-apps.")) {
        // Google native format — use export
        contentRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file_id}/export?mimeType=${encodeURIComponent(mime_type)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
      } else {
        // Uploaded file (PDF, docx, etc.) — use download
        contentRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file_id}?alt=media&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
      }

      if (!contentRes.ok) {
        const text = await contentRes.text();
        return { content: [{ type: "text" as const, text: `Export/download error: ${text}` }] };
      }

      const text = await contentRes.text();
      // Truncate very large content to avoid overwhelming the agent
      const maxLen = 20_000;
      const truncated = text.length > maxLen ? text.slice(0, maxLen) + "\n\n[... truncated, content too large ...]" : text;
      return { content: [{ type: "text" as const, text: `File: ${meta.name} (${meta.mimeType})\n\n${truncated}` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

// ── Docs: create document ────────────────────────────────────────────────────
server.tool(
  "docs_create_document",
  "Create a new Google Doc in a specific Drive folder with initial content.",
  {
    title: z.string().describe("Document title"),
    parent_folder_id: z.string().describe("Google Drive folder ID to create the doc in"),
    content: z.string().optional().describe("Initial plain-text content for the document body"),
  },
  async ({ title, parent_folder_id, content }) => {
    try {
      assertAllowedFolder(parent_folder_id);
      const token = await getAccessToken();

      // Create empty doc in the target folder
      const createRes = await fetch(
        "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: title,
            mimeType: "application/vnd.google-apps.document",
            parents: [parent_folder_id],
          }),
        },
      );

      if (!createRes.ok) {
        const text = await createRes.text();
        return { content: [{ type: "text" as const, text: `Create doc error: ${text}` }] };
      }

      const doc = (await createRes.json()) as { id: string; name: string };

      // If content provided, insert it using the Docs API
      if (content) {
        const insertRes = await fetch(
          `https://docs.googleapis.com/v1/documents/${doc.id}:batchUpdate`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              requests: [
                {
                  insertText: {
                    location: { index: 1 },
                    text: content,
                  },
                },
              ],
            }),
          },
        );

        if (!insertRes.ok) {
          const text = await insertRes.text();
          return {
            content: [{
              type: "text" as const,
              text: `Doc created (${doc.id}) but content insert failed: ${text}\nURL: https://docs.google.com/document/d/${doc.id}/edit`,
            }],
          };
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: `Document created successfully!\nTitle: ${doc.name}\nID: ${doc.id}\nURL: https://docs.google.com/document/d/${doc.id}/edit`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

// ── Docs: get document content ───────────────────────────────────────────────
server.tool(
  "docs_get_document",
  "Get the plain-text content of a Google Doc by its document ID.",
  {
    document_id: z.string().describe("The Google Doc document ID"),
  },
  async ({ document_id }) => {
    try {
      const token = await getAccessToken();
      await assertAllowedFile(document_id, token);
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${document_id}/export?mimeType=text%2Fplain`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: "text" as const, text: `Export error: ${text}` }] };
      }
      const text = await res.text();
      const maxLen = 20_000;
      const truncated = text.length > maxLen ? text.slice(0, maxLen) + "\n\n[... truncated ...]" : text;
      return { content: [{ type: "text" as const, text: truncated }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

// ── Docs: copy template ──────────────────────────────────────────────────────
server.tool(
  "docs_copy_template",
  "Copy a Google Doc template to a new location and return the new document ID and URL.",
  {
    template_id: z.string().describe("The Google Doc template ID to copy"),
    title: z.string().describe("Title for the new document"),
    parent_folder_id: z.string().describe("Folder ID to place the copy in"),
  },
  async ({ template_id, title, parent_folder_id }) => {
    try {
      assertAllowedFolder(parent_folder_id);
      const token = await getAccessToken();
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${template_id}/copy?supportsAllDrives=true`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: title, parents: [parent_folder_id] }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: "text" as const, text: `Copy error: ${text}` }] };
      }
      const data = (await res.json()) as { id: string; name: string };
      return {
        content: [{
          type: "text" as const,
          text: `Template copied!\nTitle: ${data.name}\nID: ${data.id}\nURL: https://docs.google.com/document/d/${data.id}/edit`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

// ── Docs: write sections (rich formatting) ──────────────────────────────────

// Section schemas using zod discriminated union
const headingSchema = z.object({
  type: z.literal("heading"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string(),
  fontSize: z.number().optional().describe("Font size override in points"),
});
const paragraphSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string(),
  alignment: z.enum(["START", "CENTER", "END"]).optional().describe("Paragraph alignment"),
  fontSize: z.number().optional().describe("Font size in points"),
});
const bulletListSchema = z.object({
  type: z.literal("bullet_list"),
  items: z.array(z.string()),
});
const numberedListSchema = z.object({
  type: z.literal("numbered_list"),
  items: z.array(z.string()),
});
const tableSchema = z.object({
  type: z.literal("table"),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  headerBackground: z.string().optional().describe("Hex color for header row background, e.g. '#F97316'"),
  headerTextColor: z.string().optional().describe("Hex color for header row text, e.g. '#FFFFFF'"),
  totalRowBackground: z.string().optional().describe("Hex color for last row background (total row)"),
  totalRowTextColor: z.string().optional().describe("Hex color for last row text"),
  borderColor: z.string().optional().describe("Hex color for table borders, e.g. '#E6E8EB'"),
});
const dividerSchema = z.object({ type: z.literal("divider") });
const pageBreakSchema = z.object({ type: z.literal("page_break") });
const imageSchema = z.object({
  type: z.literal("image"),
  drive_file_id: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});
const chartSchema = z.object({
  type: z.literal("chart"),
  chart_type: z.enum(["bar", "line", "pie", "column"]),
  title: z.string(),
  labels: z.array(z.string()),
  datasets: z.array(z.object({ label: z.string(), data: z.array(z.number()) })),
});

const sectionSchema = z.discriminatedUnion("type", [
  headingSchema,
  paragraphSchema,
  bulletListSchema,
  numberedListSchema,
  tableSchema,
  dividerSchema,
  pageBreakSchema,
  imageSchema,
  chartSchema,
]);

type Section = z.infer<typeof sectionSchema>;

// ── Bold/Italic parsing ─────────────────────────────────────────────────────

interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

export function parseFormattedText(input: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(~~(#[0-9A-Fa-f]{6})~~(.+?)~~|\*\*(.+?)\*\*|\*(.+?)\*|([^*~]+|[*~]))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m[3] !== undefined && m[2] !== undefined) {
      runs.push({ text: m[3], color: m[2] });
    } else if (m[4] !== undefined) {
      runs.push({ text: m[4], bold: true });
    } else if (m[5] !== undefined) {
      runs.push({ text: m[5], italic: true });
    } else if (m[6] !== undefined) {
      runs.push({ text: m[6] });
    }
  }
  return runs;
}

// ── Build batchUpdate requests from sections ────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DocRequest = Record<string, any>;

interface ChartEmbed {
  spreadsheetId: string;
  chartId: number;
}

// ── Section grouping ────────────────────────────────────────────────────────

type SectionGroup =
  | { type: "simple"; sections: Section[]; originalIndices: number[] }
  | { type: "table"; table: Extract<Section, { type: "table" }>; originalIndex: number };

export function groupSections(sections: Section[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  let simpleBuf: Section[] = [];
  let indexBuf: number[] = [];

  for (let i = 0; i < sections.length; i++) {
    if (sections[i].type === "table") {
      if (simpleBuf.length > 0) {
        groups.push({ type: "simple", sections: simpleBuf, originalIndices: indexBuf });
        simpleBuf = [];
        indexBuf = [];
      }
      groups.push({ type: "table", table: sections[i] as Extract<Section, { type: "table" }>, originalIndex: i });
    } else {
      simpleBuf.push(sections[i]);
      indexBuf.push(i);
    }
  }
  if (simpleBuf.length > 0) {
    groups.push({ type: "simple", sections: simpleBuf, originalIndices: indexBuf });
  }
  return groups;
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    red: parseInt(h.substring(0, 2), 16) / 255,
    green: parseInt(h.substring(2, 4), 16) / 255,
    blue: parseInt(h.substring(4, 6), 16) / 255,
  };
}

function applyTextRunStyles(runs: TextRun[], startOffset: number, requests: any[]): number {
  let offset = startOffset;
  for (const run of runs) {
    if (run.bold || run.italic || run.color) {
      const style: Record<string, any> = {};
      const fields: string[] = [];
      if (run.bold) { style.bold = true; fields.push("bold"); }
      if (run.italic) { style.italic = true; fields.push("italic"); }
      if (run.color) {
        style.foregroundColor = { color: { rgbColor: hexToRgb(run.color) } };
        fields.push("foregroundColor");
      }
      requests.push({
        updateTextStyle: {
          range: { startIndex: offset, endIndex: offset + run.text.length },
          textStyle: style,
          fields: fields.join(","),
        },
      });
    }
    offset += run.text.length;
  }
  return offset;
}

// ── Simple batch builder ────────────────────────────────────────────────────

export function buildSimpleBatch(
  sections: Section[],
  startCursor: number,
  sectionIndices: number[],
  chartEmbeds?: Map<number, ChartEmbed>,
): { requests: DocRequest[]; charsInserted: number } {
  const requests: DocRequest[] = [];
  let cursor = startCursor;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const origIdx = sectionIndices[i];

    // Spacing between sections (not before the first section in an empty doc)
    if (cursor > 1) {
      requests.push({ insertText: { location: { index: cursor }, text: "\n" } });
      cursor += 1;
    }

    switch (section.type) {
      case "heading": {
        const text = section.text + "\n";
        requests.push({ insertText: { location: { index: cursor }, text } });
        const headingMap = { 1: "HEADING_1", 2: "HEADING_2", 3: "HEADING_3" } as const;
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: cursor, endIndex: cursor + text.length },
            paragraphStyle: { namedStyleType: headingMap[section.level] },
            fields: "namedStyleType",
          },
        });
        if (section.fontSize) {
          requests.push({
            updateTextStyle: {
              range: { startIndex: cursor, endIndex: cursor + text.length - 1 },
              textStyle: { fontSize: { magnitude: section.fontSize, unit: "PT" } },
              fields: "fontSize",
            },
          });
        }
        cursor += text.length;
        break;
      }

      case "paragraph": {
        const runs = parseFormattedText(section.text);
        const plainText = runs.map((r) => r.text).join("") + "\n";
        requests.push({ insertText: { location: { index: cursor }, text: plainText } });
        applyTextRunStyles(runs, cursor, requests);
        if (section.alignment) {
          requests.push({
            updateParagraphStyle: {
              range: { startIndex: cursor, endIndex: cursor + plainText.length },
              paragraphStyle: { alignment: section.alignment },
              fields: "alignment",
            },
          });
        }
        if (section.fontSize) {
          requests.push({
            updateTextStyle: {
              range: { startIndex: cursor, endIndex: cursor + plainText.length - 1 },
              textStyle: { fontSize: { magnitude: section.fontSize, unit: "PT" } },
              fields: "fontSize",
            },
          });
        }
        cursor += plainText.length;
        break;
      }

      case "bullet_list":
      case "numbered_list": {
        const itemRuns = section.items.map((item) => parseFormattedText(item));
        const plainText = itemRuns.map((runs) => runs.map((r) => r.text).join("")).join("\n") + "\n";
        requests.push({ insertText: { location: { index: cursor }, text: plainText } });

        let offset = cursor;
        for (const runs of itemRuns) {
          offset = applyTextRunStyles(runs, offset, requests);
          offset += 1; // \n separator
        }

        const preset = section.type === "bullet_list"
          ? "BULLET_DISC_CIRCLE_SQUARE"
          : "NUMBERED_DECIMAL_NESTED";
        requests.push({
          createParagraphBullets: {
            range: { startIndex: cursor, endIndex: cursor + plainText.length - 1 },
            bulletPreset: preset,
          },
        });
        cursor += plainText.length;
        break;
      }

      case "divider": {
        requests.push({ insertText: { location: { index: cursor }, text: "\n" } });
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: cursor, endIndex: cursor + 1 },
            paragraphStyle: {
              borderBottom: {
                color: { color: { rgbColor: { red: 0.8, green: 0.8, blue: 0.8 } } },
                width: { magnitude: 1, unit: "PT" },
                padding: { magnitude: 8, unit: "PT" },
                dashStyle: "SOLID",
              },
            },
            fields: "borderBottom",
          },
        });
        cursor += 1;
        break;
      }

      case "page_break": {
        requests.push({ insertPageBreak: { location: { index: cursor } } });
        requests.push({ insertText: { location: { index: cursor + 1 }, text: "\n" } });
        cursor += 2;
        break;
      }

      case "image": {
        const uri = `https://www.googleapis.com/drive/v3/files/${section.drive_file_id}?alt=media`;
        const objectSize: Record<string, unknown> = {};
        if (section.width) objectSize.width = { magnitude: section.width, unit: "PT" };
        if (section.height) objectSize.height = { magnitude: section.height, unit: "PT" };
        requests.push({
          insertInlineImage: {
            location: { index: cursor },
            uri,
            ...(Object.keys(objectSize).length > 0 ? { objectSize } : {}),
          },
        });
        requests.push({ insertText: { location: { index: cursor + 1 }, text: "\n" } });
        cursor += 2;
        break;
      }

      case "chart": {
        const embed = chartEmbeds?.get(origIdx);
        if (embed) {
          requests.push({
            insertInlineSheetsChart: {
              spreadsheetId: embed.spreadsheetId,
              chartId: embed.chartId,
              location: { index: cursor },
              objectSize: {
                width: { magnitude: 450, unit: "PT" },
                height: { magnitude: 280, unit: "PT" },
              },
            },
          });
          requests.push({ insertText: { location: { index: cursor + 1 }, text: "\n" } });
          cursor += 2;
        }
        break;
      }
    }
  }

  return { requests, charsInserted: cursor - startCursor };
}

// ── Document structure helpers ──────────────────────────────────────────────

async function getDocumentStructure(documentId: string, token: string): Promise<any> {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getDocumentStructure failed: ${await res.text()}`);
  return res.json();
}

function getDocumentEndIndex(doc: any): number {
  const body = doc.body.content;
  const lastElement = body[body.length - 1];
  return lastElement.endIndex - 1;
}

// ── Table cell positions ────────────────────────────────────────────────────

export function extractCellPositions(doc: any, tableStartIdx: number): number[][] {
  const tableEl = doc.body.content.find(
    (el: any) => el.table && el.startIndex >= tableStartIdx,
  );
  if (!tableEl) throw new Error(`Table not found at or after index ${tableStartIdx}`);
  return tableEl.table.tableRows.map((row: any) =>
    row.tableCells.map((cell: any) => cell.content[0].startIndex),
  );
}

// ── Table fill requests ─────────────────────────────────────────────────────

export function buildTableFillRequests(
  headers: string[],
  rows: string[][],
  cellPositions: number[][],
  style?: {
    headerTextColor?: string;
    totalRowTextColor?: string;
  },
): { requests: DocRequest[]; totalTextInserted: number } {
  const requests: DocRequest[] = [];
  let shift = 0;
  const allData = [headers, ...rows];

  for (let r = 0; r < allData.length; r++) {
    for (let c = 0; c < allData[r].length; c++) {
      const text = allData[r][c];
      if (!text) continue;

      const actualIdx = cellPositions[r][c] + shift;
      requests.push({ insertText: { location: { index: actualIdx }, text } });

      const isHeaderRow = r === 0;
      const isTotalRow = r === allData.length - 1 && r > 0;

      if (isHeaderRow) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: actualIdx, endIndex: actualIdx + text.length },
            textStyle: { bold: true },
            fields: "bold",
          },
        });
      }

      if (isHeaderRow && style?.headerTextColor) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: actualIdx, endIndex: actualIdx + text.length },
            textStyle: { foregroundColor: { color: { rgbColor: hexToRgb(style.headerTextColor) } } },
            fields: "foregroundColor",
          },
        });
      }

      if (isTotalRow && style?.totalRowTextColor) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: actualIdx, endIndex: actualIdx + text.length },
            textStyle: {
              bold: true,
              foregroundColor: { color: { rgbColor: hexToRgb(style.totalRowTextColor) } },
            },
            fields: "bold,foregroundColor",
          },
        });
      }

      shift += text.length;
    }
  }

  return { requests, totalTextInserted: shift };
}

// ── Sections orchestrator ───────────────────────────────────────────────────

async function sendBatchUpdate(documentId: string, requests: DocRequest[], token: string): Promise<void> {
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`batchUpdate failed: ${text}`);
  }
}

async function executeSections(
  documentId: string,
  sections: Section[],
  chartEmbeds: Map<number, ChartEmbed>,
  token: string,
): Promise<{ written: number; errors: string[] }> {
  let doc = await getDocumentStructure(documentId, token);
  let cursor = getDocumentEndIndex(doc);

  const groups = groupSections(sections);
  let written = 0;
  const errors: string[] = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];

    // Spacing between groups (not before the first group if doc is empty)
    if (gi > 0 && cursor > 1) {
      try {
        await sendBatchUpdate(documentId, [
          { insertText: { location: { index: cursor }, text: "\n" } },
        ], token);
        cursor += 1;
      } catch {
        // spacing failure is non-critical
      }
    }

    try {
      if (group.type === "simple") {
        const { requests, charsInserted } = buildSimpleBatch(
          group.sections, cursor, group.originalIndices, chartEmbeds,
        );
        if (requests.length > 0) {
          await sendBatchUpdate(documentId, requests, token);
          cursor += charsInserted;
        }
        written += group.sections.length;
      } else {
        // Table workflow: insert structure → read back → fill cells
        const cols = group.table.headers.length;
        const rowCount = group.table.rows.length + 1;
        const tableInsertIdx = cursor;

        await sendBatchUpdate(documentId, [
          { insertTable: { rows: rowCount, columns: cols, location: { index: tableInsertIdx } } },
        ], token);

        doc = await getDocumentStructure(documentId, token);
        const cellPositions = extractCellPositions(doc, tableInsertIdx);

        const { requests, totalTextInserted } = buildTableFillRequests(
          group.table.headers, group.table.rows, cellPositions,
          {
            headerTextColor: group.table.headerTextColor,
            totalRowTextColor: group.table.totalRowTextColor,
          },
        );
        if (requests.length > 0) {
          await sendBatchUpdate(documentId, requests, token);
        }

        // Find table end from refreshed doc structure
        const tableEl = doc.body.content.find(
          (el: any) => el.table && el.startIndex >= tableInsertIdx,
        );
        const tableStartLocation = tableEl?.startIndex ?? tableInsertIdx;

        // Table cell background + border styling
        const tableStyle = group.table;
        const tableStyleRequests: DocRequest[] = [];

        if (tableStyle.headerBackground) {
          const rgb = hexToRgb(tableStyle.headerBackground);
          for (let c = 0; c < cols; c++) {
            tableStyleRequests.push({
              updateTableCellStyle: {
                tableStartLocation: { index: tableStartLocation },
                rowIndex: 0,
                columnIndex: c,
                tableCellStyle: {
                  backgroundColor: { color: { rgbColor: rgb } },
                },
                fields: "backgroundColor",
              },
            });
          }
        }

        if (tableStyle.totalRowBackground && rowCount > 1) {
          const rgb = hexToRgb(tableStyle.totalRowBackground);
          for (let c = 0; c < cols; c++) {
            tableStyleRequests.push({
              updateTableCellStyle: {
                tableStartLocation: { index: tableStartLocation },
                rowIndex: rowCount - 1,
                columnIndex: c,
                tableCellStyle: {
                  backgroundColor: { color: { rgbColor: rgb } },
                },
                fields: "backgroundColor",
              },
            });
          }
        }

        if (tableStyle.borderColor) {
          const rgb = hexToRgb(tableStyle.borderColor);
          const border = {
            color: { color: { rgbColor: rgb } },
            width: { magnitude: 0.5, unit: "PT" },
            dashStyle: "SOLID",
          };
          for (let r = 0; r < rowCount; r++) {
            for (let c = 0; c < cols; c++) {
              tableStyleRequests.push({
                updateTableCellStyle: {
                  tableStartLocation: { index: tableStartLocation },
                  rowIndex: r,
                  columnIndex: c,
                  tableCellStyle: {
                    borderTop: border,
                    borderBottom: border,
                    borderLeft: border,
                    borderRight: border,
                  },
                  fields: "borderTop,borderBottom,borderLeft,borderRight",
                },
              });
            }
          }
        }

        if (tableStyleRequests.length > 0) {
          await sendBatchUpdate(documentId, tableStyleRequests, token);
        }

        cursor = (tableEl?.endIndex ?? cursor) + totalTextInserted;
        written += 1;
      }
    } catch (err) {
      const label = group.type === "simple"
        ? `Sections ${group.originalIndices.join(",")}`
        : `Section ${group.originalIndex} (table)`;
      console.error(`[docs_write_sections] ${label}: ${String(err)}`);
      errors.push(`${label}: ${String(err)}`);
      // Re-read document to recalibrate cursor
      try {
        doc = await getDocumentStructure(documentId, token);
        cursor = getDocumentEndIndex(doc);
      } catch {
        // If even reading fails, we can't continue
        break;
      }
    }
  }

  return { written, errors };
}

// ── Chart helpers ───────────────────────────────────────────────────────────

/** Build the 2D values array for a chart's Google Sheet */
export function buildChartSheetData(
  labels: string[],
  datasets: { label: string; data: number[] }[],
): (string | number)[][] {
  const header = ["", ...labels];
  const rows = datasets.map((ds) => [ds.label, ...ds.data] as (string | number)[]);
  return [header, ...rows];
}

const CHART_TYPE_MAP: Record<string, string> = {
  bar: "BAR",
  column: "COLUMN",
  line: "LINE",
  pie: "PIE",
};

server.tool(
  "docs_write_sections",
  "Write richly formatted sections to a Google Doc using structured data. Supports headings, paragraphs (with **bold** and *italic*), bullet/numbered lists, tables, page breaks, dividers, images, and embedded charts.",
  {
    document_id: z.string().describe("The Google Doc document ID"),
    sections: z.array(sectionSchema).describe("Array of section objects to write"),
  },
  async ({ document_id, sections }) => {
    try {
      const token = await getAccessToken();
      await assertAllowedFile(document_id, token);

      // Phase 1: Create Sheets for any chart sections
      const chartEmbeds = new Map<number, ChartEmbed>();
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        if (s.type !== "chart") continue;

        try {
          // Create temporary spreadsheet
          const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ properties: { title: `Chart - ${s.title}` } }),
          });
          if (!createRes.ok) throw new Error(`Create sheet: ${await createRes.text()}`);
          const sheet = (await createRes.json()) as { spreadsheetId: string; sheets: { properties: { sheetId: number } }[] };
          const sheetId = sheet.sheets[0].properties.sheetId;

          // Populate data
          const values = buildChartSheetData(s.labels, s.datasets);
          const range = `Sheet1!A1:${String.fromCharCode(65 + s.labels.length)}${values.length}`;
          const putRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
            {
              method: "PUT",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ range, values }),
            },
          );
          if (!putRes.ok) throw new Error(`Populate sheet: ${await putRes.text()}`);

          // Create chart
          const chartType = CHART_TYPE_MAP[s.chart_type] ?? "BAR";
          const series = s.datasets.map((_, di) => ({
            series: {
              sourceRange: {
                sources: [{
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: values.length,
                  startColumnIndex: di + 1,
                  endColumnIndex: di + 2,
                }],
              },
            },
            targetAxis: "LEFT_AXIS",
          }));

          const addChartRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}:batchUpdate`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                requests: [{
                  addChart: {
                    chart: {
                      spec: {
                        title: s.title,
                        basicChart: {
                          chartType,
                          legendPosition: "BOTTOM_LEGEND",
                          domains: [{
                            domain: {
                              sourceRange: {
                                sources: [{
                                  sheetId,
                                  startRowIndex: 0,
                                  endRowIndex: values.length,
                                  startColumnIndex: 0,
                                  endColumnIndex: 1,
                                }],
                              },
                            },
                          }],
                          series,
                          headerCount: 1,
                        },
                      },
                      position: { newSheet: true },
                    },
                  },
                }],
              }),
            },
          );
          if (!addChartRes.ok) throw new Error(`Add chart: ${await addChartRes.text()}`);
          const chartResult = (await addChartRes.json()) as { replies: { addChart: { chart: { chartId: number } } }[] };
          const chartId = chartResult.replies[0].addChart.chart.chartId;

          chartEmbeds.set(i, { spreadsheetId: sheet.spreadsheetId, chartId });
        } catch (chartErr) {
          // Chart creation failed — skip this chart, continue with other sections
          console.error(`Chart creation failed for section ${i}: ${String(chartErr)}`);
        }
      }

      // Phase 2: Execute sections with hybrid forward cursor
      if (sections.length === 0) {
        return { content: [{ type: "text" as const, text: "No sections to write." }] };
      }

      const chartCount = chartEmbeds.size;
      const result = await executeSections(document_id, sections, chartEmbeds, token);
      const errMsg = result.errors.length > 0
        ? `\nErrors:\n${result.errors.map(e => `- ${e}`).join("\n")}`
        : "";
      return {
        content: [{
          type: "text" as const,
          text: `Written ${result.written}/${sections.length} sections.${chartCount > 0 ? ` Embedded ${chartCount} chart(s).` : ""}${errMsg}\nURL: https://docs.google.com/document/d/${document_id}/edit`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

server.tool(
  "docs_find_and_replace",
  "Find and replace text in a Google Doc. Useful for filling template placeholders.",
  {
    document_id: z.string().describe("The Google Doc document ID"),
    find: z.string().describe("Text to find (exact match)"),
    replace: z.string().describe("Replacement text"),
  },
  async ({ document_id, find, replace }) => {
    try {
      const token = await getAccessToken();
      await assertAllowedFile(document_id, token);
      const res = await fetch(
        `https://docs.googleapis.com/v1/documents/${document_id}:batchUpdate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requests: [{
              replaceAllText: {
                containsText: { text: find, matchCase: true },
                replaceText: replace,
              },
            }],
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: "text" as const, text: `Replace error: ${text}` }] };
      }
      const data = (await res.json()) as { replies: { replaceAllText: { occurrencesChanged: number } }[] };
      const changed = data.replies[0]?.replaceAllText?.occurrencesChanged ?? 0;
      return {
        content: [{
          type: "text" as const,
          text: `Replaced ${changed} occurrence(s) of "${find}" with "${replace}".`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

const MAX_ESTIMATION_ROWS = 100;

// ── Estimation Sheet helpers ────────────────────────────────────────────────

interface EstimationItem {
  name: string;
  effort_md: number;
  type: string;
  optional: boolean;
  risk: "Low" | "Medium" | "High";
  assumptions: string;
  figma_link: string;
}

interface EstimationArea {
  name: string;
  items: EstimationItem[];
}

interface SubtotalPosition {
  sheetRow: number;
  firstDataRow: number;
  lastDataRow: number;
}

function roundToQuarter(md: number): number {
  return Math.round(md * 4) / 4;
}

function calculateRiskBuffer(baseMD: number, risk: "Low" | "Medium" | "High"): number {
  const multiplier = risk === "High" ? 1.3 : risk === "Medium" ? 1.15 : 1;
  return roundToQuarter(baseMD * multiplier);
}

export function buildEstimationRows(areas: EstimationArea[]): {
  dataRows: (string | number | boolean)[][];
  subtotalPositions: SubtotalPosition[];
} {
  const dataRows: (string | number | boolean)[][] = [];
  const subtotalPositions: SubtotalPosition[] = [];
  let currentSheetRow = 3; // Row 1 = header, Row 2 = column descriptions

  for (const area of areas) {
    const firstDataRow = currentSheetRow;

    for (let i = 0; i < area.items.length; i++) {
      const item = area.items[i];
      const md = roundToQuarter(item.effort_md);
      const riskBuffer = calculateRiskBuffer(md, item.risk);
      dataRows.push([
        i === 0 ? area.name : "",
        item.name,
        md,
        riskBuffer,
        item.type,
        item.optional,
        item.risk,
        item.assumptions,
        item.figma_link,
      ]);
      currentSheetRow++;
    }

    const lastDataRow = currentSheetRow - 1;
    subtotalPositions.push({ sheetRow: currentSheetRow, firstDataRow, lastDataRow });
    currentSheetRow++;
  }

  return { dataRows, subtotalPositions };
}

export function calculateCalendarDays(totalMD: number, recommendedDevs: number): number {
  return Math.ceil((totalMD / recommendedDevs) * 1.15);
}

// ── Sheets: create estimation from template ─────────────────────────────────

server.tool(
  "sheets_create_estimation",
  "Create a 9-column estimation spreadsheet from the template. Copies the template, clears example data, writes estimation breakdown by Module → Action Items with risk buffer, type, optional flag, and risk level. Per-module subtotal rows included.",
  {
    title: z.string().describe("Spreadsheet title, e.g. 'Estimation - Client - 2026-03-06'"),
    parent_folder_id: z.string().describe("Google Drive folder ID to place the spreadsheet in"),
    recommended_developers: z.number().int().min(1).describe("Recommended number of senior engineers"),
    areas: z.array(z.object({
      name: z.string().describe("Module name, e.g. 'Project Setup'"),
      items: z.array(z.object({
        name: z.string().describe("Action item name"),
        effort_md: z.number().min(0).describe("Effort in man-days (0.25 granularity)"),
        type: z.string().describe("Work type: Frontend, Backend, Design, QA, or DevOps"),
        optional: z.boolean().describe("true if item is nice-to-have, false if required"),
        risk: z.enum(["Low", "Medium", "High"]).describe("Risk level — affects risk buffer column"),
        assumptions: z.string().describe("Assumptions for this item"),
        figma_link: z.string().describe("URL to Figma frame/page, or empty string"),
      })).min(1),
    })).min(1),
  },
  async ({ title, parent_folder_id, recommended_developers, areas }) => {
    try {
      assertAllowedFolder(parent_folder_id);

      if (!GSHEETS_TEMPLATE_ID) {
        return { content: [{ type: "text" as const, text: "Error: GSHEETS_TEMPLATE_ID not configured" }] };
      }

      const token = await getAccessToken();

      // 1. Copy template to output folder
      const copyRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${GSHEETS_TEMPLATE_ID}/copy?supportsAllDrives=true`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: title, parents: [parent_folder_id] }),
        },
      );
      if (!copyRes.ok) {
        const text = await copyRes.text();
        return { content: [{ type: "text" as const, text: `Copy template error: ${text}` }] };
      }
      const copied = (await copyRes.json()) as { id: string };
      const sheetId = copied.id;

      // 2. Get sheet metadata to find the first sheet's gid
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties,sheets.merges`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!metaRes.ok) {
        const text = await metaRes.text();
        return { content: [{ type: "text" as const, text: `Metadata error: ${text}` }] };
      }
      const meta = (await metaRes.json()) as {
        sheets: Array<{
          properties: { sheetId: number; title: string; gridProperties: { rowCount: number } };
          merges?: Array<{ sheetId: number; startRowIndex: number; endRowIndex: number; startColumnIndex: number; endColumnIndex: number }>;
        }>;
      };
      const firstSheet = meta.sheets[0];
      const gid = firstSheet.properties.sheetId;
      const existingRows = firstSheet.properties.gridProperties.rowCount;

      // 2b. Unmerge all cells so per-item writes land in every row
      const merges = firstSheet.merges ?? [];
      if (merges.length > 0) {
        const unmergeRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: merges.map((m) => ({ unmergeCells: { range: m } })),
            }),
          },
        );
        if (!unmergeRes.ok) {
          const text = await unmergeRes.text();
          return { content: [{ type: "text" as const, text: `Unmerge error: ${text}` }] };
        }
      }

      // Quote sheet title for A1 notation (handles spaces and special chars)
      const quotedTitle = `'${firstSheet.properties.title.replace(/'/g, "''")}'`;

      // 2c. Build data rows early so we know the required grid size
      const { dataRows, subtotalPositions } = buildEstimationRows(areas);
      const totalMD = dataRows.reduce((sum, row) => sum + (row[2] as number), 0);
      const totalRiskMD = dataRows.reduce((sum, row) => sum + (row[3] as number), 0);
      const totalMDStr = Number.isInteger(totalMD) ? String(totalMD) : totalMD.toFixed(1);

      if (dataRows.length > MAX_ESTIMATION_ROWS) {
        return { content: [{ type: "text" as const, text: `Error: Estimation has ${dataRows.length} items, exceeding the maximum of ${MAX_ESTIMATION_ROWS}. Reduce the number of action items.` }] };
      }

      // 3. Clear all data cells (keep header row 0, keep row structure for frozen rows)
      if (existingRows > 1) {
        const clearRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${quotedTitle}!A3:Z${existingRows}`)}:clear`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          },
        );
        if (!clearRes.ok) {
          const text = await clearRes.text();
          return { content: [{ type: "text" as const, text: `Clear rows error: ${text}` }] };
        }
      }

      // 3a. Clear formatting from data area to remove remnant template styles
      if (existingRows > 2) {
      const clearFmtRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [{
              updateCells: {
                range: { sheetId: gid, startRowIndex: 2, endRowIndex: existingRows, startColumnIndex: 0, endColumnIndex: 9 },
                fields: "userEnteredFormat",
              },
            }],
          }),
        },
      );
      if (!clearFmtRes.ok) {
        const text = await clearFmtRes.text();
        return { content: [{ type: "text" as const, text: `Clear formatting error: ${text}` }] };
      }
      }

      // 3b. Expand grid if needed (header + description + data rows + subtotal rows + 5 summary rows)
      const requiredRows = 2 + dataRows.length + subtotalPositions.length + 5; // +2 for header + description rows
      if (requiredRows > existingRows) {
        const expandRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: [{ appendDimension: { sheetId: gid, dimension: "ROWS", length: requiredRows - existingRows } }],
            }),
          },
        );
        if (!expandRes.ok) {
          const text = await expandRes.text();
          return { content: [{ type: "text" as const, text: `Expand grid error: ${text}` }] };
        }
      }

      // 4. Build full grid: data rows interleaved with empty subtotal placeholder rows
      const emptyRow = ["", "", "", "", "", "", "", "", ""];
      const fullGrid: (string | number | boolean)[][] = [];
      const moduleNameRows: number[] = [];
      let dataIdx = 0;
      let sheetRow = 3;

      for (const area of areas) {
        moduleNameRows.push(sheetRow);
        for (let i = 0; i < area.items.length; i++) {
          fullGrid.push(dataRows[dataIdx]);
          dataIdx++;
          sheetRow++;
        }
        fullGrid.push(emptyRow);
        sheetRow++;
      }

      // 5. Write data rows with RAW to prevent formula injection from RFP content
      const lastDataGridRow = 2 + fullGrid.length; // +2 accounts for header (row 1) + description (row 2)
      const dataRange = `${quotedTitle}!A3:I${lastDataGridRow}`;
      const writeRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(dataRange)}?valueInputOption=RAW`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ range: dataRange, values: fullGrid }),
        },
      );
      if (!writeRes.ok) {
        const text = await writeRes.text();
        return { content: [{ type: "text" as const, text: `Write data error: ${text}` }] };
      }

      // 6. Write subtotal rows with USER_ENTERED so SUM formulas are evaluated
      for (const sub of subtotalPositions) {
        const subtotalRange = `${quotedTitle}!A${sub.sheetRow}:I${sub.sheetRow}`;
        const subtotalValues = [[
          "", "Subtotal",
          `=SUM(C${sub.firstDataRow}:C${sub.lastDataRow})`,
          `=SUM(D${sub.firstDataRow}:D${sub.lastDataRow})`,
          "", "", "", "", "",
        ]];
        const subRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(subtotalRange)}?valueInputOption=USER_ENTERED`,
          {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ range: subtotalRange, values: subtotalValues }),
          },
        );
        if (!subRes.ok) {
          const text = await subRes.text();
          return { content: [{ type: "text" as const, text: `Write subtotal error: ${text}` }] };
        }
      }

      // 7. Apply formatting via batchUpdate
      const formatRequests: any[] = [];

      for (const sub of subtotalPositions) {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: gid, startRowIndex: sub.sheetRow - 1, endRowIndex: sub.sheetRow, startColumnIndex: 0, endColumnIndex: 9 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.937, green: 0.937, blue: 0.937 },
                textFormat: { bold: true, fontFamily: "Montserrat", fontSize: 10 },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        });
      }

      for (const row of moduleNameRows) {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: gid, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true, fontFamily: "Montserrat", fontSize: 10 } } },
            fields: "userEnteredFormat(textFormat)",
          },
        });
      }

      if (formatRequests.length > 0) {
        const fmtRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ requests: formatRequests }),
          },
        );
        if (!fmtRes.ok) {
          const text = await fmtRes.text();
          return { content: [{ type: "text" as const, text: `Format error: ${text}` }] };
        }
      }

      // 8. Write summary rows with USER_ENTERED so SUM formulas are evaluated
      const summaryStartRow = sheetRow;
      const calendarDays = calculateCalendarDays(totalMD, recommended_developers);
      const subtotalCRefs = subtotalPositions.map(s => `C${s.sheetRow}`).join(",");
      const subtotalDRefs = subtotalPositions.map(s => `D${s.sheetRow}`).join(",");

      // Build SUMPRODUCT formulas scoped to data rows only (exclude subtotal rows)
      const reqC = subtotalPositions.map(s => `SUMPRODUCT((F${s.firstDataRow}:F${s.lastDataRow}=FALSE)*C${s.firstDataRow}:C${s.lastDataRow})`).join("+");
      const reqD = subtotalPositions.map(s => `SUMPRODUCT((F${s.firstDataRow}:F${s.lastDataRow}=FALSE)*D${s.firstDataRow}:D${s.lastDataRow})`).join("+");
      const optC = subtotalPositions.map(s => `SUMPRODUCT((F${s.firstDataRow}:F${s.lastDataRow}=TRUE)*C${s.firstDataRow}:C${s.lastDataRow})`).join("+");
      const optD = subtotalPositions.map(s => `SUMPRODUCT((F${s.firstDataRow}:F${s.lastDataRow}=TRUE)*D${s.firstDataRow}:D${s.lastDataRow})`).join("+");
      const summaryRows = [
        ["Total required (MD)", "", `=${reqC}`, `=${reqD}`, "", "", "", "", ""],
        ["Total optional (MD)", "", `=${optC}`, `=${optD}`, "", "", "", "", ""],
        ["Total (MD)", "", `=SUM(${subtotalCRefs})`, `=SUM(${subtotalDRefs})`, "", "", "", "", ""],
        ["Recommended team size", "", recommended_developers, "Senior Engineers", "", "", "", "", ""],
        ["Calendar days (estimated)", "", calendarDays, "Based on total MD ÷ team + 15% buffer", "", "", "", "", ""],
      ];
      const summaryRange = `${quotedTitle}!A${summaryStartRow}:I${summaryStartRow + 4}`;
      const summaryRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(summaryRange)}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ range: summaryRange, values: summaryRows }),
        },
      );
      if (!summaryRes.ok) {
        const text = await summaryRes.text();
        return { content: [{ type: "text" as const, text: `Write summary error: ${text}` }] };
      }

      const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
      return {
        content: [{
          type: "text" as const,
          text: `Estimation spreadsheet created!\nTitle: ${title}\nID: ${sheetId}\nURL: ${sheetUrl}\nTotal: ${totalMDStr} MD (risk buffer: ${totalRiskMD.toFixed(1)} MD)\nAreas: ${areas.length}, Action items: ${dataRows.length}\nRecommended team: ${recommended_developers} senior engineers\nEstimated calendar days: ${calendarDays}`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

// ── Start (skip when imported for testing) ───────────────────────────────────
const isTestRun = process.env.NODE_TEST_CONTEXT !== undefined || process.argv[1]?.includes("test");
if (!isTestRun) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
