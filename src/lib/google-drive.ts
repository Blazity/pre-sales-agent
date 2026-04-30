import { env } from "./env.js";
import { logger } from "./logger.js";

// ── Token cache ──────────────────────────────────────────────────────────────
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

// ── Pure helpers (tested without API calls) ──────────────────────────────────

export function buildFolderMetadata(name: string, parentId: string) {
  return {
    name,
    mimeType: "application/vnd.google-apps.folder" as const,
    parents: [parentId],
  };
}

export function buildUploadMetadata(name: string, mimeType: string, parentId: string) {
  return { name, mimeType, parents: [parentId] };
}

const GDOC_URL_RE = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/;

export function extractGoogleDocsId(url: string): string | null {
  const match = url.match(GDOC_URL_RE);
  return match ? match[1] : null;
}

export function extractAllGoogleDocsIds(text: string): string[] {
  const ids: string[] = [];
  const re = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

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

// ── Drive API calls ──────────────────────────────────────────────────────────

export async function createDriveFolder(name: string, parentId: string): Promise<string> {
  const timer = logger.startTimer("Drive folder creation", { name, parentId });
  const token = await getAccessToken();
  const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildFolderMetadata(name, parentId)),
  });

  if (!res.ok) {
    const text = await res.text();
    timer.fail(new Error(`${res.status} ${text}`));
    throw new Error(`Drive createFolder failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  timer.end({ folderId: data.id });
  return data.id;
}

export async function uploadFileToDrive(
  name: string,
  mimeType: string,
  buffer: Buffer,
  parentId: string,
): Promise<string> {
  const timer = logger.startTimer("Drive file upload", { name, parentId, sizeBytes: buffer.length });
  const token = await getAccessToken();
  const metadata = JSON.stringify(buildUploadMetadata(name, mimeType, parentId));

  const boundary = "estimation_agent_boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    timer.fail(new Error(`${res.status} ${text}`));
    throw new Error(`Drive upload failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  timer.end({ fileId: data.id });
  return data.id;
}

/**
 * Upload a file to Drive AND convert it to a Google Doc (OCR for PDFs).
 * The resulting file is a native Google Doc that can be exported as text.
 */
export async function uploadAndConvertToDriveDoc(
  name: string,
  sourceMimeType: string,
  buffer: Buffer,
  parentId: string,
): Promise<string> {
  const token = await getAccessToken();
  // Set target mimeType to Google Doc — Drive will OCR/convert the source
  const metadata = JSON.stringify({
    name: name.replace(/\.[^.]+$/, ""), // strip extension for the Google Doc
    mimeType: "application/vnd.google-apps.document",
    parents: [parentId],
  });

  const boundary = "estimation_agent_convert_boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${sourceMimeType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive convert-upload failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  logger.info("Uploaded & converted file to Google Doc", { name, sourceMimeType, parentId, fileId: data.id });
  return data.id;
}

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

export async function copyDriveFile(fileId: string, name: string, parentId: string): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/copy?supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, parents: [parentId] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive copy failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  logger.info("Copied Drive file", { sourceId: fileId, name, parentId, newId: data.id });
  return data.id;
}
