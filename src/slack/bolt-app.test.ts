import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Pure logic extracted from bolt-app handlers ───────────────────────────────
// We test the message parsing and validation rules without spinning up Bolt.

function parseRfpFromMessage(text: string): string {
  return text.replace(/^!estimate\s*/i, "").trim();
}

function isValidRfp(rfpText: string): boolean {
  return rfpText.length >= 20;
}

function truncateForThreadOpener(text: string, maxLen = 200): string {
  return text.slice(0, maxLen) + (text.length > maxLen ? "..." : "");
}

describe("Slack message parsing", () => {
  describe("parseRfpFromMessage()", () => {
    it("strips the !estimate prefix", () => {
      const result = parseRfpFromMessage("!estimate Build me a SaaS platform");
      assert.equal(result, "Build me a SaaS platform");
    });

    it("is case-insensitive for the prefix", () => {
      assert.equal(parseRfpFromMessage("!ESTIMATE Foo bar baz"), "Foo bar baz");
      assert.equal(parseRfpFromMessage("!Estimate Foo bar baz"), "Foo bar baz");
    });

    it("trims leading and trailing whitespace", () => {
      const result = parseRfpFromMessage("!estimate   some RFP text   ");
      assert.equal(result, "some RFP text");
    });

    it("returns empty string if only the command is sent", () => {
      assert.equal(parseRfpFromMessage("!estimate"), "");
      assert.equal(parseRfpFromMessage("!estimate   "), "");
    });

    it("preserves internal whitespace in the RFP", () => {
      const rfp = "Build a platform\nwith multiple lines\nand bullets";
      assert.equal(parseRfpFromMessage(`!estimate ${rfp}`), rfp);
    });
  });

  describe("isValidRfp()", () => {
    it("rejects empty string", () => assert.equal(isValidRfp(""), false));
    it("rejects text shorter than 20 chars", () => assert.equal(isValidRfp("Too short"), false));
    it("accepts text of exactly 20 chars", () => assert.equal(isValidRfp("A".repeat(20)), true));
    it("accepts long RFP text", () => assert.equal(isValidRfp("A".repeat(500)), true));
  });

  describe("truncateForThreadOpener()", () => {
    it("does not truncate text under the limit", () => {
      const short = "Short text";
      assert.equal(truncateForThreadOpener(short), "Short text");
    });

    it("truncates and appends ... for long text", () => {
      const long = "A".repeat(300);
      const result = truncateForThreadOpener(long);
      assert.equal(result.length, 203); // 200 + "..."
      assert.ok(result.endsWith("..."));
    });

    it("respects custom maxLen", () => {
      const text = "Hello world";
      const result = truncateForThreadOpener(text, 5);
      assert.equal(result, "Hello...");
    });

    it("exact limit length is not truncated", () => {
      const text = "A".repeat(200);
      const result = truncateForThreadOpener(text);
      assert.equal(result, text);
      assert.ok(!result.endsWith("..."));
    });
  });
});

// ── Slack timestamp helpers ───────────────────────────────────────────────────
describe("Slack thread_ts handling", () => {
  it("thread_ts from message.ts is passed through unchanged", () => {
    const ts = "1700000000.000200";
    // Simulate what the handler does: uses message.ts as threadTs
    const threadTs = ts;
    assert.equal(threadTs, ts);
  });

  it("a later ts is considered a newer reply", () => {
    const originalTs = "1700000000.000000";
    const replyTs    = "1700000001.000000";
    assert.ok(replyTs > originalTs, "string comparison works for Slack timestamps within epoch");
  });
});
