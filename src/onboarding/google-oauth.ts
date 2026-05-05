export const GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:3333/callback";

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
] as const;

export function validateGoogleOAuthClientEnv(env: Record<string, string | undefined>): string[] {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter((name) => !env[name]?.trim());
}

export function buildGoogleOAuthUrl(clientId: string): string {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  })}`;
}
