import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveWorkspaceProvider } from "./sandbox.js";

describe("workspace provider", () => {
  it("uses Vercel Sandbox on Vercel by default", () => {
    assert.equal(resolveWorkspaceProvider({ VERCEL: "1" }), "vercel-sandbox");
  });

  it("uses local workspace outside Vercel by default", () => {
    assert.equal(resolveWorkspaceProvider({}), "local");
  });

  it("allows explicit provider override", () => {
    assert.equal(resolveWorkspaceProvider({ AGENT_WORKSPACE_PROVIDER: "local", VERCEL: "1" }), "local");
    assert.equal(resolveWorkspaceProvider({ AGENT_WORKSPACE_PROVIDER: "vercel-sandbox" }), "vercel-sandbox");
  });
});
