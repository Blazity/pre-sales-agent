import { WebClient } from "@slack/web-api";
import { env } from "./env.js";
import { logger } from "./logger.js";
import {
  createDriveFolder,
  uploadFileToDrive,
  copyDriveFile,
  extractAllGoogleDocsIds,
  extractAllDriveLinks,
  listFolderRecursive,
  downloadDriveFile,
  uploadAndConvertToDriveDoc,
  classifyDriveMimeType,
} from "./google-drive.js";
import { extractPdfText } from "./pdf-extract.js";
import { extractDocxText } from "./docx-extract.js";

// ── Custom errors ───────────────────────────────────────────────────────────

export class DownloadValidationError extends Error {
  constructor(
    message: string,
    public readonly diagnostic: DownloadDiagnostic,
  ) {
    super(message);
    this.name = "DownloadValidationError";
  }
}

export interface DownloadDiagnostic {
  fileName: string;
  expectedSize?: number;
  actualSize: number;
  contentType: string | null;
  headBytes: string;
  responseHeaders: Record<string, string>;
  attempts: number;
  jobId: string;
}

// ── Slack file download ─────────────────────────────────────────────────────

const ACCEPTED_CONTENT_TYPES = [
  "application/pdf",
  "application/octet-stream",
  "binary/octet-stream",
];

const RETRY_DELAYS = [2000, 5000];
const MAX_ATTEMPTS = 3;

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

function collectHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((v, k) => {
    result[k] = v;
  });
  return result;
}

export async function downloadSlackFile(
  url: string,
  opts?: { expectedSize?: number; fileName?: string; jobId?: string; mimeType?: string },
): Promise<Buffer> {
  const timer = logger.startTimer("Slack file download", {
    url: url.slice(0, 80),
    fileName: opts?.fileName,
  });

  // Disable automatic redirects so we can re-attach the Authorization header
  // after Slack's cross-origin redirect (fetch() strips it on redirect to CDN).
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    redirect: "manual",
  });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (location) {
      logger.info("Following Slack file redirect manually", {
        fileName: opts?.fileName,
        redirectTo: location.slice(0, 100),
      });
      res = await fetch(location);
    }
  }

  if (!res.ok) {
    timer.fail(new Error(`HTTP ${res.status}`));
    throw new Error(`Slack file download failed: ${res.status}`);
  }

  const contentType = res.headers.get("content-type");

  if (contentType?.includes("text/html")) {
    const body = await res.text();
    const diagnostic: DownloadDiagnostic = {
      fileName: opts?.fileName ?? "unknown",
      expectedSize: opts?.expectedSize,
      actualSize: body.length,
      contentType,
      headBytes: body.slice(0, 500).replace(/[^\x20-\x7E\n]/g, "."),
      responseHeaders: collectHeaders(res.headers),
      attempts: 1,
      jobId: opts?.jobId ?? "unknown",
    };
    timer.fail(new Error("Received HTML instead of binary"));
    throw new DownloadValidationError(
      `Slack returned HTML instead of file content (content-type: ${contentType})`,
      diagnostic,
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  assertBufferWithinSizeLimit(buffer, opts?.mimeType ?? contentType ?? "application/octet-stream", opts?.fileName ?? "Slack file");

  if (opts?.expectedSize) {
    const diff = Math.abs(buffer.length - opts.expectedSize) / opts.expectedSize;
    if (diff > 0.1) {
      logger.warn("Downloaded file size mismatch", {
        fileName: opts.fileName,
        expectedSize: opts.expectedSize,
        actualSize: buffer.length,
        diffPercent: Math.round(diff * 100),
      });
      const diagnostic: DownloadDiagnostic = {
        fileName: opts.fileName ?? "unknown",
        expectedSize: opts.expectedSize,
        actualSize: buffer.length,
        contentType,
        headBytes: buffer
          .subarray(0, 500)
          .toString("utf-8")
          .replace(/[^\x20-\x7E\n]/g, "."),
        responseHeaders: collectHeaders(res.headers),
        attempts: 1,
        jobId: opts.jobId ?? "unknown",
      };
      timer.fail(new Error("Size mismatch"));
      throw new DownloadValidationError(
        `File size mismatch: expected ~${opts.expectedSize} bytes, got ${buffer.length}`,
        diagnostic,
      );
    }
  }

  timer.end({ sizeBytes: buffer.length });

  logger.info("Downloaded Slack file", {
    url: url.slice(0, 80),
    sizeBytes: buffer.length,
    contentType,
    head: buffer.subarray(0, 20).toString("utf-8").replace(/[^\x20-\x7E]/g, "."),
  });

  return buffer;
}

/** Retry wrapper: attempts download up to MAX_ATTEMPTS, refreshing the URL via files.info on retry */
export async function downloadSlackFileWithRetry(
  fileId: string,
  initialUrl: string,
  opts: { expectedSize?: number; fileName?: string; jobId?: string; mimeType?: string },
): Promise<Buffer> {
  const slackClient = new WebClient(env.SLACK_BOT_TOKEN);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      let url = initialUrl;
      if (attempt > 1) {
        // Refresh the URL via Slack files.info
        const info = await slackClient.files.info({ file: fileId });
        url = info.file?.url_private_download ?? initialUrl;
        logger.info("Refreshed Slack file URL for retry", {
          fileName: opts.fileName,
          attempt,
          jobId: opts.jobId,
        });
      }

      return await downloadSlackFile(url, { ...opts });
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS[attempt - 1];
        logger.warn("Slack file download failed, retrying", {
          fileName: opts.fileName,
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          delayMs: delay,
          error: err instanceof Error ? err.message : String(err),
          jobId: opts.jobId,
        });
        await new Promise((r) => setTimeout(r, delay));
      } else {
        // Permanent failure — log full diagnostic
        const diagnostic: DownloadDiagnostic =
          err instanceof DownloadValidationError
            ? { ...err.diagnostic, attempts: MAX_ATTEMPTS }
            : {
                fileName: opts.fileName ?? "unknown",
                expectedSize: opts.expectedSize,
                actualSize: 0,
                contentType: null,
                headBytes: "",
                responseHeaders: {},
                attempts: MAX_ATTEMPTS,
                jobId: opts.jobId ?? "unknown",
              };

        logger.error("Slack file download permanent failure", {
          event: "slack_file_download_permanent_failure",
          ...diagnostic,
          error: err instanceof Error ? err.message : String(err),
        });

        throw err;
      }
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error("Download retry loop exited unexpectedly");
}

