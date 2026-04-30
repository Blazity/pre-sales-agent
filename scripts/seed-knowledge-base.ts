/**
 * Seed the Pinecone knowledge base from two Google Drive folders:
 *
 *   1. GDRIVE_ESTIMATIONS_FOLDER_ID — Google Sheets with feature-level breakdowns
 *   2. GDRIVE_PROPOSALS_FOLDER_ID   — Google Docs with past proposals
 *
 * Each Sheet is parsed into structured records (summary + per-feature).
 * Each Doc is chunked (~800 words) and embedded as text.
 * Both are stored in separate Pinecone namespaces.
 *
 * Usage:
 *   npx tsx scripts/seed-knowledge-base.ts              # full re-index
 *   npx tsx scripts/seed-knowledge-base.ts --incremental # only new/modified files
 */

import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";
import fs from "fs";
import { parseEstimationSheet, normalizeFilename, type GridData } from "../src/lib/sheet-parser.js";

const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const PINECONE_INDEX = process.env.PINECONE_INDEX ?? "estimations";
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY!;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const ESTIMATIONS_FOLDER_ID = process.env.GDRIVE_ESTIMATIONS_FOLDER_ID!;
const PROPOSALS_FOLDER_ID = process.env.GDRIVE_PROPOSALS_FOLDER_ID!;

const CHUNK_WORDS = 800;
const CHUNK_OVERLAP_WORDS = 80;
const MIN_CHUNK_WORDS = 10;
const VOYAGE_RPM = parseInt(process.env.VOYAGE_RPM ?? "3", 10);
const VOYAGE_DELAY_MS = Math.ceil(60_000 / VOYAGE_RPM);
const INCREMENTAL = process.argv.includes("--incremental");
const STATE_FILE = ".seed-state.json";

// ── Helpers ──────────────────────────────────────────────────────────────────

let lastEmbeddingTime = 0;

const MAX_RETRIES = 5;

async function getEmbedding(text: string, retries = 0): Promise<number[]> {
  const elapsed = Date.now() - lastEmbeddingTime;
  if (lastEmbeddingTime > 0 && elapsed < VOYAGE_DELAY_MS) {
    const wait = VOYAGE_DELAY_MS - elapsed;
    process.stdout.write(`    (rate limit: waiting ${(wait / 1000).toFixed(0)}s) `);
    await new Promise((r) => setTimeout(r, wait));
  }

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-3", input: [text] }),
  });
  lastEmbeddingTime = Date.now();

  if (res.status === 429) {
    if (retries >= MAX_RETRIES) throw new Error("Voyage rate limit: max retries exceeded");
    const delay = 30_000 * 2 ** retries;
    process.stdout.write(`⏳ rate limited, retrying in ${(delay / 1000).toFixed(0)}s (${retries + 1}/${MAX_RETRIES})... `);
    await new Promise((r) => setTimeout(r, delay));
    return getEmbedding(text, retries + 1);
  }
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

// ── Google Auth ───────────────────────────────────────────────────────────────

async function getGoogleAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token error: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ── Google Drive ──────────────────────────────────────────────────────────────

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

async function listDriveFiles(folderId: string, accessToken: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime)",
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Drive list error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

// ── Google Sheets API ─────────────────────────────────────────────────────────

async function fetchSheetGridData(sheetId: string, accessToken: string): Promise<GridData> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?includeGridData=true&ranges=A:Z`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Sheets API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { sheets: Array<{ data: GridData[] }> };
  return data.sheets[0]?.data[0] ?? { rowData: [] };
}

// ── Google Docs API ───────────────────────────────────────────────────────────

async function fetchGoogleDocText(docId: string, accessToken: string): Promise<string> {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Docs API error ${res.status}: ${await res.text()}`);

  const doc = (await res.json()) as {
    body: {
      content: Array<{
        paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
        table?: {
          tableRows?: Array<{
            tableCells?: Array<{
              content?: Array<{
                paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
              }>;
            }>;
          }>;
        };
      }>;
    };
  };

  const lines: string[] = [];
  for (const block of doc.body.content) {
    if (block.paragraph?.elements) {
      const text = block.paragraph.elements
        .map((e) => e.textRun?.content ?? "")
        .join("")
        .trim();
      if (text) lines.push(text);
    }
    if (block.table?.tableRows) {
      for (const row of block.table.tableRows) {
        const cells = (row.tableCells ?? []).map((cell) =>
          (cell.content ?? [])
            .flatMap((p) => p.paragraph?.elements ?? [])
            .map((e) => e.textRun?.content ?? "")
            .join("")
            .trim(),
        );
        lines.push(cells.join(" | "));
      }
    }
  }
  return lines.join("\n");
}

