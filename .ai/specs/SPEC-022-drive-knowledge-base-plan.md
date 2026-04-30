# Google Drive Knowledge Base Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace repo-based `past-estimates/` with two Google Drive folders (Sheets for structured estimation data, Docs for proposal text) as the knowledge base source, enabling feature-level estimation queries and higher-quality output.

**Architecture:** Two Pinecone namespaces (`estimations` for structured Sheet data, `proposals` for Doc text chunks) within the existing index. A rewritten seeding script reads from Google Drive via Sheets API v4 and Docs API. A rewritten KB MCP server provides `search_past_estimations`, `search_past_proposals`, and `search_case_studies`. The orchestrator pipeline drops from 6 to 5 steps (Step 6 removed — KB is read-only).

**Tech Stack:** Pinecone, Voyage AI (voyage-3), Google Sheets API v4, Google Docs API v1, MCP SDK, Node.js built-in test runner.

**Design doc:** `.ai/specs/SPEC-022-drive-knowledge-base.md`

---

## Task 1: Add env vars to `.env.example`

**Files:**
- Modify: `.env.example`

**Step 1: Add the two folder ID env vars**

Add after the `GDRIVE_TEMPLATE_ID` line in `.env.example`:

```
# Knowledge Base — Google Drive source folders (read-only)
GDRIVE_ESTIMATIONS_FOLDER_ID=1EZtqhgiv5iWimdvvFr6cnh7kHIlh-97Q
GDRIVE_PROPOSALS_FOLDER_ID=1kz5QsErVaYp4Q7rf2LP0t-RizL-e_VcQ
```

**Step 2: Verify the file looks correct**

Read `.env.example` and confirm the new vars are in the right place.

**Step 3: Commit**

```bash
git add .env.example
git commit -m "feat(drive-kb): add estimation and proposal folder env vars"
```

---

## Task 2: Sheet parsing utility with tests

**Files:**
- Create: `src/lib/sheet-parser.ts`
- Create: `src/lib/sheet-parser.test.ts`

This is the riskiest piece — structured extraction from Google Sheets cell data. Build and test it in isolation before integrating.

**Step 1: Write the failing tests**