/** Check if a buffer starts with the PDF magic bytes */
export function isValidPdf(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function buildEstimationFolderName(text: string, date: string): string {
  const sanitised = text.replace(/[\/\\:*?"<>|]/g, "").trim();
  const projectName = sanitised.slice(0, 50).trim() || "Estimation";
  return `${projectName} - ${date}`;
}

export function classifySlackFile(mimetype: string): "pdf" | "gdoc" | "docx" | "image" | "other" {
  if (mimetype === "application/pdf") return "pdf";
  if (mimetype.includes("google-apps.document")) return "gdoc";
  if (mimetype.includes("wordprocessingml.document")) return "docx";
  if (mimetype.startsWith("image/")) return "image";
  return "other";
}

export function extractMessageText(text: string): string {
  return text
    .replace(/^!estimate\s*/i, "")
    .replace(/https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[a-zA-Z0-9_-]+[^\s]*/g, "")
    .replace(/https?:\/\/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders|file\/d)\/[a-zA-Z0-9_-]+[^\s]*/g, "")
    .replace(/https?:\/\/drive\.google\.com\/open\?id=[a-zA-Z0-9_-]+[^\s]*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── File manifest types ─────────────────────────────────────────────────────

export type ManifestFileType = "document" | "spreadsheet" | "presentation" | "pdf" | "image" | "other";

export function classifyDriveFileForManifest(mimeType: string): ManifestFileType {
  const driveType = classifyDriveMimeType(mimeType);
  if (driveType === "folder") return "other";
  return driveType;
}

export interface FileManifestEntry {
  name: string;
  type: ManifestFileType;
  driveId: string;
  convertedDocId?: string;
  sourcePath: string;
}

export interface FileManifest {
  files: FileManifestEntry[];
  totalFiles: number;
  failedFiles: string[];
}

// ── Drive folder ingestion ──────────────────────────────────────────────────

export async function ingestDriveFolder(opts: {
  folderId: string;
  inputFolderId: string;
  jobId: string;
}): Promise<FileManifest> {
  const { folderId, inputFolderId, jobId } = opts;

  logger.info("Starting Drive folder ingestion", { jobId, folderId });

  const entries = await listFolderRecursive(folderId);
  logger.info("Folder crawl complete", { jobId, totalFiles: entries.length });

  const manifest: FileManifest = {
    files: [],
    totalFiles: entries.length,
    failedFiles: [],
  };

  for (const entry of entries) {
    try {
      const fileType = classifyDriveFileForManifest(entry.mimeType);
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

      const manifestEntry: FileManifestEntry = {
        name: entry.name,
        type: fileType,
        driveId: "",
        sourcePath: entry.path,
      };

      const copyName = entry.path.replace(/\//g, " - ");
      const copiedId = await copyDriveFile(entry.id, copyName, inputFolderId);
      manifestEntry.driveId = copiedId;

      // For PDFs: also create an OCR-converted Google Doc version
      if (fileType === "pdf") {
        try {
          const buffer = await downloadDriveFile(entry.id);
          assertBufferWithinSizeLimit(buffer, entry.mimeType, entry.name);
          const convertedId = await uploadAndConvertToDriveDoc(
            `${entry.name} (text)`,
            "application/pdf",
            buffer,
            inputFolderId,
          );
          manifestEntry.convertedDocId = convertedId;
          logger.info("PDF converted to Doc for text access", { jobId, fileName: entry.name, convertedId });
        } catch (convertErr) {
          logger.warn("PDF OCR conversion failed, original still available", {
            jobId, fileName: entry.name, error: String(convertErr),
          });
        }
      }

      manifest.files.push(manifestEntry);
      logger.info("Copied Drive file to Input", { jobId, fileName: entry.name, type: fileType });
    } catch (err) {
      logger.error("Failed to process Drive file", { jobId, fileName: entry.name, error: String(err) });
      manifest.failedFiles.push(entry.name);
    }
  }

  return manifest;
}

// ── Main ingestion function ─────────────────────────────────────────────────

export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  url_private_download: string;
  size: number;
}

export interface IngestionResult {
  estimationFolderId: string;
  inputFolderId: string;
  outputFolderId: string;
  messageText: string;
  filesUploaded: number;
  /** Full extracted text from PDFs/documents — ready for the agent prompt */
  extractedRfpText: string;
  /** File names that failed all download/validation retries */
  failedFiles: string[];
  /** Manifest of files from Drive folder ingestion */
  fileManifest?: FileManifest;
}

/** Download, extract, and organize Slack-uploaded files into a Drive folder. */
export async function ingestEstimationFiles(opts: {
  messageText: string;
  slackFiles: SlackFile[];
  jobId: string;
}): Promise<IngestionResult> {
  const { messageText, slackFiles, jobId } = opts;
  const date = new Date().toISOString().slice(0, 10);
  const cleanText = extractMessageText(messageText);

  const folderName = buildEstimationFolderName(cleanText, date);
  const estimationFolderId = await createDriveFolder(folderName, env.GDRIVE_ROOT_FOLDER_ID);
  const inputFolderId = await createDriveFolder("Input", estimationFolderId);
  const outputFolderId = await createDriveFolder("Output", estimationFolderId);

  logger.info("Created estimation Drive folders", {
    jobId, estimationFolderId, inputFolderId, outputFolderId,
  });

  let filesUploaded = 0;
  const extractedParts: string[] = [];
  const failedFiles: string[] = [];
  const slackManifest: FileManifest = {
    files: [],
    totalFiles: slackFiles.length,
    failedFiles: [],
  };

  for (const file of slackFiles) {
    try {
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

      const buffer = await downloadSlackFileWithRetry(
        file.id,
        file.url_private_download,
        { expectedSize: file.size, fileName: file.name, jobId, mimeType: file.mimetype },
      );
      assertBufferWithinSizeLimit(buffer, file.mimetype, file.name);

      // Validate PDF before upload
      if (file.mimetype === "application/pdf" && !isValidPdf(buffer)) {
        logger.error("Downloaded file is not a valid PDF (missing %PDF- header)", {
          jobId, fileName: file.name, sizeBytes: buffer.length,
          head: buffer.subarray(0, 200).toString("utf-8").replace(/[^\x20-\x7E]/g, "."),
        });
        failedFiles.push(file.name);
        slackManifest.failedFiles.push(file.name);
        continue;
      }

      // Upload validated file to Drive
      const uploadTimer = logger.startTimer("Drive file upload", { fileName: file.name });
      const driveId = await uploadFileToDrive(file.name, file.mimetype, buffer, inputFolderId);
      uploadTimer.end();
      filesUploaded++;
      logger.info("Uploaded Slack file to Drive", { jobId, fileName: file.name });

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

      // Extract text from PDFs using Claude vision
      if (file.mimetype === "application/pdf") {
        try {
          const text = await extractPdfText(buffer, file.name);
          extractedParts.push(`=== ${file.name} ===\n${text}`);
          logger.info("Extracted PDF text via Claude", { jobId, fileName: file.name, extractedLength: text.length });
        } catch (extractErr) {
          logger.error("PDF text extraction failed", { jobId, fileName: file.name, error: String(extractErr) });
        }
      }

      // Extract text from DOCX using mammoth
      if (classifySlackFile(file.mimetype) === "docx") {
        try {
          const text = await extractDocxText(buffer, file.name);
          extractedParts.push(`=== ${file.name} ===\n${text}`);
          logger.info("Extracted DOCX text via mammoth", { jobId, fileName: file.name, extractedLength: text.length });
        } catch (extractErr) {
          logger.error("DOCX text extraction failed", { jobId, fileName: file.name, error: String(extractErr) });
        }
      }

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

      // Build manifest entry
      const fileType = classifyDriveFileForManifest(file.mimetype);
      slackManifest.files.push({
        name: file.name,
        type: fileType,
        driveId,
        convertedDocId,
        sourcePath: file.name,
      });
    } catch (err) {
      logger.error("Failed to process Slack file", { jobId, fileName: file.name, error: String(err) });
      failedFiles.push(file.name);
      slackManifest.failedFiles.push(file.name);
    }
  }

  const docIds = extractAllGoogleDocsIds(messageText);
  for (const docId of docIds) {
    try {
      await copyDriveFile(docId, `RFP-doc-${docId.slice(0, 8)}`, inputFolderId);
      filesUploaded++;
      logger.info("Copied Google Doc to Drive Input", { jobId, docId });
    } catch (err) {
      logger.error("Failed to copy Google Doc", { jobId, docId, error: String(err) });
    }
  }

  // Handle Drive folder links — crawl and copy all files
  const driveLinks = extractAllDriveLinks(messageText);
  const folderLinks = driveLinks.filter((l) => l.type === "folder");
  let fileManifest: FileManifest | undefined;

  if (folderLinks.length > 0) {
    try {
      fileManifest = await ingestDriveFolder({
        folderId: folderLinks[0].id,
        inputFolderId,
        jobId,
      });
      filesUploaded += fileManifest.files.length;
      failedFiles.push(...fileManifest.failedFiles);
      logger.info("Drive folder ingestion complete", {
        jobId,
        totalFiles: fileManifest.totalFiles,
        copied: fileManifest.files.length,
        failed: fileManifest.failedFiles.length,
      });
    } catch (err) {
      logger.error("Drive folder ingestion failed", { jobId, error: String(err) });
      throw err;
    }
  }

  // Merge Slack file manifest with Drive folder manifest
  if (fileManifest) {
    fileManifest.files.push(...slackManifest.files);
    fileManifest.totalFiles += slackManifest.totalFiles;
    fileManifest.failedFiles.push(...slackManifest.failedFiles);
  } else if (slackManifest.files.length > 0) {
    fileManifest = slackManifest;
  }

  // Handle individual non-folder Drive links (Sheets, Slides, files)
  const individualLinks = driveLinks.filter(
    (l) => l.type !== "folder" && l.type !== "document", // documents already handled above
  );
  for (const link of individualLinks) {
    try {
      await copyDriveFile(link.id, `RFP-${link.type}-${link.id.slice(0, 8)}`, inputFolderId);
      filesUploaded++;
      logger.info("Copied Drive link to Input", { jobId, type: link.type, id: link.id });
    } catch (err) {
      logger.error("Failed to copy Drive link", { jobId, type: link.type, id: link.id, error: String(err) });
      failedFiles.push(`${link.type}: ${link.id}`);
    }
  }

  if (cleanText.length > 10) {
    try {
      const textBuffer = Buffer.from(cleanText, "utf-8");
      await uploadFileToDrive("message-text.txt", "text/plain", textBuffer, inputFolderId);
      filesUploaded++;
    } catch (err) {
      logger.error("Failed to upload message text", { jobId, error: String(err) });
    }
  }

  const extractedRfpText = extractedParts.join("\n\n");

  return {
    estimationFolderId,
    inputFolderId,
    outputFolderId,
    messageText: cleanText,
    filesUploaded,
    extractedRfpText,
    failedFiles,
    fileManifest,
  };
}