// ── Pinecone ──────────────────────────────────────────────────────────────────

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
    await new Promise((r) => setTimeout(r, 10_000));
    console.log("Index ready.\n");
  }
}

// ── Incremental state ─────────────────────────────────────────────────────────

type SeedState = Record<string, string>; // fileId → modifiedTime

function loadState(): SeedState {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as SeedState;
}

function saveState(state: SeedState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function isModified(file: DriveFile, state: SeedState): boolean {
  return state[file.id] !== file.modifiedTime;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding Pinecone knowledge base from Google Drive\n");
  console.log(`Index: ${PINECONE_INDEX}`);
  console.log(`Mode: ${INCREMENTAL ? "incremental" : "full re-index"}\n`);

  if (!ESTIMATIONS_FOLDER_ID || !PROPOSALS_FOLDER_ID) {
    throw new Error("Missing GDRIVE_ESTIMATIONS_FOLDER_ID or GDRIVE_PROPOSALS_FOLDER_ID");
  }

  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  await ensureIndex(pc);
  const index = pc.index(PINECONE_INDEX);

  console.log("Fetching Google access token...");
  const accessToken = await getGoogleAccessToken();

  // ── List files ──────────────────────────────────────────────────────────────
  console.log("\n── Listing Drive folders ─────────────────────────────");
  const sheetFiles = await listDriveFiles(ESTIMATIONS_FOLDER_ID, accessToken);
  const docFiles = await listDriveFiles(PROPOSALS_FOLDER_ID, accessToken);
  console.log(`  Estimations folder: ${sheetFiles.length} file(s)`);
  console.log(`  Proposals folder: ${docFiles.length} file(s)`);

  // ── Build filename links ────────────────────────────────────────────────────
  const sheetNameMap = new Map(sheetFiles.map((f) => [normalizeFilename(f.name), f.id]));
  const docNameMap = new Map(docFiles.map((f) => [normalizeFilename(f.name), f.id]));

  // ── Incremental filtering ──────────────────────────────────────────────────
  const state = INCREMENTAL ? loadState() : {};
  const sheetsToProcess = INCREMENTAL
    ? sheetFiles.filter((f) => isModified(f, state))
    : sheetFiles;
  const docsToProcess = INCREMENTAL
    ? docFiles.filter((f) => isModified(f, state))
    : docFiles;

  if (INCREMENTAL) {
    console.log(`\n  Incremental: ${sheetsToProcess.length} new/modified sheet(s), ${docsToProcess.length} new/modified doc(s)`);
  }

  // ── Wipe namespaces (full mode only) ────────────────────────────────────────
  if (!INCREMENTAL) {
    console.log("\n── Wiping estimations + proposals + case_studies namespaces ────────");
    try {
      await index.namespace("estimations").deleteAll();
      console.log("  ✅ estimations namespace cleared");
    } catch {
      console.log("  ℹ️  estimations namespace empty or not found");
    }
    try {
      await index.namespace("proposals").deleteAll();
      console.log("  ✅ proposals namespace cleared");
    } catch {
      console.log("  ℹ️  proposals namespace empty or not found");
    }
    try {
      await index.namespace("case_studies").deleteAll();
      console.log("  ✅ case_studies namespace cleared");
    } catch {
      console.log("  ℹ️  case_studies namespace empty or not found");
    }
  }

  // ── Process Sheets ──────────────────────────────────────────────────────────
  console.log("\n── Google Sheets (Estimations) ──────────────────────");
  let sheetCount = 0;
  for (const file of sheetsToProcess) {
    if (!file.mimeType.includes("spreadsheet")) {
      console.log(`  ⚠️  Skipping non-Sheet file: ${file.name}`);
      continue;
    }

    console.log(`  📊 Sheet: "${file.name}"`);
    let gridData: GridData;
    try {
      gridData = await fetchSheetGridData(file.id, accessToken);
    } catch (err) {
      console.log(`    ⚠️  Skipping (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const parsed = parseEstimationSheet(file.name.replace(/\.[^.]+$/, ""), file.id, gridData);

    const linkedDocId = docNameMap.get(normalizeFilename(file.name)) ?? "";
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${file.id}/edit`;

    // Summary record
    process.stdout.write(`    summary... `);
    const summaryText = parsed.fullText || `${parsed.projectName} estimation`;
    const summaryEmbedding = await getEmbedding(summaryText);
    await index.namespace("estimations").upsert({ records: [{
      id: `sheet_${file.id}_summary`,
      values: summaryEmbedding,
      metadata: {
        type: "estimation_summary",
        project_name: parsed.projectName,
        total_hours: parsed.totalHours,
        total_cost_eur: parsed.totalCostEur,
        team_roles: parsed.teamRoles.join(", "),
        feature_count: parsed.features.length,
        sheet_id: file.id,
        sheet_url: sheetUrl,
        linked_proposal_id: linkedDocId,
        source: `gsheet:${file.id}`,
        chunk_text: summaryText.slice(0, 2000),
      },
    }] });
    console.log("✅");

    // Feature records
    for (let fi = 0; fi < parsed.features.length; fi++) {
      const feat = parsed.features[fi];
      process.stdout.write(`    feature ${fi + 1}/${parsed.features.length} "${feat.featureName}"... `);
      const featText = `Project: ${parsed.projectName}. Feature: ${feat.featureName}, ${feat.role}, ${feat.hours}h, €${feat.costEur}`;
      const featEmbedding = await getEmbedding(featText);
      await index.namespace("estimations").upsert({ records: [{
        id: `sheet_${file.id}_feat_${fi}`,
        values: featEmbedding,
        metadata: {
          type: "estimation_feature",
          project_name: parsed.projectName,
          feature_name: feat.featureName,
          role: feat.role,
          hours: feat.hours,
          cost_eur: feat.costEur,
          sheet_id: file.id,
          source: `gsheet:${file.id}`,
        },
      }] });
      console.log("✅");
    }

    state[file.id] = file.modifiedTime;
    sheetCount++;
  }

  // ── Process Docs ────────────────────────────────────────────────────────────
  console.log("\n── Google Docs (Proposals) ──────────────────────────");
  let docCount = 0;
  for (const file of docsToProcess) {
    if (!file.mimeType.includes("document")) {
      console.log(`  ⚠️  Skipping non-Doc file: ${file.name}`);
      continue;
    }

    const projectName = file.name.replace(/\.[^.]+$/, "");
    console.log(`  📝 Doc: "${file.name}"`);
    let text: string;
    try {
      text = await fetchGoogleDocText(file.id, accessToken);
    } catch (err) {
      console.log(`    ⚠️  Skipping (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    if (!text.trim()) {
      console.log("    ⚠️  Empty document, skipping.");
      continue;
    }

    const chunks = chunkText(text);
    console.log(`    ${chunks.length} chunk(s)`);

    const linkedSheetId = sheetNameMap.get(normalizeFilename(file.name)) ?? "";
    const docUrl = `https://docs.google.com/document/d/${file.id}/edit`;

    for (let i = 0; i < chunks.length; i++) {
      process.stdout.write(`    chunk ${i + 1}/${chunks.length}... `);
      const embedding = await getEmbedding(chunks[i]);
      await index.namespace("proposals").upsert({ records: [{
        id: `proposal_${file.id}_chunk${i}`,
        values: embedding,
        metadata: {
          type: "proposal",
          project_name: projectName,
          doc_id: file.id,
          doc_url: docUrl,
          linked_sheet_id: linkedSheetId,
          chunk_index: i,
          chunk_text: chunks[i].slice(0, 2000),
          source: `gdoc:${file.id}`,
        },
      }] });
      console.log("✅");
    }

    state[file.id] = file.modifiedTime;
    docCount++;
  }

  // ── Orphan cleanup (incremental only) ─────────────────────────────────────
  if (INCREMENTAL) {
    const currentFileIds = new Set([...sheetFiles.map((f) => f.id), ...docFiles.map((f) => f.id)]);
    const staleFileIds = Object.keys(state).filter((id) => !currentFileIds.has(id));

    if (staleFileIds.length > 0) {
      console.log(`\n── Cleaning up ${staleFileIds.length} stale file(s) ────────`);
      for (const fileId of staleFileIds) {
        const sheetIds = [`sheet_${fileId}_summary`, ...Array.from({ length: 50 }, (_, i) => `sheet_${fileId}_feat_${i}`)];
        const docIds = Array.from({ length: 50 }, (_, i) => `proposal_${fileId}_chunk${i}`);

        try { await index.namespace("estimations").deleteMany(sheetIds); } catch { /* ignore */ }
        try { await index.namespace("proposals").deleteMany(docIds); } catch { /* ignore */ }

        delete state[fileId];
        console.log(`  🗑️  Removed vectors for deleted file ${fileId}`);
      }
    }
  }

  // ── Save state ──────────────────────────────────────────────────────────────
  if (INCREMENTAL) {
    saveState(state);
    console.log(`\n  State saved to ${STATE_FILE}`);
  }

  console.log(`\n✅ Done! Seeded ${sheetCount} sheet(s) + ${docCount} doc(s) into Pinecone.`);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
