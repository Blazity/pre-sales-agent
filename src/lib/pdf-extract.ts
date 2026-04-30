import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";
import { logger } from "./logger.js";

const EXTRACT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 8000;

const EXTRACT_PROMPT =
  "Extract ALL text content from this document. Preserve the structure: headings, " +
  "bullet points, numbered lists, tables (use markdown table format), and any text " +
  "visible in images or diagrams. Do NOT summarise — output the full verbatim text.";

/**
 * Send a PDF buffer to Claude and extract its full text content.
 * Uses the native document content block so Claude can read images/tables/diagrams.
 */
export async function extractPdfText(buffer: Buffer, fileName: string): Promise<string> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const base64 = buffer.toString("base64");

  const timer = logger.startTimer("pdf-extract", { fileName, sizeKB: Math.round(buffer.length / 1024) });

  try {
    const response = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            { type: "text", text: EXTRACT_PROMPT },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    timer.end({ extractedLength: text.length });
    return text;
  } catch (err) {
    timer.fail(err);
    throw err;
  }
}
