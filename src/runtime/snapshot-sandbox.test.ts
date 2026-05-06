import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSnapshotCredentials } from "../../scripts/snapshot-sandbox.js";

/**
 * The build-time snapshot is best-effort: when the build env can't
 * authenticate the Sandbox API (i.e., on local builds, Hobby builds, or any
 * CI without the VERCEL_TOKEN trio), the script must skip cleanly and let the
 * runtime fall back to the git-clone path. This test covers the gate that
 * decides skip-vs-run, so a regression in the env-detection logic doesn't
 * silently turn the build into "always tries to call the Sandbox API".
 */
describe("resolveSnapshotCredentials", () => {
  it("returns skip reason when VERCEL_TOKEN is missing", () => {
    const result = resolveSnapshotCredentials({ VERCEL_TEAM_ID: "t", VERCEL_PROJECT_ID: "p" });
    assert.ok("reason" in result);
    assert.match(result.reason, /VERCEL_TOKEN/);
  });

  it("returns skip reason when VERCEL_TEAM_ID is missing", () => {
    const result = resolveSnapshotCredentials({ VERCEL_TOKEN: "x", VERCEL_PROJECT_ID: "p" });
    assert.ok("reason" in result);
    assert.match(result.reason, /VERCEL_TEAM_ID/);
  });

  it("returns skip reason when VERCEL_PROJECT_ID is missing", () => {
    const result = resolveSnapshotCredentials({ VERCEL_TOKEN: "x", VERCEL_TEAM_ID: "t" });
    assert.ok("reason" in result);
    assert.match(result.reason, /VERCEL_PROJECT_ID/);
  });

  it("returns skip reason when ALL three are missing, naming all three", () => {
    const result = resolveSnapshotCredentials({});
    assert.ok("reason" in result);
    assert.match(result.reason, /VERCEL_TOKEN/);
    assert.match(result.reason, /VERCEL_TEAM_ID/);
    assert.match(result.reason, /VERCEL_PROJECT_ID/);
  });

  it("returns the credential bundle when all three are present and non-empty", () => {
    const result = resolveSnapshotCredentials({
      VERCEL_TOKEN: "tok",
      VERCEL_TEAM_ID: "team_123",
      VERCEL_PROJECT_ID: "prj_456",
    });
    assert.ok(!("reason" in result));
    assert.equal(result.token, "tok");
    assert.equal(result.teamId, "team_123");
    assert.equal(result.projectId, "prj_456");
  });

  it("treats empty strings as missing (Vercel sets empty for undefined env vars)", () => {
    const result = resolveSnapshotCredentials({
      VERCEL_TOKEN: "",
      VERCEL_TEAM_ID: "",
      VERCEL_PROJECT_ID: "",
    });
    assert.ok("reason" in result);
  });
});