`src/lib/sheet-parser.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEstimationSheet, normalizeFilename } from "./sheet-parser.js";

describe("normalizeFilename()", () => {
  it("lowercases and strips punctuation", () => {
    assert.equal(normalizeFilename("Acme Corp — Proposal (2).pdf"), "acme corp proposal 2");
  });

  it("collapses whitespace", () => {
    assert.equal(normalizeFilename("  Foo   Bar  "), "foo bar");
  });
});

describe("parseEstimationSheet()", () => {
  it("parses a standard feature breakdown table", () => {
    const gridData = {
      rowData: [
        // Header row
        { values: [
          { formattedValue: "Feature" },
          { formattedValue: "Role" },
          { formattedValue: "Hours" },
          { formattedValue: "Rate (EUR/h)" },
          { formattedValue: "Cost (EUR)" },
        ]},
        // Data rows
        { values: [
          { formattedValue: "Authentication" },
          { formattedValue: "Senior Developer" },
          { formattedValue: "80" },
          { formattedValue: "85" },
          { formattedValue: "6800" },
        ]},
        { values: [
          { formattedValue: "CMS Integration" },
          { formattedValue: "Mid Developer" },
          { formattedValue: "40" },
          { formattedValue: "75" },
          { formattedValue: "3000" },
        ]},
        // Total row
        { values: [
          { formattedValue: "Total" },
          { formattedValue: "" },
          { formattedValue: "120" },
          { formattedValue: "" },
          { formattedValue: "9800" },
        ]},
      ],
    };

    const result = parseEstimationSheet("Acme Corp", "sheet123", gridData);

    assert.equal(result.projectName, "Acme Corp");
    assert.equal(result.sheetId, "sheet123");
    assert.equal(result.totalHours, 120);
    assert.equal(result.totalCostEur, 9800);
    assert.equal(result.features.length, 2);
    assert.deepEqual(result.features[0], {
      featureName: "Authentication",
      role: "Senior Developer",
      hours: 80,
      costEur: 6800,
    });
    assert.deepEqual(result.teamRoles, ["Senior Developer", "Mid Developer"]);
  });

  it("detects header row by column name patterns", () => {
    const gridData = {
      rowData: [
        // Metadata row (not the header)
        { values: [
          { formattedValue: "Project: Acme" },
          { formattedValue: "" },
        ]},
        // Actual header
        { values: [
          { formattedValue: "Task" },
          { formattedValue: "Role" },
          { formattedValue: "Hrs" },
          { formattedValue: "Rate" },
          { formattedValue: "Cost" },
        ]},
        { values: [
          { formattedValue: "API Layer" },
          { formattedValue: "Architect" },
          { formattedValue: "20" },
          { formattedValue: "120" },
          { formattedValue: "2400" },
        ]},
      ],
    };

    const result = parseEstimationSheet("Acme", "s1", gridData);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].featureName, "API Layer");
  });

  it("skips subtotal and total rows", () => {
    const gridData = {
      rowData: [
        { values: [
          { formattedValue: "Feature" },
          { formattedValue: "Role" },
          { formattedValue: "Hours" },
          { formattedValue: "Rate" },
          { formattedValue: "Cost" },
        ]},
        { values: [
          { formattedValue: "Auth" },
          { formattedValue: "Senior Developer" },
          { formattedValue: "40" },
          { formattedValue: "85" },
          { formattedValue: "3400" },
        ]},
        { values: [
          { formattedValue: "Subtotal" },
          { formattedValue: "" },
          { formattedValue: "40" },
          { formattedValue: "" },
          { formattedValue: "3400" },
        ]},
        { values: [
          { formattedValue: "PM Overhead (10%)" },
          { formattedValue: "" },
          { formattedValue: "" },
          { formattedValue: "" },
          { formattedValue: "340" },
        ]},
        { values: [
          { formattedValue: "Total" },
          { formattedValue: "" },
          { formattedValue: "40" },
          { formattedValue: "" },
          { formattedValue: "3740" },
        ]},
      ],
    };

    const result = parseEstimationSheet("X", "s2", gridData);
    assert.equal(result.features.length, 1);
    assert.equal(result.totalCostEur, 3740);
  });

  it("returns empty features for a sheet with no detectable header", () => {
    const gridData = {
      rowData: [
        { values: [{ formattedValue: "Random text" }, { formattedValue: "More text" }] },
      ],
    };

    const result = parseEstimationSheet("X", "s3", gridData);
    assert.equal(result.features.length, 0);
    assert.equal(result.totalHours, 0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx tsx --test src/lib/sheet-parser.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement `sheet-parser.ts`**

`src/lib/sheet-parser.ts`:

```typescript
export interface SheetFeature {
  featureName: string;
  role: string;
  hours: number;
  costEur: number;
}

export interface ParsedEstimation {
  projectName: string;
  sheetId: string;
  totalHours: number;
  totalCostEur: number;
  features: SheetFeature[];
  teamRoles: string[];
  fullText: string;
}

interface CellValue {
  formattedValue?: string;
}

interface RowData {
  values?: CellValue[];
}

export interface GridData {
  rowData?: RowData[];
}

const HEADER_PATTERNS: Record<string, RegExp> = {
  feature: /^(feature|task|module|item|scope)/i,
  role: /^role/i,
  hours: /^(hours?|hrs?|effort)/i,
  rate: /^rate/i,
  cost: /^(cost|price|total|amount|eur)/i,
};

const SKIP_ROW_PATTERNS = /^(total|subtotal|sub-total|pm overhead|overhead|grand total|sum)/i;

function cellText(cell?: CellValue): string {
  return (cell?.formattedValue ?? "").trim();
}

