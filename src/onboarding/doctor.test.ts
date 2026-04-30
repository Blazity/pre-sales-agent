import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_FIRST_LAUNCH_ENV,
  buildHealthUrl,
  classifyEnv,
  hasBlockingFailures,
  isHealthyPayload,
  summarizeResults,
  type DoctorResult,
} from "./doctor.js";

describe("first-launch doctor core", () => {
  it("classifies required env vars without revealing values", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-secret",
      SLACK_BOT_TOKEN: "xoxb-secret",
      SLACK_SIGNING_SECRET: "",
      GOOGLE_CLIENT_ID: "client",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_REFRESH_TOKEN: "refresh",
      GDRIVE_ROOT_FOLDER_ID: "folder",
      GDRIVE_TEMPLATE_ID: "doc",
      GSHEETS_TEMPLATE_ID: "sheet",
      PINECONE_API_KEY: "pinecone",
      VOYAGE_API_KEY: "voyage",
    };

    const results = classifyEnv(env);
    const failed = results.filter((result) => result.status === "FAIL");
    const passed = results.filter((result) => result.status === "PASS");

    assert.equal(results.length, REQUIRED_FIRST_LAUNCH_ENV.length);
    assert.deepEqual(failed.map((result) => result.label), ["SLACK_SIGNING_SECRET"]);
    assert.ok(passed.some((result) => result.label === "ANTHROPIC_API_KEY"));
    assert.doesNotMatch(JSON.stringify(results), /sk-ant-secret|xoxb-secret|refresh/);
  });

  it("normalizes deploy URLs to the health endpoint", () => {
    assert.equal(buildHealthUrl("https://agent.example.com"), "https://agent.example.com/api/health");
    assert.equal(buildHealthUrl("https://agent.example.com/"), "https://agent.example.com/api/health");
    assert.equal(buildHealthUrl("agent.example.com"), "https://agent.example.com/api/health");
    assert.equal(buildHealthUrl("https://agent.example.com/api/health"), "https://agent.example.com/api/health");
  });

  it("validates the expected Vercel health payload", () => {
    assert.equal(isHealthyPayload({ status: "ok", runtime: "vercel", workflow: "enabled" }), true);
    assert.equal(isHealthyPayload({ status: "ok", runtime: "vercel" }), false);
    assert.equal(isHealthyPayload({ status: "ok", runtime: "node", workflow: "enabled" }), false);
    assert.equal(isHealthyPayload(null), false);
  });

  it("summarizes results and treats only FAIL as blocking", () => {
    const results: DoctorResult[] = [
      { group: "Local", label: "Node", status: "PASS", message: "Node 20" },
      { group: "Vercel", label: "Health", status: "WARN", message: "Skipped" },
      { group: "Google", label: "OAuth", status: "FAIL", message: "Missing env" },
    ];

    assert.deepEqual(summarizeResults(results), { pass: 1, warn: 1, fail: 1 });
    assert.equal(hasBlockingFailures(results), true);
    assert.equal(hasBlockingFailures(results.filter((result) => result.status !== "FAIL")), false);
  });
});
