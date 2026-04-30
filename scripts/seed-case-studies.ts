/**
 * Seed Pinecone with Blazity case studies scraped from blazity.com/case-studies.
 *
 * Fetches the listing page, discovers all case study slugs, scrapes each detail
 * page, chunks the text, embeds with voyage-3, and upserts to Pinecone.
 *
 * Usage:
 *   npx tsx scripts/seed-case-studies.ts
 */

import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";

const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const PINECONE_INDEX = process.env.PINECONE_INDEX ?? "estimations";
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY!;

const BASE_URL = "https://blazity.com";
const CASE_STUDIES_URL = `${BASE_URL}/case-studies`;
const CHUNK_WORDS = 800;
const CHUNK_OVERLAP_WORDS = 80;
const MIN_CHUNK_WORDS = 10;
const EMBEDDING_DELAY_MS = 21000; // ~3 RPM to stay within free-tier Voyage limits

// ── Metadata mapping ─────────────────────────────────────────────────────────

const CASE_STUDY_META: Record<string, { industry: string; problem_type: string; tech_stack: string; key_metric: string }> = {
  cookunity: { industry: "food-tech", problem_type: "migration", tech_stack: "Next.js, Shopify", key_metric: "70% LCP improvement, double-digit conversion gains" },
  iberion: { industry: "media", problem_type: "migration", tech_stack: "Next.js, headless CMS", key_metric: "30% perf boost, 150M+ monthly visits, zero downtime" },
  planday: { industry: "saas", problem_type: "modernization", tech_stack: "Next.js, headless CMS", key_metric: "4x faster development speed" },
  encoura: { industry: "education", problem_type: "modernization", tech_stack: "Next.js, headless CMS", key_metric: "10x faster page creation" },
  arthurai: { industry: "ai", problem_type: "modernization", tech_stack: "Next.js, React", key_metric: "48x faster onboarding (8h to 10min)" },
  vibes: { industry: "martech", problem_type: "greenfield", tech_stack: "Next.js, BFF architecture", key_metric: "Faster deployment, autonomous development" },
  dropsy: { industry: "e-commerce", problem_type: "greenfield", tech_stack: "React Native", key_metric: "250K users in month 1, 1M+ downloads, 4.7 star rating" },
  "unreal-estate": { industry: "real-estate", problem_type: "greenfield", tech_stack: "Next.js", key_metric: "3M listings, 800% SEO growth, 50% broker fee savings" },
  speechmatics: { industry: "ai", problem_type: "performance", tech_stack: "Next.js, AI agents", key_metric: "AI voice agent, optimized performance" },
};

const DEFAULT_META = { industry: "unknown", problem_type: "unknown", tech_stack: "", key_metric: "" };

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-3", input: [text] }),
  });
  if (!res.ok) throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + CHUNK_WORDS).join(" ");
    const trimmed = chunk.trim();
    if (trimmed && trimmed.split(/\s+/).length >= MIN_CHUNK_WORDS) chunks.push(trimmed);
    i += CHUNK_WORDS - CHUNK_OVERLAP_WORDS;
  }
  return chunks;
}

function htmlToText(html: string) {
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

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");

  // Collapse multiple newlines and trim
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function slugToTitle(slug: string) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Scraping ─────────────────────────────────────────────────────────────────

async function fetchCaseStudySlugs(): Promise<string[]> {
  const res = await fetch(CASE_STUDIES_URL);
  if (!res.ok) throw new Error(`Failed to fetch listing: ${res.status}`);
  const html = await res.text();

  const slugs = new Set<string>();

  // Primary: parse JSON-LD structured data (Webflow renders links via JS, not static HTML)
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (jsonLdMatch) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]) as { hasPart?: { url?: string }[] };
      for (const part of ld.hasPart ?? []) {
        const urlMatch = part.url?.match(/\/case-stud(?:y|ies)\/([a-z0-9-]+)/);
        if (urlMatch) slugs.add(urlMatch[1]);
      }
    } catch { /* fall through to regex fallback */ }
  }

  // Fallback: look for href patterns in static HTML
  if (slugs.size === 0) {
    const regex = /href=["'](?:https?:\/\/(?:www\.)?blazity\.com)?\/case-stud(?:y|ies)\/([a-z0-9-]+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      slugs.add(match[1]);
    }
  }

  return [...slugs];
}

async function fetchCaseStudyText(slug: string): Promise<string> {
  const url = `${CASE_STUDIES_URL}/${slug}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();
  return htmlToText(html);
}

// ── Pinecone setup ───────────────────────────────────────────────────────────

async function ensureIndex(pc: Pinecone) {
  const existing = await pc.listIndexes();
  const names = existing.indexes?.map((i) => i.name) ?? [];
  if (!names.includes(PINECONE_INDEX)) {
    console.log(`Creating Pinecone index "${PINECONE_INDEX}"...`);
    await pc.createIndex({
      name: PINECONE_INDEX,
      dimension: 1024,
      metric: "cosine",
      spec: { serverless: { cloud: "aws", region: "us-east-1" } },
    });
    await new Promise((r) => setTimeout(r, 10000));
    console.log("Index ready.\n");
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function seedCaseStudies(deleteExisting = false) {
  console.log("Seeding Blazity case studies into Pinecone\n");
  console.log(`Index: ${PINECONE_INDEX}\n`);

  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  await ensureIndex(pc);
  const index = pc.index(PINECONE_INDEX);

  if (deleteExisting) {
    console.log("Deleting existing case_study vectors...");
    await index.namespace("case_studies").deleteAll();
    console.log("Deleted.\n");
  }

  console.log("Fetching case study listing...");
  const slugs = await fetchCaseStudySlugs();
  console.log(`Found ${slugs.length} case studies: ${slugs.join(", ")}\n`);

  if (slugs.length === 0) {
    console.log("No case studies found on the listing page.");
    return;
  }

  let seeded = 0;

  for (const slug of slugs) {
    const url = `${CASE_STUDIES_URL}/${slug}`;
    const title = slugToTitle(slug);
    const meta = CASE_STUDY_META[slug] ?? DEFAULT_META;

    console.log(`  ${title} (${slug})`);

    const text = await fetchCaseStudyText(slug);
    if (!text) {
      console.log("    Empty page, skipping.");
      continue;
    }

    const chunks = chunkText(text);
    console.log(`    ${chunks.length} chunk(s)`);

    const idPrefix = `case_study_${slug}`;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (i > 0 || seeded > 0) await new Promise((r) => setTimeout(r, EMBEDDING_DELAY_MS));
      process.stdout.write(`    chunk ${i + 1}/${chunks.length}... `);
      const embedding = await getEmbedding(chunk);
      await index.namespace("case_studies").upsert({
        records: [
          {
            id: `${idPrefix}_chunk${i}`,
            values: embedding,
            metadata: {
              title,
              type: "case_study",
              source: "blazity.com",
              url,
              industry: meta.industry,
              problem_type: meta.problem_type,
              tech_stack: meta.tech_stack,
              key_metric: meta.key_metric,
              chunk_index: i,
              chunk_text: chunk.slice(0, 2000),
            },
          },
        ],
      });
      process.stdout.write("done\n");
    }

    seeded++;
  }

  console.log(`\nDone! Seeded ${seeded} case study/studies into Pinecone.`);
}

// ── CLI entry ────────────────────────────────────────────────────────────────

seedCaseStudies().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
