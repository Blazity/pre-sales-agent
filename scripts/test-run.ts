import "dotenv/config";

const docId = process.argv[2] || process.env.TEST_RFP_DOC_ID;
if (!docId) {
  console.error("Usage: npx tsx scripts/test-run.ts [google-doc-id]");
  console.error("Or set TEST_RFP_DOC_ID in .env");
  process.exit(1);
}

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token error: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function fetchDocText(id: string, token: string): Promise<string> {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Docs API error ${res.status}: ${await res.text()}`);
  const doc = (await res.json()) as { body: { content: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }> } };
  return doc.body.content
    .filter((b) => b.paragraph?.elements)
    .map((b) => b.paragraph!.elements!.map((e) => e.textRun?.content ?? "").join("").trim())
    .filter(Boolean)
    .join("\n");
}

console.log(`Reading RFP from doc ${docId}...`);
const token = await getAccessToken();
const rfpText = await fetchDocText(docId, token);
console.log(`RFP: ${rfpText.slice(0, 100)}...`);

const { runEstimationWorkflow } = await import("../src/agents/orchestrator.js");

const start = Date.now();
await runEstimationWorkflow({
  jobId: `test_${Date.now()}`,
  channelId: "test",
  threadTs: "test",
  rfpText,
  clarificationAnswers: "No clarification needed. Make reasonable assumptions based on the RFP, industry standards, and your analysis. Do not ask questions.",
  outputFolderId: process.env.GDRIVE_OUTPUT_FOLDER_ID,
  skipSteps: ["presentation", "knowledge_base", "slack"],
});

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`Done in ${elapsed}s`);
process.exit(0);
