import { createHmac } from "node:crypto";

export type DoctorStatus = "PASS" | "WARN" | "FAIL";

export interface DoctorResult {
  group: string;
  label: string;
  status: DoctorStatus;
  message: string;
}

export interface DoctorSummary {
  pass: number;
  warn: number;
  fail: number;
}

export const REQUIRED_FIRST_LAUNCH_ENV = [
  "ANTHROPIC_API_KEY",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GDRIVE_ROOT_FOLDER_ID",
  "GDRIVE_TEMPLATE_ID",
  "GSHEETS_TEMPLATE_ID",
  "PINECONE_API_KEY",
  "VOYAGE_API_KEY",
] as const;

export type RequiredFirstLaunchEnv = typeof REQUIRED_FIRST_LAUNCH_ENV[number];

export const REQUIRED_SEED_ENV = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GDRIVE_ESTIMATIONS_FOLDER_ID",
  "GDRIVE_PROPOSALS_FOLDER_ID",
  "PINECONE_API_KEY",
  "VOYAGE_API_KEY",
] as const;

export type RequiredSeedEnv = typeof REQUIRED_SEED_ENV[number];

export type SeedSourceKind = "spreadsheet" | "document";

export interface SeedSourceFile {
  mimeType?: string;
}

export interface SeedSourceSummary {
  total: number;
  seedable: number;
  unsupported: number;
}

export interface SlackUrlVerificationRequestInput {
  signingSecret: string;
  timestamp: string;
  challenge: string;
}

export interface SlackUrlVerificationRequest {
  body: string;
  headers: Record<string, string>;
}

export function result(
  status: DoctorStatus,
  group: string,
  label: string,
  message: string,
): DoctorResult {
  return { group, label, status, message };
}

export function classifyEnv(env: Record<string, string | undefined>): DoctorResult[] {
  return REQUIRED_FIRST_LAUNCH_ENV.map((name) => {
    const value = env[name]?.trim();
    return value
      ? result("PASS", "Environment", name, "Set")
      : result("FAIL", "Environment", name, "Missing or empty");
  });
}

export function classifySeedEnv(env: Record<string, string | undefined>): DoctorResult[] {
  return REQUIRED_SEED_ENV.map((name) => {
    const value = env[name]?.trim();
    return value
      ? result("PASS", "Environment", name, "Set")
      : result("FAIL", "Environment", name, "Missing or empty");
  });
}

export function buildHealthUrl(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  url.pathname = url.pathname.replace(/\/$/, "");
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/api/health";
  }
  return url.toString().replace(/\/$/, "");
}

export function buildSlackEventsUrl(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  url.pathname = "/api/slack/events";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function buildSlackUrlVerificationRequest(
  input: SlackUrlVerificationRequestInput,
): SlackUrlVerificationRequest {
  const body = JSON.stringify({
    type: "url_verification",
    token: "doctor",
    challenge: input.challenge,
  });
  const signature = createHmac("sha256", input.signingSecret)
    .update(`v0:${input.timestamp}:${body}`)
    .digest("hex");
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": input.timestamp,
      "x-slack-signature": `v0=${signature}`,
    },
  };
}

export function isHealthyPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return payload.status === "ok"
    && payload.runtime === "vercel"
    && payload.workflow === "enabled";
}

export function isDriveFolderPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return payload.mimeType === "application/vnd.google-apps.folder";
}

export function summarizeSeedSourceFiles(
  files: SeedSourceFile[],
  expectedKind: SeedSourceKind,
): SeedSourceSummary {
  const expectedMimeType = expectedKind === "spreadsheet"
    ? "application/vnd.google-apps.spreadsheet"
    : "application/vnd.google-apps.document";
  const seedable = files.filter((file) => file.mimeType === expectedMimeType).length;
  return {
    total: files.length,
    seedable,
    unsupported: files.length - seedable,
  };
}

export function summarizeResults(results: DoctorResult[]): DoctorSummary {
  return results.reduce<DoctorSummary>(
    (summary, item) => {
      if (item.status === "PASS") summary.pass++;
      if (item.status === "WARN") summary.warn++;
      if (item.status === "FAIL") summary.fail++;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

export function hasBlockingFailures(results: DoctorResult[]): boolean {
  return results.some((item) => item.status === "FAIL");
}