function cellNumber(cell?: CellValue): number {
  const raw = cellText(cell).replace(/[^0-9.-]/g, "");
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

function detectHeaderRow(rows: RowData[]): { index: number; columns: Record<string, number> } | null {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].values ?? [];
    const columns: Record<string, number> = {};

    for (let j = 0; j < cells.length; j++) {
      const text = cellText(cells[j]);
      for (const [key, pattern] of Object.entries(HEADER_PATTERNS)) {
        if (pattern.test(text) && !(key in columns)) {
          columns[key] = j;
        }
      }
    }

    // Need at least feature + hours OR feature + cost to be a valid header
    if ("feature" in columns && ("hours" in columns || "cost" in columns)) {
      return { index: i, columns };
    }
  }

  return null;
}

export function parseEstimationSheet(
  projectName: string,
  sheetId: string,
  gridData: GridData,
): ParsedEstimation {
  const rows = gridData.rowData ?? [];
  const header = detectHeaderRow(rows);

  if (!header) {
    const fullText = rows
      .map((r) => (r.values ?? []).map(cellText).filter(Boolean).join(" | "))
      .filter(Boolean)
      .join("\n");
    return { projectName, sheetId, totalHours: 0, totalCostEur: 0, features: [], teamRoles: [], fullText };
  }

  const features: SheetFeature[] = [];
  let totalHours = 0;
  let totalCostEur = 0;
  const roles = new Set<string>();
  const textLines: string[] = [];

  for (let i = header.index + 1; i < rows.length; i++) {
    const cells = rows[i].values ?? [];
    const featureText = cellText(cells[header.columns.feature]);

    if (!featureText) continue;

    // Build full text regardless
    textLines.push((cells).map(cellText).filter(Boolean).join(" | "));

    // Check for total/subtotal rows — extract totals but don't add as features
    if (SKIP_ROW_PATTERNS.test(featureText)) {
      const rowHours = header.columns.hours !== undefined ? cellNumber(cells[header.columns.hours]) : 0;
      const rowCost = header.columns.cost !== undefined ? cellNumber(cells[header.columns.cost]) : 0;
      if (/^total$/i.test(featureText) || /^grand total$/i.test(featureText)) {
        totalHours = rowHours || totalHours;
        totalCostEur = rowCost || totalCostEur;
      }
      continue;
    }

    const role = header.columns.role !== undefined ? cellText(cells[header.columns.role]) : "";
    const hours = header.columns.hours !== undefined ? cellNumber(cells[header.columns.hours]) : 0;
    const costEur = header.columns.cost !== undefined ? cellNumber(cells[header.columns.cost]) : 0;

    if (role) roles.add(role);
    features.push({ featureName: featureText, role, hours, costEur });
  }

  // If no explicit total row, sum from features
  if (totalHours === 0) totalHours = features.reduce((sum, f) => sum + f.hours, 0);
  if (totalCostEur === 0) totalCostEur = features.reduce((sum, f) => sum + f.costEur, 0);

  // Add header to text
  const headerText = (rows[header.index].values ?? []).map(cellText).filter(Boolean).join(" | ");
  const fullText = `${projectName}\n\n${headerText}\n${textLines.join("\n")}`;

  return {
    projectName,
    sheetId,
    totalHours,
    totalCostEur,
    features,
    teamRoles: [...roles],
    fullText,
  };
}

