import mammoth from "mammoth";
import { logger } from "./logger.js";

/**
 * Extract text from a DOCX buffer using mammoth.
 * Returns markdown-like text preserving headings, lists, and tables.
 */
export async function extractDocxText(buffer: Buffer, fileName: string): Promise<string> {
  const timer = logger.startTimer("docx-extract", { fileName, sizeKB: Math.round(buffer.length / 1024) });

  try {
    const result = await mammoth.extractRawText({ buffer });

    if (result.messages.length > 0) {
      logger.debug("mammoth extraction warnings", {
        fileName,
        warnings: result.messages.map((m) => m.message).slice(0, 5),
      });
    }

    const text = result.value.trim();
    timer.end({ extractedLength: text.length });
    return text;
  } catch (err) {
    timer.fail(err);
    throw err;
  }
}
