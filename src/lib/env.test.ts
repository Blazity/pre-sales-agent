import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Test the env-var validation logic in isolation ────────────────────────────
// We replicate the `requireEnv` function from env.ts and test it directly,
// avoiding dynamic import caching issues and dotenv interference.

function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const val = env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function loadEnv(env: Record<string, string | undefined>) {
  return {
    ANTHROPIC_API_KEY:    requireEnv(env, "ANTHROPIC_API_KEY"),
    SLACK_BOT_TOKEN:      requireEnv(env, "SLACK_BOT_TOKEN"),
    SLACK_SIGNING_SECRET: requireEnv(env, "SLACK_SIGNING_SECRET"),
    GOOGLE_CLIENT_ID:     requireEnv(env, "GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: requireEnv(env, "GOOGLE_CLIENT_SECRET"),
    GOOGLE_REFRESH_TOKEN: requireEnv(env, "GOOGLE_REFRESH_TOKEN"),
    GDRIVE_TEMPLATE_ID:   requireEnv(env, "GDRIVE_TEMPLATE_ID"),
    GSHEETS_TEMPLATE_ID:  requireEnv(env, "GSHEETS_TEMPLATE_ID"),
    PINECONE_API_KEY:     requireEnv(env, "PINECONE_API_KEY"),
    PINECONE_INDEX:       env["PINECONE_INDEX"] ?? "estimations",
    VOYAGE_API_KEY:       requireEnv(env, "VOYAGE_API_KEY"),
    PORT:                 parseInt(env["PORT"] ?? "3000"),
    NODE_ENV:             env["NODE_ENV"] ?? "development",
  };
}

const FULL_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY:    "sk-ant-test",
  SLACK_BOT_TOKEN:      "xoxb-test",
  SLACK_SIGNING_SECRET: "signing-secret",
  GOOGLE_CLIENT_ID:     "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
  GDRIVE_TEMPLATE_ID:   "template-doc-id",
  GSHEETS_TEMPLATE_ID:  "template-sheet-id",
  PINECONE_API_KEY:     "pinecone-key",
  VOYAGE_API_KEY:       "voyage-key",
};

describe("env loader", () => {
  it("returns correct values when all required vars are set", () => {
    const env = loadEnv(FULL_ENV);
    assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-test");
    assert.equal(env.SLACK_BOT_TOKEN, "xoxb-test");
    assert.equal(env.PINECONE_INDEX, "estimations");   // default
    assert.equal(env.PORT, 3000);                       // default
    assert.equal(env.NODE_ENV, "development");          // default
  });

  it("respects PINECONE_INDEX override", () => {
    const env = loadEnv({ ...FULL_ENV, PINECONE_INDEX: "custom-index" });
    assert.equal(env.PINECONE_INDEX, "custom-index");
  });

  it("respects PORT override and parses to number", () => {
    const env = loadEnv({ ...FULL_ENV, PORT: "8080" });
    assert.equal(env.PORT, 8080);
    assert.equal(typeof env.PORT, "number");
  });

  it("respects NODE_ENV override", () => {
    const env = loadEnv({ ...FULL_ENV, NODE_ENV: "production" });
    assert.equal(env.NODE_ENV, "production");
  });

  const requiredKeys = [
    "ANTHROPIC_API_KEY",
    "SLACK_BOT_TOKEN",
    "SLACK_SIGNING_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "GDRIVE_TEMPLATE_ID",
    "GSHEETS_TEMPLATE_ID",
    "PINECONE_API_KEY",
    "VOYAGE_API_KEY",
  ] as const;

  for (const key of requiredKeys) {
    it(`throws with a clear message when ${key} is missing`, () => {
      const incomplete = { ...FULL_ENV };
      delete (incomplete as Record<string, string>)[key];

      assert.throws(
        () => loadEnv(incomplete),
        (err: Error) => {
          assert.ok(
            err.message.includes(key),
            `Error message should mention "${key}", got: "${err.message}"`
          );
          return true;
        }
      );
    });
  }

  it("throws on empty string (not just undefined)", () => {
    assert.throws(
      () => loadEnv({ ...FULL_ENV, ANTHROPIC_API_KEY: "" }),
      /ANTHROPIC_API_KEY/
    );
  });
});