export function normalizeFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")           // strip extension
    .replace(/[^\w\s]/g, " ")          // punctuation → space
    .replace(/\s+/g, " ")             // collapse whitespace
    .trim()
    .toLowerCase();
}
```

**Step 4: Run tests to verify they pass**

```bash
npx tsx --test src/lib/sheet-parser.test.ts
```

Expected: All tests PASS.

**Step 5: Type-check**

```bash
npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add src/lib/sheet-parser.ts src/lib/sheet-parser.test.ts
git commit -m "feat(drive-kb): add sheet parser with structured extraction"
```

---

## Task 3: Rewrite seeding script

**Files:**
- Rewrite: `scripts/seed-knowledge-base.ts`

**Step 1: Rewrite the seeding script**

Replace the entire file. Key changes from the old version:
- Sources from two Drive folders instead of `past-estimates/`
- Uses Google Sheets API v4 for structured cell extraction (not just text export)
- Uses Google Docs API v1 for proposal text (reuses existing paragraph + table parsing logic)
- Writes to two namespaces: `estimations` and `proposals`
- Wipes both namespaces before seeding (case studies untouched in default namespace)
- Links Sheets ↔ Docs by normalized filename
- Supports `--incremental` flag via `.seed-state.json`
- No `pdf-parse` dependency

`scripts/seed-knowledge-base.ts`:

```typescript
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
const VOYAGE_RPM = parseInt(process.env.VOYAGE_RPM ?? "3", 10);
const VOYAGE_DELAY_MS = Math.ceil(60_000 / VOYAGE_RPM);
const INCREMENTAL = process.argv.includes("--incremental");
const STATE_FILE = ".seed-state.json";

// ── Helpers ──────────────────────────────────────────────────────────────────

let lastEmbeddingTime = 0;

