/**
 * Knowledge-base seeding doctor.
 *
 * Usage:
 *   npm run doctor:seed
 *   npm run doctor:seed -- --offline
 */
import "dotenv/config";

import {
  classifySeedEnv,
  hasBlockingFailures,
  isDriveFolderPayload,
  result,
  summarizeResults,
  summarizeSeedSourceFiles,
  type DoctorResult,
  type DoctorStatus,
  type SeedSourceKind,
} from "../src/onboarding/doctor.js";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { ok: response.ok, status: response.status, body, text };
}

async function getGoogleAccessToken(): Promise<string> {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  const refreshToken = env("GOOGLE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google OAuth env vars missing");
  }

  const response = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) throw new Error(`Google token refresh failed with HTTP ${response.status}`);
  const accessToken = (response.body as { access_token?: string } | undefined)?.access_token;
  if (!accessToken) throw new Error("Google token response did not include access_token");
  return accessToken;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

async function listDriveFiles(folderId: string, accessToken: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetchJson(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Drive list returned HTTP ${response.status}`);
    const body = response.body as { files?: DriveFile[]; nextPageToken?: string } | undefined;
    files.push(...(body?.files ?? []));
    pageToken = body?.nextPageToken;
  } while (pageToken);

  return files;
}

async function checkDriveSource(
  accessToken: string,
  label: string,
  idName: string,
  expectedKind: SeedSourceKind,
): Promise<DoctorResult[]> {
  const folderId = env(idName);
  if (!folderId) return [result("FAIL", "Google Drive", label, `${idName} missing`)];

  const metadataResponse = await fetchJson(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metadataResponse.ok) {
    return [result("FAIL", "Google Drive", label, `Metadata request returned HTTP ${metadataResponse.status}`)];
  }
  if (!isDriveFolderPayload(metadataResponse.body)) {
    return [result("FAIL", "Google Drive", label, `${idName} points to a file, not a folder`)];
  }

  try {
    const files = await listDriveFiles(folderId, accessToken);
    const summary = summarizeSeedSourceFiles(files, expectedKind);
    const nativeLabel = expectedKind === "spreadsheet" ? "native Google Sheet" : "native Google Doc";
    const unsupported = summary.unsupported > 0 ? `; ${summary.unsupported} unsupported item(s) will be skipped` : "";
    const status: DoctorStatus = summary.seedable > 0 ? "PASS" : "WARN";
    return [
      result(
        status,
        "Google Drive",
        label,
        `${summary.seedable}/${summary.total} ${nativeLabel}(s) seedable${unsupported}`,
      ),
    ];
  } catch (err) {
    return [result("FAIL", "Google Drive", label, err instanceof Error ? err.message : String(err))];
  }
}

async function checkGoogle(): Promise<DoctorResult[]> {
  try {
    const accessToken = await getGoogleAccessToken();
    return [
      result("PASS", "Google", "OAuth refresh", "Refresh token produced an access token"),
      ...await checkDriveSource(accessToken, "Estimations source folder", "GDRIVE_ESTIMATIONS_FOLDER_ID", "spreadsheet"),
      ...await checkDriveSource(accessToken, "Proposals source folder", "GDRIVE_PROPOSALS_FOLDER_ID", "document"),
    ];
  } catch (err) {
    return [result("FAIL", "Google", "OAuth refresh", err instanceof Error ? err.message : String(err))];
  }
}

async function checkPinecone(): Promise<DoctorResult[]> {
  const apiKey = env("PINECONE_API_KEY");
  if (!apiKey) return [result("FAIL", "Pinecone", "API key", "PINECONE_API_KEY missing")];

  const indexName = env("PINECONE_INDEX") ?? "estimations";
  try {
    const response = await fetchJson("https://api.pinecone.io/indexes", {
      headers: { "Api-Key": apiKey, "X-Pinecone-API-Version": "2025-04" },
    });
    if (!response.ok) {
      return [result("FAIL", "Pinecone", "API key", `Pinecone returned HTTP ${response.status}`)];
    }

    const indexes = (response.body as { indexes?: Array<{ name?: string; dimension?: number; metric?: string }> } | undefined)?.indexes ?? [];
    const index = indexes.find((item) => item.name === indexName);
    if (!index) {
      return [
        result("PASS", "Pinecone", "API key", "Can list indexes"),
        result("WARN", "Pinecone", "Index", `"${indexName}" does not exist yet; npm run seed will try to create it`),
      ];
    }
    if (index.dimension !== 1024 || index.metric !== "cosine") {
      return [
        result("PASS", "Pinecone", "API key", "Can list indexes"),
        result("FAIL", "Pinecone", "Index", `"${indexName}" is ${index.dimension ?? "unknown"} dimensions/${index.metric ?? "unknown"} metric; expected 1024/cosine`),
      ];
    }

    return [
      result("PASS", "Pinecone", "API key", "Can list indexes"),
      result("PASS", "Pinecone", "Index", `"${indexName}" exists with 1024 dimensions and cosine metric`),
    ];
  } catch (err) {
    return [result("FAIL", "Pinecone", "API key", err instanceof Error ? err.message : String(err))];
  }
}

async function checkVoyage(): Promise<DoctorResult> {
  const apiKey = env("VOYAGE_API_KEY");
  if (!apiKey) return result("FAIL", "Voyage", "API key", "VOYAGE_API_KEY missing");

  try {
    const response = await fetchJson("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "voyage-3", input: ["seed doctor"] }),
    });
    if (!response.ok) return result("FAIL", "Voyage", "Embedding", `Voyage returned HTTP ${response.status}`);
    return result("PASS", "Voyage", "Embedding", "voyage-3 embedding request succeeded");
  } catch (err) {
    return result("FAIL", "Voyage", "Embedding", err instanceof Error ? err.message : String(err));
  }
}

function printResults(results: DoctorResult[]): void {
  const groups = [...new Set(results.map((item) => item.group))];
  for (const group of groups) {
    console.log(`\n${group}`);
    for (const item of results.filter((resultItem) => resultItem.group === group)) {
      console.log(`  ${item.status} ${item.label}: ${item.message}`);
    }
  }

  const summary = summarizeResults(results);
  console.log(`\nSummary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail`);
}

async function main(): Promise<void> {
  const offline = hasFlag("--offline");
  const results: DoctorResult[] = [
    ...classifySeedEnv(process.env),
  ];

  if (offline) {
    results.push(result("WARN", "Network", "Live provider checks", "Skipped because --offline was provided"));
  } else {
    results.push(...await checkGoogle());
    results.push(...await checkPinecone());
    results.push(await checkVoyage());
  }

  printResults(results);
  process.exitCode = hasBlockingFailures(results) ? 1 : 0;
}

main().catch((err) => {
  console.error(`doctor:seed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
