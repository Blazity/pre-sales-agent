import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Pinecone } from "@pinecone-database/pinecone";
import { z } from "zod";
import { config } from "dotenv";
// quiet: true — dotenv 17+ writes a startup tip to stdout, which corrupts
// the MCP JSON-RPC handshake on this server's stdio transport.
config({ quiet: true });

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const INDEX_NAME = process.env.PINECONE_INDEX ?? "estimations";
const MIN_SCORE = 0.4;

async function getEmbedding(text: string, maxRetries = 3): Promise<number[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "voyage-3", input: [text] }),
    });

    if (res.status === 429 && attempt < maxRetries) {
      const backoff = Math.pow(2, attempt) * 1000;
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    if (!res.ok) throw new Error(`Voyage API error: ${res.statusText}`);
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    return data.data[0].embedding;
  }

  throw new Error("Voyage API error: Too Many Requests (exhausted retries)");
}

// ── Result formatters (exported for testing) ──────────────────────────────────

interface MatchRecord {
  id: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export function formatEstimationResults(matches: MatchRecord[]): string {
  if (matches.length === 0) return "No matching past estimations found.";

  // Group by project
  const projects = new Map<string, { summary?: MatchRecord; features: MatchRecord[] }>();

  for (const m of matches) {
    const meta = m.metadata ?? {};
    const projectName = String(meta.project_name ?? "Unknown");
    if (!projects.has(projectName)) projects.set(projectName, { features: [] });
    const entry = projects.get(projectName)!;

    if (meta.type === "estimation_summary") {
      entry.summary = m;
    } else {
      entry.features.push(m);
    }
  }

  const sections: string[] = [];
  let idx = 1;
  for (const [name, { summary, features }] of projects) {
    const lines: string[] = [];
    if (summary) {
      const meta = summary.metadata!;
      lines.push(`[${idx}] ${name} (Score: ${summary.score?.toFixed(3)})`);
      lines.push(`    Total: ${meta.total_hours}h / €${Number(meta.total_cost_eur).toLocaleString()}`);
      if (meta.team_roles) lines.push(`    Team: ${meta.team_roles}`);
      lines.push(`    Features: ${meta.feature_count} items`);
      lines.push(`    Sheet: ${meta.sheet_url}`);
      if (meta.linked_proposal_id) {
        lines.push(`    Linked proposal: https://docs.google.com/document/d/${meta.linked_proposal_id}/edit`);
      }
    } else {
      lines.push(`[${idx}] ${name}`);
    }

    if (features.length > 0) {
      lines.push(`    Matching features:`);
      for (const f of features) {
        const fm = f.metadata!;
        lines.push(`      - ${fm.feature_name}: ${fm.role} | ${fm.hours}h | €${Number(fm.cost_eur).toLocaleString()} (Score: ${f.score?.toFixed(3)})`);
      }
    }

    sections.push(lines.join("\n"));
    idx++;
  }

  return sections.join("\n\n");
}

export function buildCaseStudyFilter(
  industry?: string,
  problem_type?: string,
): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown>[] = [];
  if (industry) conditions.push({ industry: { $eq: industry } });
  if (problem_type) conditions.push({ problem_type: { $eq: problem_type } });
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({ name: "knowledge-base", version: "2.0.0" });

server.tool(
  "search_past_estimations",
  "Search past project estimations for structured effort/cost data. Returns project summaries with hours, costs, team roles, and individual feature breakdowns. Use this to calibrate your estimate against real historical data.",
  {
    query: z.string().describe("Description of the project or feature to search for"),
    top_k: z.number().int().min(1).max(10).default(5).describe("Number of results"),
    filter_role: z.string().optional().describe("Filter by role (exact match, e.g., 'Senior Developer')"),
  },
  async ({ query, top_k, filter_role }) => {
    try {
      const embedding = await getEmbedding(query);
      const index = pinecone.index(INDEX_NAME);

      const filter = filter_role
        ? { role: { $eq: filter_role } }
        : undefined;

      const results = await index.namespace("estimations").query({
        vector: embedding,
        topK: top_k,
        includeMetadata: true,
        filter,
      });

      return {
        content: [{
          type: "text" as const,
          text: formatEstimationResults(
            (results.matches as MatchRecord[]).filter((m) => (m.score ?? 0) >= MIN_SCORE),
          ),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

server.tool(
  "search_past_proposals",
  "Search past proposal documents for writing reference. Returns text chunks from previous offers — use for tone, structure, and detail level reference when writing new proposals.",
  {
    query: z.string().describe("Description of the project or topic to search for"),
    top_k: z.number().int().min(1).max(10).default(3).describe("Number of results"),
  },
  async ({ query, top_k }) => {
    try {
      const embedding = await getEmbedding(query);
      const index = pinecone.index(INDEX_NAME);
      const results = await index.namespace("proposals").query({
        vector: embedding,
        topK: top_k,
        includeMetadata: true,
      });

      const filtered = results.matches.filter((m) => (m.score ?? 0) >= MIN_SCORE);
      if (filtered.length === 0) {
        return { content: [{ type: "text" as const, text: "No matching past proposals found." }] };
      }
      const formatted = filtered
        .map((m, i) => {
          const meta = m.metadata as Record<string, unknown>;
          const lines = [
            `[${i + 1}] ${meta.project_name} (Score: ${m.score?.toFixed(3)})`,
            `    Doc: ${meta.doc_url}`,
          ];
          if (meta.linked_sheet_id) {
            lines.push(`    Linked estimation: https://docs.google.com/spreadsheets/d/${meta.linked_sheet_id}/edit`);
          }
          lines.push(`    ${(meta.chunk_text as string)?.slice(0, 500) ?? ""}`);
          return lines.join("\n");
        })
        .join("\n\n");

      return {
        content: [{
          type: "text" as const,
          text: formatted || "No matching past proposals found.",
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${String(err)}` }] };
    }
  },
);

server.tool(
  "search_case_studies",
  "Search configured agency case studies by relevance, industry, or problem type. Returns structured results with client name, metrics, tech stack, and URL.",
  {
    query: z.string().describe("Search query describing the project or domain"),
    industry: z.string().optional().describe("Filter by industry (e.g., e-commerce, saas, media)"),
    problem_type: z.string().optional().describe("Filter by problem type (e.g., migration, greenfield, modernization)"),
    top_k: z.number().int().min(1).max(10).default(3).describe("Number of results"),
  },
  async ({ query, industry, problem_type, top_k }) => {
    try {
      const embedding = await getEmbedding(query);
      const index = pinecone.index(INDEX_NAME);
      const filter = buildCaseStudyFilter(industry, problem_type);
      const results = await index.namespace("case_studies").query({
        vector: embedding,
        topK: top_k,
        includeMetadata: true,
        ...(filter ? { filter } : {}),
      });

      const filtered = results.matches.filter((m) => (m.score ?? 0) >= MIN_SCORE);
      if (filtered.length === 0) {
        return { content: [{ type: "text" as const, text: "No matching case studies found." }] };
      }
      const formatted = filtered
        .map((m, i) => {
          const meta = m.metadata as Record<string, unknown>;
          return [
            `[${i + 1}] ${meta.title} (Score: ${m.score?.toFixed(3)})`,
            `    Industry: ${meta.industry}`,
            `    Problem: ${meta.problem_type}`,
            `    Tech: ${meta.tech_stack}`,
            `    Key Metric: ${meta.key_metric}`,
            `    URL: ${meta.url}`,
            `    ${(meta.chunk_text as string)?.slice(0, 300) ?? ""}`,
          ].join("\n");
        })
        .join("\n\n");

      return {
        content: [{
          type: "text" as const,
          text: formatted || "No matching case studies found.",
        }],
      };
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
