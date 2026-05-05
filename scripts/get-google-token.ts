import "dotenv/config";
import http from "http";
import url from "url";

// Run: npx tsx scripts/get-google-token.ts

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = "http://localhost:3333/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
].join(" ");

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });

console.log("\n🔗 Open this URL in your browser to authorize:\n");
console.log(authUrl);
console.log("\nWaiting for callback on http://localhost:3333/callback ...\n");

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url!, true);
  if (parsed.pathname !== "/callback") return;

  const code = parsed.query.code as string;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const tokens = (await tokenRes.json()) as { refresh_token: string };

  console.log("\n✅ GOOGLE_REFRESH_TOKEN =", tokens.refresh_token);
  console.log("\nAdd this to your local .env and Vercel Environment Variables.");

  res.end("Auth complete! You can close this tab.");
  server.close();
});

server.listen(3333, () => console.log("Listening on http://localhost:3333/callback"));
