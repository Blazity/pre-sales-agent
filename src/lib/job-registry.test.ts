import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { registerJob, cancelJob, unregisterJob } = await import("./job-registry.js");

describe("job-registry", () => {
  it("registerJob returns an AbortController", () => {
    const ctrl = registerJob("test-1");
    assert.ok(ctrl instanceof AbortController);
    assert.equal(ctrl.signal.aborted, false);
    unregisterJob("test-1");
  });

  it("cancelJob aborts the controller and returns true", () => {
    const ctrl = registerJob("test-2");
    const result = cancelJob("test-2");
    assert.equal(result, true);
    assert.equal(ctrl.signal.aborted, true);
  });

  it("cancelJob returns false for unknown job", () => {
    assert.equal(cancelJob("nonexistent"), false);
  });

  it("unregisterJob removes the controller", () => {
    registerJob("test-3");
    unregisterJob("test-3");
    assert.equal(cancelJob("test-3"), false);
  });
});
