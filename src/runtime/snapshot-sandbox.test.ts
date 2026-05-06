import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldCreateSnapshot } from "../../scripts/snapshot-sandbox.js";

/**
 * The build-time snapshot is best-effort and only runs on Vercel, where the
 * Sandbox SDK uses platform-provided authentication automatically. Plain local
 * builds must skip cleanly and let runtime fall back to the git-clone path.
 */
describe("shouldCreateSnapshot", () => {
  it("creates snapshots on Vercel", () => {
    assert.equal(shouldCreateSnapshot({ VERCEL: "1" }), true);
  });

  it("skips snapshots outside Vercel", () => {
    assert.equal(shouldCreateSnapshot({}), false);
  });

  it("does not treat token env vars as a local snapshot gate", () => {
    assert.equal(shouldCreateSnapshot({ GITHUB_TOKEN: "ghp_test" }), false);
  });
});