async function getEmbedding(text: string): Promise<number[]> {
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
    process.stdout.write("⏳ rate limited, retrying in 30s... ");
    await new Promise((r) => setTimeout(r, 30_000));
    return getEmbedding(text);
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
    if (chunk.trim()) chunks.push(chunk.trim());
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
    console.log("\n── Wiping estimations + proposals namespaces ────────");
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
    const gridData = await fetchSheetGridData(file.id, accessToken);
    const parsed = parseEstimationSheet(file.name.replace(/\.[^.]+$/, ""), file.id, gridData);

    const linkedDocId = docNameMap.get(normalizeFilename(file.name)) ?? "";
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${file.id}/edit`;

    // Summary record
    process.stdout.write(`    summary... `);
    const summaryText = parsed.fullText || `${parsed.projectName} estimation`;
    const summaryEmbedding = await getEmbedding(summaryText);
    await index.namespace("estimations").upsert([{
      id: `sheet_${file.id}_summary`,
      values: summaryEmbedding,
      metadata: {
        type: "estimation_summary",
        project_name: parsed.projectName,
        total_hours: parsed.totalHours,
        total_cost_eur: parsed.totalCostEur,
        duration_weeks: 0,
        tech_stack: "",
        team_roles: parsed.teamRoles.join(", "),
        feature_count: parsed.features.length,
        sheet_id: file.id,
        sheet_url: sheetUrl,
        linked_proposal_id: linkedDocId,
        source: `gsheet:${file.id}`,
        chunk_text: summaryText.slice(0, 2000),
      },
    }]);
    console.log("✅");

    // Feature records
    for (let fi = 0; fi < parsed.features.length; fi++) {
      const feat = parsed.features[fi];
      process.stdout.write(`    feature ${fi + 1}/${parsed.features.length} "${feat.featureName}"... `);
      const featText = `Project: ${parsed.projectName}. Feature: ${feat.featureName}, ${feat.role}, ${feat.hours}h, €${feat.costEur}`;
      const featEmbedding = await getEmbedding(featText);
      await index.namespace("estimations").upsert([{
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
      }]);
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
    const text = await fetchGoogleDocText(file.id, accessToken);
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
      await index.namespace("proposals").upsert([{
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
      }]);
      console.log("✅");
    }

    state[file.id] = file.modifiedTime;
    docCount++;
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
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

**Step 3: Add `.seed-state.json` to `.gitignore`**

Check if `.gitignore` exists. Add `.seed-state.json` to it.

**Step 4: Commit**

```bash
git add scripts/seed-knowledge-base.ts .gitignore
git commit -m "feat(drive-kb): rewrite seeding script for Drive-sourced KB"
```

---

## Task 4: Rewrite Knowledge Base MCP server

**Files:**
- Rewrite: `src/mcp-servers/knowledge-base.ts`
- Rewrite: `src/mcp-servers/knowledge-base.test.ts`

**Step 1: Write failing tests**

`src/mcp-servers/knowledge-base.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const REQUIRED_ENV_VARS: Record<string, string> = {
  PINECONE_API_KEY: "test-key",
  VOYAGE_API_KEY: "test-key",
};
for (const [k, v] of Object.entries(REQUIRED_ENV_VARS)) {
  if (!process.env[k]) process.env[k] = v;
}

const { buildCaseStudyFilter, formatEstimationResults } = await import("./knowledge-base.js");

describe("buildCaseStudyFilter()", () => {
  it("returns type=case_study filter with no extra params", () => {
    const filter = buildCaseStudyFilter();
    assert.deepEqual(filter, { type: { $eq: "case_study" } });
  });

  it("adds industry filter when provided", () => {
    const filter = buildCaseStudyFilter("e-commerce");
    assert.deepEqual(filter, {
      $and: [
        { type: { $eq: "case_study" } },
        { industry: { $eq: "e-commerce" } },
      ],
    });
  });

  it("combines both filters with $and", () => {
    const filter = buildCaseStudyFilter("saas", "modernization");
    assert.deepEqual(filter, {
      $and: [
        { type: { $eq: "case_study" } },
        { industry: { $eq: "saas" } },
        { problem_type: { $eq: "modernization" } },
      ],
    });
  });
});

describe("formatEstimationResults()", () => {
  it("groups features under their project summary", () => {
    const matches = [
      {
        id: "sheet_abc_summary",
        score: 0.92,
        metadata: {
          type: "estimation_summary",
          project_name: "Acme Corp",
          total_hours: 200,
          total_cost_eur: 17000,
          team_roles: "Senior Developer, Architect",
          feature_count: 5,
          sheet_url: "https://sheets/abc",
          linked_proposal_id: "doc123",
        },
      },
      {
        id: "sheet_abc_feat_0",
        score: 0.88,
        metadata: {
          type: "estimation_feature",
          project_name: "Acme Corp",
          feature_name: "Auth",
          role: "Senior Developer",
          hours: 80,
          cost_eur: 6800,
          sheet_id: "abc",
        },
      },
    ];

    const result = formatEstimationResults(matches);
    assert.ok(result.includes("Acme Corp"));
    assert.ok(result.includes("200h"));
    assert.ok(result.includes("€17,000"));
    assert.ok(result.includes("Auth"));
    assert.ok(result.includes("80h"));
  });

  it("returns fallback message for empty matches", () => {
    const result = formatEstimationResults([]);
    assert.ok(result.includes("No matching"));
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx tsx --test src/mcp-servers/knowledge-base.test.ts
```

Expected: FAIL — `formatEstimationResults` not exported.

**Step 3: Rewrite `knowledge-base.ts`**

`src/mcp-servers/knowledge-base.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Pinecone } from "@pinecone-database/pinecone";
import { z } from "zod";
import { config } from "dotenv";
config();

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const INDEX_NAME = process.env.PINECONE_INDEX ?? "estimations";

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-3", input: [text] }),
  });
  if (!res.ok) throw new Error(`Voyage API error: ${res.statusText}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
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
): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [{ type: { $eq: "case_study" } }];
  if (industry) conditions.push({ industry: { $eq: industry } });
  if (problem_type) conditions.push({ problem_type: { $eq: problem_type } });
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
    filter_tech: z.string().optional().describe("Filter by tech stack (e.g., 'React')"),
    filter_role: z.string().optional().describe("Filter by role (e.g., 'Senior Developer')"),
  },
  async ({ query, top_k, filter_tech, filter_role }) => {
    try {
      const embedding = await getEmbedding(query);
      const index = pinecone.index(INDEX_NAME);

      // Build filter for metadata
      const conditions: Record<string, unknown>[] = [];
      if (filter_tech) conditions.push({ tech_stack: { $eq: filter_tech } });
      if (filter_role) conditions.push({ role: { $eq: filter_role } });
      const filter = conditions.length > 0
        ? conditions.length === 1 ? conditions[0] : { $and: conditions }
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
          text: formatEstimationResults(results.matches as MatchRecord[]),
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

      const formatted = results.matches
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
  "Search Blazity case studies by relevance, industry, or problem type. Returns structured results with client name, metrics, tech stack, and URL.",
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
      const results = await index.query({
        vector: embedding,
        topK: top_k,
        includeMetadata: true,
        filter,
      });

      const formatted = results.matches
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
```

**Step 4: Run tests**

```bash
npx tsx --test src/mcp-servers/knowledge-base.test.ts
```

Expected: All PASS.

**Step 5: Type-check**

```bash
npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add src/mcp-servers/knowledge-base.ts src/mcp-servers/knowledge-base.test.ts
git commit -m "feat(drive-kb): rewrite KB MCP server with estimation and proposal tools"
```

---

## Task 5: Update orchestrator pipeline

**Files:**
- Modify: `src/agents/orchestrator.ts`

This task makes 5 targeted changes to the orchestrator. Each is a precise edit.

**Step 1: Update STEP_NAMES (line 15)**

Change:
```typescript
const STEP_NAMES = ["Initializing", "Analysis", "Clarification", "Value Discovery", "Offer", "Presentation", "Knowledge Base"] as const;
```
To:
```typescript
const STEP_NAMES = ["Initializing", "Analysis", "Clarification", "Value Discovery", "Offer", "Presentation"] as const;
```

**Step 2: Update TOOL_TO_STEP map (lines 17-31)**

Replace with:
```typescript
const TOOL_TO_STEP: Record<string, number> = {
  search_past_estimations: 1,
  search_past_proposals: 1,
  search_case_studies: 1,
  wait_for_reply: 2,
  docs_create_document: 4,
  docs_find_and_replace: 4,
  docs_write_sections: 4,
  create_presentation: 5,
  add_slide: 5,
  set_client_logo: 5,
  add_timeline_data: 5,
  add_pricing_block: 5,
  cleanup_template_slides: 5,
};
```

**Step 3: Update system prompt — KB description (line 92)**

Change the knowledge-base description in the system prompt from:
```
- knowledge-base MCP: search past projects, search Blazity case studies (with industry/problem_type filters), store new estimations
```
To:
```
- knowledge-base MCP: search past estimations (structured effort/cost data from Google Sheets), search past proposals (reference text from Google Docs), search Blazity case studies (with industry/problem_type filters)
```

**Step 4: Rewrite Step 1 instructions in the prompt (lines 281-299)**

Replace the Step 1 block with:
```
## Step 1: Analyze the RFP
1. Call search_past_estimations with the core project description (3-5 word query).
   Study the results carefully — these are REAL past project costs and timelines.
   Use them to CALIBRATE your estimate: if a similar project took 200h, your estimate
   should be in that ballpark unless scope differs significantly. Note specific feature
   hours for comparable features (e.g., "auth took 80h in Acme project").
2. Call search_past_proposals with the project description.
   Study the writing style, section depth, tone, and how pricing/timeline are presented.
   Use this as a reference for how to write the offer in Step 4.
3. Search for relevant Blazity case studies using search_case_studies. Use the
   RFP's industry and problem type as filters. Note the most relevant case study for Step 4.
4. Analyze the RFP internally: scope, tech stack, complexity, timeline, risks.
   Do NOT post assumptions or unknowns here — save those for Step 2.
5. Post a CONCISE summary to Slack using blocks. Use this exact Block Kit structure:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "📋 RFP Analysis"}},
  {"type": "section", "fields": [
    {"type": "mrkdwn", "text": "*Client:*\n[who they are — 1 line]"},
    {"type": "mrkdwn", "text": "*Project:*\n[what they need — 1 line]"},
    {"type": "mrkdwn", "text": "*Tech Stack:*\n[technologies, comma-separated]"},
    {"type": "mrkdwn", "text": "*Complexity:*\n[Low / Medium / High — 1 line reason]"},
    {"type": "mrkdwn", "text": "*Estimate:*\n[€XX,000 – €XX,000 · X–Y weeks]"},
    {"type": "mrkdwn", "text": "*Similar Work:*\n[past project + key metric, or 'none found']"}
  ]}
]
```

**Step 5: Remove Step 6 entirely (lines 658-673)**

Delete the entire `## Step 6: Store in Knowledge Base` block. Move the completion Slack message to the end of Step 5. The completion message should be posted after the presentation is ready:

```
6. Post a final completion message to Slack using blocks:

blocks: [
  {"type": "header", "text": {"type": "plain_text", "text": "✅ Estimation Complete"}},
  {"type": "divider"},
  {"type": "section", "fields": [
    {"type": "mrkdwn", "text": "*📄 Offer:*\n<GOOGLE_DOC_URL|View Document>"},
    {"type": "mrkdwn", "text": "*🎨 Presentation:*\n<GOOGLE_SLIDES_URL|View Slides>"}
  ]},
  {"type": "context", "elements": [{"type": "mrkdwn", "text": "Both documents are in the shared Google Drive folder."}]}
]
text: "✅ Estimation complete — offer and presentation ready"
```

**Step 6: Update allowedTools array (lines 752-774)**

Replace:
```typescript
"mcp__knowledge-base__search_similar_projects",
"mcp__knowledge-base__search_case_studies",
"mcp__knowledge-base__store_estimation",
```
With:
```typescript
"mcp__knowledge-base__search_past_estimations",
"mcp__knowledge-base__search_past_proposals",
"mcp__knowledge-base__search_case_studies",
```

**Step 7: Update Step 4 PREPARATION (lines 397-402)**

The current Step 4 says to check if similar projects have a Google Doc URL from `search_similar_projects` metadata. Update this to reference the new tools:

Change:
```
PREPARATION:
1. From the similar projects found in Step 1, check if any have a Google Doc URL in their metadata
```
To:
```
PREPARATION:
1. From the proposals found via search_past_proposals in Step 1, check if any are highly relevant (score > 0.8)
```

**Step 8: Remove `store_estimation` from `skipSteps` handling**

In lines 265-267, remove:
```typescript
if (job.skipSteps?.includes("knowledge_base")) {
  skipInstructions.push("SKIP Step 6 entirely — do not call store_estimation.");
}
```

Also remove `"knowledge_base"` from the `skipSteps` type in `EstimationJob` interface (line 57):
```typescript
skipSteps?: ("presentation" | "slack" | "value_discovery")[];
```

**Step 9: Type-check**

```bash
npx tsc --noEmit
```

**Step 10: Run all tests**

```bash
npm test
```

**Step 11: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(drive-kb): update orchestrator to 5-step pipeline with new KB tools"
```

---

## Task 6: Cleanup — remove legacy, update deps and docs

**Files:**
- Delete: `past-estimates/` directory
- Modify: `package.json`
- Modify: `.ai/architecture.md`
- Modify: `.ai/mcp-tools.md`

**Step 1: Delete `past-estimates/` directory**

```bash
rm -rf past-estimates/
```

**Step 2: Remove `pdf-parse` from dependencies**

In `package.json`, remove these lines:
- From `dependencies`: `"pdf-parse": "^1.1.1",`
- From `devDependencies`: `"@types/pdf-parse": "^1.1.5",`

Then run:
```bash
npm install
```

**Step 3: Update `.ai/architecture.md`**

Replace the Pipeline Stages table with:

```markdown
## Pipeline Stages

| Stage | MCP Server | Tools | Purpose |
|-------|-----------|-------|---------|
| 1. Analysis | knowledge-base | `search_past_estimations`, `search_past_proposals`, `search_case_studies` | Structured estimation search + proposal text search + case studies via Pinecone |
| 2. Clarification | slack-interaction | `wait_for_reply` | Posts questions to Slack, polls for human response (up to 15 min) |
| 3. Value Discovery | web-research | `fetch_web_page` | Research client business and industry benchmarks |
| 4. Offer | google-workspace | `docs_copy_template`, `docs_write_sections` | Clones Google Doc template, fills sections |
| 5. Presentation | google-slides | `create_presentation`, `add_slide`, `set_client_logo`, `add_timeline_data`, `add_pricing_block` | Clones Google Slides template, builds branded deck |
```

Update the Key Files table — change the seed script description:
```
| `scripts/seed-knowledge-base.ts` | Seeds Pinecone from Google Drive (Sheets + Docs) |
```

**Step 4: Update `.ai/mcp-tools.md`**

Replace the `## knowledge-base` section:

```markdown
## knowledge-base

| Tool | Description |
|------|-------------|
| `search_past_estimations` | Search past estimations (Google Sheets) for structured effort/cost data with optional tech/role filters |
| `search_past_proposals` | Search past proposals (Google Docs) for writing reference text chunks |
| `search_case_studies` | Search Blazity case studies with optional industry/problem_type filters |
```

**Step 5: Type-check and test**

```bash
npx tsc --noEmit && npm test
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(drive-kb): remove past-estimates, pdf-parse dep, update docs"
```

---

## Task 7: Update CLAUDE.md and lessons

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.ai/lessons.md`

**Step 1: Update CLAUDE.md**

In the Workflow section, update the pipeline description. Change:
```
6. **Knowledge Base** — store estimation summary in Pinecone
```
Remove that line entirely. The workflow becomes:
```
1. **Analysis** — KB search + web research on the RFP
2. **Clarification** — ask follow-up questions via Slack (skippable)
3. **Value Discovery** — research client business for value-based pricing
4. **Offer** — create Google Doc from template, fill sections
5. **Presentation** — create Google Slides deck
```

In the Commands section, update `npm run seed` comment:
```bash
npm run seed       # seed Pinecone from Google Drive (Sheets + Docs)
```

In the References section, add the env vars note if not present.

**Step 2: Add lesson to `.ai/lessons.md`**

Append:

```markdown
---

### KB folders are read-only — agent never writes to them

**Context:** The knowledge base is sourced from two manually-curated Google Drive folders (Sheets for estimations, Docs for proposals).
**Problem:** If the agent writes to these folders or auto-stores estimations in Pinecone, it pollutes the curated knowledge base with unreviewed data.
**Rule:** The agent NEVER writes to `GDRIVE_ESTIMATIONS_FOLDER_ID` or `GDRIVE_PROPOSALS_FOLDER_ID`. The `store_estimation` tool was removed. New entries are added manually by the team, then indexed via `npm run seed`.
**Recovery:** If bad data appears in Pinecone, run `npm run seed` to wipe and rebuild from the curated Drive folders.
**Applies to:** `src/mcp-servers/knowledge-base.ts`, `src/agents/orchestrator.ts`, `scripts/seed-knowledge-base.ts`.
```

**Step 3: Commit**

```bash
git add CLAUDE.md .ai/lessons.md
git commit -m "feat(drive-kb): update CLAUDE.md and lessons for Drive KB"
```

---

## Task 8: End-to-end verification

**Step 1: Set env vars**

Verify `.env` has both folder IDs:
```
GDRIVE_ESTIMATIONS_FOLDER_ID=1EZtqhgiv5iWimdvvFr6cnh7kHIlh-97Q
GDRIVE_PROPOSALS_FOLDER_ID=1kz5QsErVaYp4Q7rf2LP0t-RizL-e_VcQ
```

**Step 2: Run full seed**

```bash
npm run seed
```

Verify:
- No errors
- Sheets parsed with correct feature counts
- Docs chunked
- Filename-based linking detected where applicable

**Step 3: Run all tests**

```bash
npm test
```

All tests must pass.

**Step 4: Type-check**

```bash
npx tsc --noEmit
```

**Step 5: Update spec status**

In `.ai/specs/SPEC-022-drive-knowledge-base.md`, check off completed items.
In `.ai/specs/README.md`, update status to "Implemented".

**Step 6: Final commit**

```bash
git add .ai/specs/
git commit -m "feat(drive-kb): mark SPEC-022 implemented"
```
