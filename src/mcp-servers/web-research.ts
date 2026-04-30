import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
config();

const MAX_TEXT_LENGTH = 10000;

interface BraveResult {
  title: string;
  url: string;
  description: string;
}

export function parseBraveResults(data: Record<string, unknown>): BraveResult[] {
  const web = data?.web as { results?: Array<{ title?: string; url?: string; description?: string }> } | undefined;
  if (!web?.results) return [];
  return web.results.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description ?? "",
  }));
}

export function htmlToText(html: string): string {
  let text = html;

  // Remove script, style, nav, footer blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");

  // Convert headings to markdown
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");

  // Convert list items to bullets
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");

  // Convert br and closing p to newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Collapse multiple newlines to double newline
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

const server = new McpServer({ name: "web-research", version: "1.0.0" });

server.tool(
  "fetch_web_page",
  "Fetch a web page and extract its text content. Optionally summarize with a prompt.",
  {
    url: z.string().url().describe("The URL to fetch"),
    extract_prompt: z
      .string()
      .optional()
      .describe("If provided, uses Claude Haiku to extract/summarize specific information from the page"),
  },
  async ({ url, extract_prompt }) => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "PreSalesAgent/0.1" },
      });

      if (!res.ok) {
        return {
          content: [{
            type: "text" as const,
            text: `Fetch failed: ${res.status} ${res.statusText}`,
          }],
        };
      }

      const html = await res.text();
      const pageText = htmlToText(html);

      if (extract_prompt) {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: `${extract_prompt}\n\nPage content:\n${pageText.slice(0, 30000)}`,
          }],
        });

        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        return { content: [{ type: "text" as const, text }] };
      }

      if (pageText.length > MAX_TEXT_LENGTH) {
        return {
          content: [{
            type: "text" as const,
            text: `${pageText.slice(0, MAX_TEXT_LENGTH)}\n\n[... truncated, full page was ${pageText.length} chars ...]`,
          }],
        };
      }

      return { content: [{ type: "text" as const, text: pageText }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

server.tool(
  "web_search",
  "Search the web using Brave Search API. Returns titles, URLs, and snippets. Use this to discover pages, then fetch_web_page to read specific ones.",
  {
    query: z.string().describe("Search query"),
    count: z.number().int().min(1).max(10).default(5).describe("Number of results to return (default 5, max 10)"),
  },
  async ({ query, count }) => {
    try {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY;
      if (!apiKey) {
        return { content: [{ type: "text" as const, text: "Error: BRAVE_SEARCH_API_KEY not configured" }] };
      }

      const params = new URLSearchParams({ q: query, count: String(count) });
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
      });

      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: "text" as const, text: `Brave Search error: ${res.status} ${text}` }] };
      }

      const data = await res.json();
      const results = parseBraveResults(data as Record<string, unknown>);

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No results found." }] };
      }

      const formatted = results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
        .join("\n\n");

      return { content: [{ type: "text" as const, text: formatted }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

const isTestRun = process.env.NODE_TEST_CONTEXT !== undefined || process.argv[1]?.includes("test");
if (!isTestRun) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
