import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_FIRST_LAUNCH_ENV,
  REQUIRED_SEED_ENV,
  buildHealthUrl,
  buildSlackEventsUrl,
  buildSlackUrlVerificationRequest,
  classifyEnv,
  classifySeedEnv,
  summarizeSeedSourceFiles,
  hasBlockingFailures,
  isDriveFolderPayload,
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

  it("normalizes deploy URLs to the Slack Events endpoint", () => {
    assert.equal(buildSlackEventsUrl("https://agent.example.com"), "https://agent.example.com/api/slack/events");
    assert.equal(buildSlackEventsUrl("https://agent.example.com/"), "https://agent.example.com/api/slack/events");
    assert.equal(buildSlackEventsUrl("agent.example.com"), "https://agent.example.com/api/slack/events");
    assert.equal(buildSlackEventsUrl("https://agent.example.com/api/health"), "https://agent.example.com/api/slack/events");
    assert.equal(buildSlackEventsUrl("https://agent.example.com/api/slack/events"), "https://agent.example.com/api/slack/events");
  });

  it("builds a signed Slack URL verification request", () => {
    const request = buildSlackUrlVerificationRequest({
      signingSecret: "secret",
      timestamp: "1531420618",
      challenge: "doctor-challenge",
    });

    assert.equal(request.body, JSON.stringify({
      type: "url_verification",
      token: "doctor",
      challenge: "doctor-challenge",
    }));
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers["x-slack-request-timestamp"], "1531420618");
    assert.match(request.headers["x-slack-signature"], /^v0=[a-f0-9]{64}$/);
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

describe("seed doctor core", () => {
  it("classifies seed env vars without revealing values", () => {
    const env = {
      GOOGLE_CLIENT_ID: "client",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_REFRESH_TOKEN: "refresh",
      GDRIVE_ESTIMATIONS_FOLDER_ID: "estimations-folder",
      GDRIVE_PROPOSALS_FOLDER_ID: "proposals-folder",
      PINECONE_API_KEY: "pinecone",
      VOYAGE_API_KEY: "voyage",
    };

    const results = classifySeedEnv({ ...env, VOYAGE_API_KEY: " " });
    const failed = results.filter((result) => result.status === "FAIL");

    assert.equal(results.length, REQUIRED_SEED_ENV.length);
    assert.deepEqual(failed.map((result) => result.label), ["VOYAGE_API_KEY"]);
    assert.doesNotMatch(JSON.stringify(results), /client|secret|refresh|pinecone|voyage/);
  });

  it("recognizes Google Drive folder metadata payloads", () => {
    assert.equal(isDriveFolderPayload({ mimeType: "application/vnd.google-apps.folder" }), true);
    assert.equal(isDriveFolderPayload({ mimeType: "application/vnd.google-apps.document" }), false);
    assert.equal(isDriveFolderPayload(null), false);
  });

  it("summarizes seedable source files by expected native Drive type", () => {
    const files = [
      { mimeType: "application/vnd.google-apps.spreadsheet" },
      { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { mimeType: "application/vnd.google-apps.document" },
    ];

    assert.deepEqual(summarizeSeedSourceFiles(files, "spreadsheet"), {
      total: 3,
      seedable: 1,
      unsupported: 2,
    });
    assert.deepEqual(summarizeSeedSourceFiles(files, "document"), {
      total: 3,
      seedable: 1,
      unsupported: 2,
    });
  });
});
