import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Stub env before importing auth module
const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// Minimal Express-like mocks
function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    headers: {} as Record<string, string | undefined>,
    ip: "127.0.0.1",
    ...overrides,
  } as any;
}

function mockRes() {
  let statusCode = 200;
  let body = "";
  const headers: Record<string, string> = {};
  return {
    status(code: number) { statusCode = code; return this; },
    send(text: string) { body = text; return this; },
    set(key: string, val: string) { headers[key] = val; return this; },
    get statusCode() { return statusCode; },
    get body() { return body; },
    get headers() { return headers; },
  } as any;
}

// We need to set required env vars before importing auth (which imports env.ts)
const REQUIRED_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: "test", SLACK_BOT_TOKEN: "test", SLACK_SIGNING_SECRET: "test",
  GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", GOOGLE_REFRESH_TOKEN: "test",
  GDRIVE_TEMPLATE_ID: "test", GDRIVE_ROOT_FOLDER_ID: "test", PINECONE_API_KEY: "test",
  VOYAGE_API_KEY: "test",
  ADMIN_USER: "admin", ADMIN_PASS: "secret",
};

for (const [k, v] of Object.entries(REQUIRED_ENV)) {
  if (!process.env[k]) process.env[k] = v;
}

const { ipAllowlist, basicAuth } = await import("./auth.js");

describe("ipAllowlist()", () => {
  beforeEach(() => {
    // Reset ADMIN_ALLOWED_IPS
    process.env.ADMIN_ALLOWED_IPS = "";
  });

  it("allows all when no IPs configured", () => {
    let called = false;
    ipAllowlist(mockReq(), mockRes(), () => { called = true; });
    assert.equal(called, true);
  });

  it("allows matching IP", () => {
    process.env.ADMIN_ALLOWED_IPS = "1.2.3.4,5.6.7.8";
    let called = false;
    ipAllowlist(mockReq({ ip: "1.2.3.4" }), mockRes(), () => { called = true; });
    assert.equal(called, true);
  });

  it("rejects non-matching IP", () => {
    process.env.ADMIN_ALLOWED_IPS = "1.2.3.4";
    const res = mockRes();
    let called = false;
    ipAllowlist(mockReq({ ip: "9.9.9.9" }), res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
  });

  it("uses req.ip set by trust proxy", () => {
    process.env.ADMIN_ALLOWED_IPS = "10.0.0.1";
    let called = false;
    ipAllowlist(
      mockReq({ ip: "10.0.0.1" }),
      mockRes(),
      () => { called = true; },
    );
    assert.equal(called, true);
  });
});

describe("basicAuth()", () => {
  it("rejects missing Authorization header", () => {
    const res = mockRes();
    let called = false;
    basicAuth(mockReq(), res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["WWW-Authenticate"], 'Basic realm="Admin"');
  });

  it("rejects wrong credentials", () => {
    const res = mockRes();
    const encoded = Buffer.from("wrong:creds").toString("base64");
    let called = false;
    basicAuth(mockReq({ headers: { authorization: `Basic ${encoded}` } }), res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
  });

  it("accepts correct credentials", () => {
    const encoded = Buffer.from("admin:secret").toString("base64");
    let called = false;
    basicAuth(mockReq({ headers: { authorization: `Basic ${encoded}` } }), mockRes(), () => { called = true; });
    assert.equal(called, true);
  });
});
