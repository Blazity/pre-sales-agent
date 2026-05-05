/**
 * First-launch setup doctor.
 *
 * Usage:
 *   npm run doctor:first-launch
 *   npm run doctor:first-launch -- --health-url https://your-app.vercel.app
 *   npm run doctor:first-launch -- --offline
 */
import "dotenv/config";

import {
  buildHealthUrl,
  buildSlackEventsUrl,
  buildSlackUrlVerificationRequest,
  classifyEnv,
  hasBlockingFailures,
  isHealthyPayload,
  result,
  summarizeResults,
  type DoctorResult,
  type DoctorStatus,
} from "../src/onboarding/doctor.js";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function localNodeCheck(): DoctorResult {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  return major >= 20
    ? result("PASS", "Local", "Node.js", `Node ${process.versions.node}`)
    : result("FAIL", "Local", "Node.js", `Node ${process.versions.node}; Node 20+ required`);
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { ok: res.ok, status: res.status, body, text };
}

async function checkHealth(urlInput?: string): Promise<DoctorResult> {
  if (!urlInput) {
    return result("WARN", "Vercel", "Health endpoint", "Skipped; pass --health-url or set VERCEL_PROJECT_URL");
  }

  try {
    const url = buildHealthUrl(urlInput);
    const response = await fetchJson(url);
    if (response.ok && isHealthyPayload(response.body)) {
      return result("PASS", "Vercel", "Health endpoint", `${url} returned expected payload`);
    }
    return result("FAIL", "Vercel", "Health endpoint", `${url} did not return the expected health payload`);
  } catch (err) {
    return result("FAIL", "Vercel", "Health endpoint", err instanceof Error ? err.message : String(err));
  }
}

function isExpectedSlackChallengeResponse(text: string, challenge: string): boolean {
  if (text.trim() === challenge) return true;
  try {
    const body = JSON.parse(text) as { challenge?: unknown };
    return body.challenge === challenge;
  } catch {
    return false;
  }
}

async function checkSlackIngress(urlInput?: string): Promise<DoctorResult> {
  if (!urlInput) {
    return result("WARN", "Vercel", "Slack ingress", "Skipped; pass --health-url or set VERCEL_PROJECT_URL");
  }

  const signingSecret = env("SLACK_SIGNING_SECRET");
  if (!signingSecret) {
    return result("FAIL", "Vercel", "Slack ingress", "SLACK_SIGNING_SECRET missing locally; cannot sign smoke test");
  }

  const url = buildSlackEventsUrl(urlInput);
  const challenge = `doctor-${Date.now()}`;
  const request = buildSlackUrlVerificationRequest({
    signingSecret,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    challenge,
  });

  try {
    const response = await fetchJson(url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
    });
    if (response.ok && isExpectedSlackChallengeResponse(response.text, challenge)) {
      return result("PASS", "Vercel", "Slack ingress", `${url} accepted a signed Slack URL verification request`);
    }

    const detail = response.text.trim().slice(0, 160) || "empty response";
    return result("FAIL", "Vercel", "Slack ingress", `${url} returned HTTP ${response.status}: ${detail}`);
  } catch (err) {
    return result("FAIL", "Vercel", "Slack ingress", err instanceof Error ? err.message : String(err));
  }
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

