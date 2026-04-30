import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { logger, logStartupBanner, type LogEntry } from "./logger.js";

// Capture console output during tests
function captureLog(fn: () => void): LogEntry {
  let captured = "";
  const orig = console.log;
  console.log = (msg: string) => { captured = msg; };
  fn();
  console.log = orig;
  return JSON.parse(captured) as LogEntry;
}

function captureErr(fn: () => void): LogEntry {
  let captured = "";
  const orig = console.error;
  console.error = (msg: string) => { captured = msg; };
  fn();
  console.error = orig;
  return JSON.parse(captured) as LogEntry;
}

describe("logger", () => {
  it("info() emits valid JSON with correct level and message", () => {
    const entry = captureLog(() => logger.info("hello world"));
    assert.equal(entry.level, "info");
    assert.equal(entry.message, "hello world");
    assert.ok(entry.ts, "ts field must be present");
    assert.ok(!isNaN(Date.parse(entry.ts as string)), "ts must be a valid ISO date");
  });

  it("error() writes to console.error", () => {
    const entry = captureErr(() => logger.error("boom", { code: 500 }));
    assert.equal(entry.level, "error");
    assert.equal(entry.message, "boom");
    assert.equal(entry.code, 500);
  });

  it("warn() emits level=warn", () => {
    let captured = "";
    const orig = console.warn;
    console.warn = (msg: string) => { captured = msg; };
    logger.warn("careful");
    console.warn = orig;
    const entry = JSON.parse(captured) as LogEntry;
    assert.equal(entry.level, "warn");
  });

  it("debug() emits level=debug", () => {
    const entry = captureLog(() => logger.debug("trace", { x: 1 }));
    assert.equal(entry.level, "debug");
    assert.equal(entry.x, 1);
  });

  it("extra data fields are merged into the root log object", () => {
    const entry = captureLog(() => logger.info("test", { jobId: "j1", channel: "C123" }));
    assert.equal(entry.jobId, "j1");
    assert.equal(entry.channel, "C123");
  });

  describe("withContext()", () => {
    it("merges fixed context into every log line", () => {
      const log = logger.withContext({ jobId: "abc", env: "test" });
      const entry = captureLog(() => log.info("step done", { step: 2 }));
      assert.equal(entry.jobId, "abc");
      assert.equal(entry.env, "test");
      assert.equal(entry.step, 2);
      assert.equal(entry.message, "step done");
    });

    it("call-site data overrides context data", () => {
      const log = logger.withContext({ priority: "low" });
      const entry = captureLog(() => log.info("override", { priority: "high" }));
      assert.equal(entry.priority, "high");
    });
  });

  describe("startTimer()", () => {
    it("end() logs durationMs as a number", () => {
      const timer = logger.startTimer("my-op");
      const entry = captureLog(() => timer.end());
      assert.equal(entry.message, "my-op completed");
      assert.equal(typeof entry.durationMs, "number");
      assert.ok((entry.durationMs as number) >= 0);
    });

    it("fail() logs error message and durationMs", () => {
      const timer = logger.startTimer("bad-op");
      const entry = captureErr(() => timer.fail(new Error("something went wrong")));
      assert.equal(entry.message, "bad-op failed");
      assert.equal(entry.error, "something went wrong");
      assert.equal(typeof entry.durationMs, "number");
    });

    it("fail() handles non-Error objects", () => {
      const timer = logger.startTimer("op");
      const entry = captureErr(() => timer.fail("string error"));
      assert.equal(entry.error, "string error");
    });

    it("end() merges extra data", () => {
      const timer = logger.startTimer("op", { jobId: "j1" });
      const entry = captureLog(() => timer.end({ turns: 5 }));
      assert.equal(entry.jobId, "j1");
      assert.equal(entry.turns, 5);
    });
  });

  describe("logStartupBanner()", () => {
    it("emits startup info with port, env, node, pid", () => {
      const entry = captureLog(() => logStartupBanner(3000, "test"));
      assert.equal(entry.port, 3000);
      assert.equal(entry.env, "test");
      assert.ok(entry.node);
      assert.ok(entry.pid);
      assert.equal(entry.message, "estimation-agent starting");
    });
  });
});
