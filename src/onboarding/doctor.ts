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

export function buildHealthUrl(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  url.pathname = url.pathname.replace(/\/$/, "");
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/api/health";
  }
  return url.toString().replace(/\/$/, "");
}

export function isHealthyPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return payload.status === "ok"
    && payload.runtime === "vercel"
    && payload.workflow === "enabled";
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