async function checkGoogle(): Promise<DoctorResult[]> {
  try {
    const token = await getGoogleAccessToken();
    const checks: Array<{ label: string; idName: string; fields: string }> = [
      {
        label: "Drive root folder",
        idName: "GDRIVE_ROOT_FOLDER_ID",
        fields: "id,mimeType,capabilities/canAddChildren",
      },
      {
        label: "Docs template",
        idName: "GDRIVE_TEMPLATE_ID",
        fields: "id,mimeType,capabilities/canCopy",
      },
      {
        label: "Sheets template",
        idName: "GSHEETS_TEMPLATE_ID",
        fields: "id,mimeType,capabilities/canCopy",
      },
    ];

    const results: DoctorResult[] = [
      result("PASS", "Google", "OAuth refresh", "Refresh token produced an access token"),
    ];

    for (const check of checks) {
      const fileId = env(check.idName);
      if (!fileId) {
        results.push(result("FAIL", "Google", check.label, `${check.idName} missing`));
        continue;
      }

      const response = await fetchJson(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(check.fields)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!response.ok) {
        results.push(result("FAIL", "Google", check.label, `Google Drive returned HTTP ${response.status}`));
        continue;
      }

      const body = response.body as { mimeType?: string; capabilities?: Record<string, boolean> } | undefined;
      if (check.idName === "GDRIVE_ROOT_FOLDER_ID" && body?.capabilities?.canAddChildren !== true) {
        results.push(result("FAIL", "Google", check.label, "Folder exists but is not writable by the OAuth account"));
        continue;
      }
      if (check.idName !== "GDRIVE_ROOT_FOLDER_ID" && body?.capabilities?.canCopy !== true) {
        results.push(result("FAIL", "Google", check.label, "Template exists but cannot be copied by the OAuth account"));
        continue;
      }

      results.push(result("PASS", "Google", check.label, "Accessible with expected permissions"));
    }

    return results;
  } catch (err) {
    return [result("FAIL", "Google", "OAuth refresh", err instanceof Error ? err.message : String(err))];
  }
}

async function checkSlack(): Promise<DoctorResult> {
  const token = env("SLACK_BOT_TOKEN");
  if (!token) return result("FAIL", "Slack", "Bot token", "SLACK_BOT_TOKEN missing");

  try {
    const response = await fetchJson("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = response.body as { ok?: boolean; team?: string } | undefined;
    return response.ok && body?.ok
      ? result("PASS", "Slack", "Bot token", body.team ? `Authenticated for ${body.team}` : "Authenticated")
      : result("FAIL", "Slack", "Bot token", "Slack auth.test failed");
  } catch (err) {
    return result("FAIL", "Slack", "Bot token", err instanceof Error ? err.message : String(err));
  }
}

async function checkPinecone(): Promise<DoctorResult> {
  const apiKey = env("PINECONE_API_KEY");
  if (!apiKey) return result("FAIL", "Pinecone", "API key", "PINECONE_API_KEY missing");

  try {
    const response = await fetchJson("https://api.pinecone.io/indexes", {
      headers: { "Api-Key": apiKey, "X-Pinecone-API-Version": "2025-04" },
    });
    return response.ok
      ? result("PASS", "Pinecone", "API key", "Can list indexes")
      : result("FAIL", "Pinecone", "API key", `Pinecone returned HTTP ${response.status}`);
  } catch (err) {
    return result("FAIL", "Pinecone", "API key", err instanceof Error ? err.message : String(err));
  }
}

function printResults(results: DoctorResult[]): void {
  const groups = [...new Set(results.map((item) => item.group))];
  for (const group of groups) {
    console.log(`\n${group}`);
    for (const item of results.filter((resultItem) => resultItem.group === group)) {
      const icon: Record<DoctorStatus, string> = { PASS: "PASS", WARN: "WARN", FAIL: "FAIL" };
      console.log(`  ${icon[item.status]} ${item.label}: ${item.message}`);
    }
  }

  const summary = summarizeResults(results);
  console.log(`\nSummary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail`);
}

async function main(): Promise<void> {
  const offline = hasFlag("--offline");
  const healthUrl = readArg("--health-url") ?? env("VERCEL_PROJECT_URL");

  const results: DoctorResult[] = [
    localNodeCheck(),
    ...classifyEnv(process.env),
  ];

  if (offline) {
    results.push(result("WARN", "Network", "Live provider checks", "Skipped because --offline was provided"));
  } else {
    results.push(await checkHealth(healthUrl));
    results.push(await checkSlackIngress(healthUrl));
    results.push(...await checkGoogle());
    results.push(await checkSlack());
    results.push(await checkPinecone());
  }

  printResults(results);
  process.exitCode = hasBlockingFailures(results) ? 1 : 0;
}

main().catch((err) => {
  console.error(`doctor:first-launch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
