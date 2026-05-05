import "dotenv/config";
import http from "http";
import url from "url";
import {
  buildGoogleOAuthUrl,
  GOOGLE_OAUTH_REDIRECT_URI,
  validateGoogleOAuthClientEnv,
} from "../src/onboarding/google-oauth.js";

// Run: npx tsx scripts/get-google-token.ts

const missing = validateGoogleOAuthClientEnv(process.env);
if (missing.length > 0) {
  console.error(`Missing required env var(s): ${missing.join(", ")}`);
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, then rerun this command.");
  process.exit(1);
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!.trim();
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!.trim();
const authUrl = buildGoogleOAuthUrl(CLIENT_ID);

console.log("\n🔗 Open this URL in your browser to authorize:\n");
console.log(authUrl);
console.log(`\nWaiting for callback on ${GOOGLE_OAUTH_REDIRECT_URI} ...\n`);

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
      redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
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
