import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch, type RequestInfo as UndiciRequestInfo, type RequestInit as UndiciRequestInit } from "undici";
import { z } from "zod";
import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
// quiet: true — dotenv 17+ writes a startup tip to stdout, which corrupts
// the MCP JSON-RPC handshake on this server's stdio transport.
config({ quiet: true });

const MAX_TEXT_LENGTH = 10000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TEXT_CONTENT_TYPES = ["text/html", "text/plain", "application/xhtml+xml"];

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

type HostResolver = (hostname: string) => Promise<string[]>;
type PinnedLookup = (
  hostname: string,
  options: object,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
) => void;
type PublicFetch = (input: UndiciRequestInfo, init?: UndiciRequestInit) => ReturnType<typeof undiciFetch>;

interface ValidatedPublicWebUrl {
  url: URL;
  addresses: string[];
}

interface PublicWebPageResponse {
  response: Response;
  close: () => Promise<void>;
}

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

function normalizeHostForIpCheck(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function mappedIpv4FromIpv6(ip: string): string | null {
  if (!ip.startsWith("::ffff:")) return null;

  const mapped = ip.slice("::ffff:".length);
  if (net.isIP(mapped) === 4) return mapped;

  const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexMatch) return null;

  const high = Number.parseInt(hexMatch[1], 16);
  const low = Number.parseInt(hexMatch[2], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null;

  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join(".");
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
    const mappedIpv4 = mappedIpv4FromIpv6(normalized);
    if (mappedIpv4) return isPublicIpAddress(mappedIpv4);

    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("fec") ||
      normalized.startsWith("fed") ||
      normalized.startsWith("fee") ||
      normalized.startsWith("fef") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8")
    );
  }

  return false;
}

async function resolvePublicWebUrl(rawUrl: string, resolver: HostResolver = resolveHostname): Promise<ValidatedPublicWebUrl> {
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

  const hostForIpCheck = normalizeHostForIpCheck(hostname);
  const addresses = net.isIP(hostForIpCheck) ? [hostForIpCheck] : await resolver(hostname);
  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
    throw new Error("URL resolved to an address that is not public.");
  }
  return { url, addresses };
}

export async function validatePublicWebUrl(rawUrl: string, resolver: HostResolver = resolveHostname): Promise<URL> {
  const { url } = await resolvePublicWebUrl(rawUrl, resolver);
  return url;
}

export function createPinnedLookup(address: string): PinnedLookup {
  const family = net.isIP(address);
  if (family === 0) {
    throw new Error("Pinned address must be a valid IP address.");
  }

  return (_hostname, _options, callback) => callback(null, address, family);
}

function createPinnedDispatcher(address: string): Agent {
  return new Agent({
    connect: {
      lookup: createPinnedLookup(address),
    },
  });
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

export async function fetchPublicWebPage(
  rawUrl: string,
  options: { resolver?: HostResolver; fetchImpl?: PublicFetch } = {},
): Promise<PublicWebPageResponse> {
  const resolver = options.resolver ?? resolveHostname;
  const fetchImpl = options.fetchImpl ?? undiciFetch;
  let current = await resolvePublicWebUrl(rawUrl, resolver);

  redirectLoop:
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    let lastFetchError: unknown;

    for (const address of current.addresses) {
      const dispatcher = createPinnedDispatcher(address);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetchImpl(current.url, {
          headers: { "User-Agent": "PreSalesAgent/0.1" },
          dispatcher,
          redirect: "manual",
          signal: controller.signal,
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) {
            return {
              response: response as unknown as Response,
              close: async () => {
                await dispatcher.close();
              },
            };
          }
          if (redirectCount === MAX_REDIRECTS) {
            throw new Error(`Too many redirects; max is ${MAX_REDIRECTS}.`);
          }
          await response.body?.cancel();
          await dispatcher.close();
          current = await resolvePublicWebUrl(new URL(location, current.url).toString(), resolver);
          continue redirectLoop;
        }

        return {
          response: response as unknown as Response,
          close: async () => {
            await dispatcher.close();
          },
        };
      } catch (error) {
        await dispatcher.close();
        lastFetchError = error;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (lastFetchError) throw lastFetchError;
  }

  throw new Error(`Too many redirects; max is ${MAX_REDIRECTS}.`);
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
      const fetched = await fetchPublicWebPage(url);
      try {
        const res = fetched.response;

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
      } finally {
        await fetched.close();
      }
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
