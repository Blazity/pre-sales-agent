/**
 * Creates a branded Google Doc template with Blazity styling.
 *
 * Cover page has placeholder tokens: {{CLIENT_NAME}}, {{PROJECT_NAME}}, {{DATE}}.
 * Brand fonts and colors are applied directly to the cover page text.
 * The agent applies styling to offer content via docs_write_sections.
 *
 * Usage:
 *   npx tsx scripts/create-template.ts [--folder-id FOLDER_ID]
 *
 * After running, review the template in Google Docs and set GDRIVE_TEMPLATE_ID in .env.
 */
import "dotenv/config";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    red: parseInt(h.substring(0, 2), 16) / 255,
    green: parseInt(h.substring(2, 4), 16) / 255,
    blue: parseInt(h.substring(4, 6), 16) / 255,
  };
}

const BURNT_ORANGE = "#FD6027";
const COAL = "#181B20";

async function main() {
  const folderId = process.argv.find((a, i) => process.argv[i - 1] === "--folder-id")
    ?? process.env.GDRIVE_ROOT_FOLDER_ID
    ?? "root";

  const token = await getAccessToken();

  // 1. Create blank doc
  console.log("Creating blank Google Doc...");
  const createRes = await fetch(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Blazity Offer Template",
        mimeType: "application/vnd.google-apps.document",
        parents: [folderId],
      }),
    },
  );
  if (!createRes.ok) throw new Error(`Create error: ${await createRes.text()}`);
  const doc = (await createRes.json()) as { id: string };
  console.log(`Doc created: ${doc.id}`);

  // 2. Apply page margins + cover page content with direct styling
  console.log("Applying brand styles...");

  const coal = hexToRgb(COAL);
  const orange = hexToRgb(BURNT_ORANGE);

  const titleLine = "{{CLIENT_NAME}} & BLAZITY";
  const proposalLine = "Proposal";
  const coverText = `${titleLine}\n${proposalLine}\n\n{{PROJECT_NAME}}\n{{DATE}}\n`;

  const requests: any[] = [
    // Page margins
    {
      updateDocumentStyle: {
        documentStyle: {
          marginTop: { magnitude: 72, unit: "PT" },
          marginBottom: { magnitude: 72, unit: "PT" },
          marginLeft: { magnitude: 72, unit: "PT" },
          marginRight: { magnitude: 72, unit: "PT" },
        },
        fields: "marginTop,marginBottom,marginLeft,marginRight",
      },
    },
    // Insert cover text
    { insertText: { location: { index: 1 }, text: coverText } },
    // Style title line — JetBrains Mono, 28pt, Coal
    {
      updateTextStyle: {
        range: { startIndex: 1, endIndex: 1 + titleLine.length },
        textStyle: {
          weightedFontFamily: { fontFamily: "JetBrains Mono" },
          fontSize: { magnitude: 28, unit: "PT" },
          foregroundColor: { color: { rgbColor: coal } },
        },
        fields: "weightedFontFamily,fontSize,foregroundColor",
      },
    },
    // Style "Proposal" line — JetBrains Mono, 28pt, Burnt Orange
    {
      updateTextStyle: {
        range: {
          startIndex: 1 + titleLine.length + 1, // +1 for \n
          endIndex: 1 + titleLine.length + 1 + proposalLine.length,
        },
        textStyle: {
          weightedFontFamily: { fontFamily: "JetBrains Mono" },
          fontSize: { magnitude: 28, unit: "PT" },
          foregroundColor: { color: { rgbColor: orange } },
        },
        fields: "weightedFontFamily,fontSize,foregroundColor",
      },
    },
    // Style remaining lines (project name, date) — Inter, 14pt, Coal
    {
      updateTextStyle: {
        range: {
          startIndex: 1 + titleLine.length + 1 + proposalLine.length + 2, // after "Proposal\n\n"
          endIndex: 1 + coverText.length - 1, // exclude trailing \n
        },
        textStyle: {
          weightedFontFamily: { fontFamily: "Inter" },
          fontSize: { magnitude: 14, unit: "PT" },
          foregroundColor: { color: { rgbColor: coal } },
        },
        fields: "weightedFontFamily,fontSize,foregroundColor",
      },
    },
    // Page break after cover
    {
      insertPageBreak: {
        location: { index: 1 + coverText.length },
      },
    },
  ];

  const batchRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${doc.id}:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    },
  );
  if (!batchRes.ok) {
    const text = await batchRes.text();
    throw new Error(`batchUpdate failed: ${text}`);
  }

  console.log("\n✅ Template created!");
  console.log(`URL: https://docs.google.com/document/d/${doc.id}/edit`);
  console.log(`\nSet in .env:\n  GDRIVE_TEMPLATE_ID=${doc.id}`);
  console.log("\nNext: open the template in Google Docs and configure named styles:");
  console.log("  Format → Paragraph styles → Options → Save as my default styles");
  console.log("  HEADING_1: JetBrains Mono, 28pt, #181B20");
  console.log("  HEADING_2: Inter, 20pt, #181B20");
  console.log("  HEADING_3: Inter, 14pt bold, #181B20");
  console.log("  NORMAL_TEXT: Inter, 11pt, #181B20");
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
