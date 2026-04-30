/**
 * Creates starter Google Docs and Sheets templates in the user's Drive.
 *
 * Usage:
 *   npm run setup:google-templates
 *   npm run setup:google-templates -- --folder-id <GDRIVE_ROOT_FOLDER_ID>
 *
 * Required env:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *
 * Optional env:
 *   GDRIVE_ROOT_FOLDER_ID
 *   AGENCY_PROFILE_PATH
 */
import "dotenv/config";

import { loadAgencyProfile } from "../src/config/agency-profile.js";
import {
  buildEstimationSheetTemplatePlan,
  buildOfferTemplatePlan,
  type GoogleApiRequest,
} from "../src/templates/google-templates.js";

const GOOGLE_CLIENT_ID = requireEnv("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = requireEnv("GOOGLE_CLIENT_SECRET");
const GOOGLE_REFRESH_TOKEN = requireEnv("GOOGLE_REFRESH_TOKEN");

interface DriveFile {
  id: string;
  webViewLink?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function getAccessToken(): Promise<string> {
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
  return ((await res.json()) as { access_token: string }).access_token;
}

async function googleFetch(
  token: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function createDriveFile(
  token: string,
  params: { name: string; mimeType: string; parentFolderId: string },
): Promise<DriveFile> {
  const res = await googleFetch(
    token,
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink",
    {
      method: "POST",
      body: JSON.stringify({
        name: params.name,
        mimeType: params.mimeType,
        parents: [params.parentFolderId],
      }),
    },
  );
  if (!res.ok) throw new Error(`Drive create failed: ${await res.text()}`);
  return (await res.json()) as DriveFile;
}

async function batchUpdateDoc(
  token: string,
  documentId: string,
  requests: GoogleApiRequest[],
): Promise<void> {
  const res = await googleFetch(
    token,
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    { method: "POST", body: JSON.stringify({ requests }) },
  );
  if (!res.ok) throw new Error(`Docs template update failed: ${await res.text()}`);
}

async function getFirstSheetId(token: string, spreadsheetId: string): Promise<number> {
  const res = await googleFetch(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.sheetId`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(`Sheets metadata failed: ${await res.text()}`);
  const meta = (await res.json()) as { sheets?: Array<{ properties?: { sheetId?: number } }> };
  const sheetId = meta.sheets?.[0]?.properties?.sheetId;
  if (sheetId === undefined) throw new Error("Sheets metadata did not include a first sheet ID");
  return sheetId;
}

async function batchUpdateSheet(
  token: string,
  spreadsheetId: string,
  requests: GoogleApiRequest[],
): Promise<void> {
  const res = await googleFetch(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    { method: "POST", body: JSON.stringify({ requests }) },
  );
  if (!res.ok) throw new Error(`Sheets template update failed: ${await res.text()}`);
}

async function writeSheetValues(
  token: string,
  spreadsheetId: string,
  sheetTitle: string,
  values: string[][],
): Promise<void> {
  const quotedTitle = `'${sheetTitle.replace(/'/g, "''")}'`;
  const range = `${quotedTitle}!A1:I2`;
  const res = await googleFetch(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({ range, values }),
    },
  );
  if (!res.ok) throw new Error(`Sheets values update failed: ${await res.text()}`);
}

async function main(): Promise<void> {
  const folderId = readArg("--folder-id") ?? process.env.GDRIVE_ROOT_FOLDER_ID?.trim() ?? "root";
  const profile = loadAgencyProfile();
  const token = await getAccessToken();

  const offerPlan = buildOfferTemplatePlan(profile);
  console.log(`Creating Google Docs offer template: ${offerPlan.title}`);
  const offerFile = await createDriveFile(token, {
    name: offerPlan.title,
    mimeType: "application/vnd.google-apps.document",
    parentFolderId: folderId,
  });
  await batchUpdateDoc(token, offerFile.id, offerPlan.requests);

  console.log(`Creating Google Sheets estimation template: ${profile.name} Estimation Template`);
  const sheetFile = await createDriveFile(token, {
    name: `${profile.name} Estimation Template`,
    mimeType: "application/vnd.google-apps.spreadsheet",
    parentFolderId: folderId,
  });
  const firstSheetId = await getFirstSheetId(token, sheetFile.id);
  const sheetPlan = buildEstimationSheetTemplatePlan(profile, firstSheetId);
  await batchUpdateSheet(token, sheetFile.id, sheetPlan.requests);
  await writeSheetValues(token, sheetFile.id, sheetPlan.sheetTitle, sheetPlan.values);

  console.log("\nGoogle templates created.");
  console.log(`Offer template: https://docs.google.com/document/d/${offerFile.id}/edit`);
  console.log(`Estimation template: https://docs.google.com/spreadsheets/d/${sheetFile.id}/edit`);
  console.log("\nSet these environment variables:");
  console.log(`GDRIVE_TEMPLATE_ID=${offerFile.id}`);
  console.log(`GSHEETS_TEMPLATE_ID=${sheetFile.id}`);
}

main().catch((err) => {
  console.error(`Template setup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
