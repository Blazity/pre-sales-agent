import "dotenv/config";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const FOLDER_ID = process.env.GDRIVE_ROOT_FOLDER_ID!;

console.log("Testing Google Drive access...");
console.log("Folder ID:", FOLDER_ID);
console.log("Client ID:", CLIENT_ID.slice(0, 20) + "...");
console.log("Refresh token set:", !!REFRESH_TOKEN);
console.log();

// Step 1: Get access token
console.log("1. Exchanging refresh token for access token...");
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: "refresh_token",
  }),
});

const tokenData = await tokenRes.json() as Record<string, unknown>;
if (!tokenRes.ok) {
  console.error("Token refresh FAILED:", JSON.stringify(tokenData, null, 2));
  process.exit(1);
}
console.log("   Access token obtained.");

const accessToken = (tokenData as { access_token: string }).access_token;

// Step 2: Check who we're authenticated as
console.log("\n2. Checking authenticated user...");
const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const userData = await userRes.json();
console.log("   Authenticated as:", JSON.stringify(userData, null, 2));

// Step 3: Check Drive API is accessible
console.log("\n3. Listing Drive root (sanity check)...");
const rootRes = await fetch("https://www.googleapis.com/drive/v3/files?pageSize=3", {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const rootData = await rootRes.json() as Record<string, unknown>;
if (!rootRes.ok) {
  console.error("   Drive API FAILED:", JSON.stringify(rootData, null, 2));
} else {
  const files = (rootData as { files: Array<{ name: string; id: string }> }).files;
  console.log(`   Found ${files.length} files:`, files.map(f => `${f.name} (${f.id})`));
}

// Step 4: Try to access the specific folder (with Shared Drive support)
console.log(`\n4. Accessing folder ${FOLDER_ID}...`);
const folderRes = await fetch(`https://www.googleapis.com/drive/v3/files/${FOLDER_ID}?fields=id,name,mimeType,owners,driveId&supportsAllDrives=true`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const folderData = await folderRes.json();
if (!folderRes.ok) {
  console.error("   Folder access FAILED:", JSON.stringify(folderData, null, 2));
} else {
  console.log("   Folder found:", JSON.stringify(folderData, null, 2));
}

// Step 5: Try to create a subfolder
console.log(`\n5. Trying to create a test subfolder...`);
const createRes = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "_test_delete_me",
    mimeType: "application/vnd.google-apps.folder",
    parents: [FOLDER_ID],
  }),
});
const createData = await createRes.json();
if (!createRes.ok) {
  console.error("   Create subfolder FAILED:", JSON.stringify(createData, null, 2));
} else {
  console.log("   Subfolder created:", JSON.stringify(createData, null, 2));
  console.log("   (You can delete '_test_delete_me' from Drive)");
}

console.log("\nDone.");
