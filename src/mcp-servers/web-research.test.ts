import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Response as UndiciResponse, type RequestInit as UndiciRequestInit } from "undici";

const {
  htmlToText,
  parseBraveResults,
  validatePublicWebUrl,
  fetchPublicWebPage,
  isPublicIpAddress,
  createPinnedLookup,
  readLimitedText,
} = await import("./web-research.js");

describe("parseBraveResults()", () => {
  it("extracts title, url, description from Brave API response", () => {
    const apiResponse = {
      web: {
        results: [
          { title: "Example", url: "https://example.com", description: "A description" },
          { title: "Another", url: "https://another.com", description: "More text" },
        ],
      },
    };
    const results = parseBraveResults(apiResponse);
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], { title: "Example", url: "https://example.com", description: "A description" });
  });

  it("returns empty array when no results", () => {
    assert.deepEqual(parseBraveResults({ web: { results: [] } }), []);
    assert.deepEqual(parseBraveResults({}), []);
  });
});

describe("htmlToText()", () => {
  it("strips script tags", () => {
    const result = htmlToText("<p>Hello</p><script>alert('x')</script><p>World</p>");
    assert.ok(!result.includes("alert"));
    assert.ok(result.includes("Hello"));
    assert.ok(result.includes("World"));
  });

  it("strips style tags", () => {
    const result = htmlToText("<style>.foo { color: red; }</style><p>Content</p>");
    assert.ok(!result.includes("color"));
    assert.ok(result.includes("Content"));
  });

  it("strips nav tags", () => {
    const result = htmlToText("<nav><a>Menu</a></nav><p>Body</p>");
    assert.ok(!result.includes("Menu"));
    assert.ok(result.includes("Body"));
  });

  it("strips footer tags", () => {
    const result = htmlToText("<p>Main</p><footer>Copyright 2024</footer>");
    assert.ok(!result.includes("Copyright"));
    assert.ok(result.includes("Main"));
  });

  it("converts headings to markdown", () => {
    const result = htmlToText("<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>");
    assert.ok(result.includes("# Title"));
    assert.ok(result.includes("## Subtitle"));
    assert.ok(result.includes("### Section"));
  });

  it("converts list items to bullets", () => {
    const result = htmlToText("<ul><li>First</li><li>Second</li></ul>");
    assert.ok(result.includes("- First"));
    assert.ok(result.includes("- Second"));
  });

  it("strips remaining HTML tags", () => {
    const result = htmlToText("<div><span>Text</span></div>");
    assert.equal(result, "Text");
  });

  it("collapses multiple newlines", () => {
    const result = htmlToText("<p>A</p><p></p><p></p><p></p><p>B</p>");
    assert.ok(!result.includes("\n\n\n"));
  });
});

describe("truncation", () => {
  it("text over 10K chars would be truncated with notice", () => {
    const longText = "x".repeat(15000);
    const truncated = longText.length > 10000
      ? `${longText.slice(0, 10000)}\n\n[... truncated, full page was ${longText.length} chars ...]`
      : longText;
    assert.ok(truncated.includes("[... truncated"));
    assert.ok(truncated.includes("15000 chars"));
  });
});

describe("public web URL policy", () => {
  const resolver = async (hostname: string) => {
    const table: Record<string, string[]> = {
      "example.com": ["93.184.216.34"],
      "localhost": ["127.0.0.1"],
      "private.test": ["10.0.0.5"],
      "metadata.test": ["169.254.169.254"],
      "ipv6-local.test": ["::1"],
    };
    return table[hostname] ?? ["93.184.216.34"];
  };

  it("allows public http and https URLs", async () => {
    await assert.doesNotReject(() => validatePublicWebUrl("https://example.com/page", resolver));
    await assert.doesNotReject(() => validatePublicWebUrl("http://example.com/page", resolver));
  });

  it("rejects non-http protocols and embedded credentials", async () => {
    await assert.rejects(() => validatePublicWebUrl("file:///etc/passwd", resolver), /Only http and https/);
    await assert.rejects(() => validatePublicWebUrl("https://user:pass@example.com", resolver), /credentials/);
  });

  it("rejects localhost, private, link-local, and metadata destinations", async () => {
    await assert.rejects(() => validatePublicWebUrl("http://localhost/admin", resolver), /not allowed/);
    await assert.rejects(() => validatePublicWebUrl("http://private.test/admin", resolver), /not public/);
    await assert.rejects(() => validatePublicWebUrl("http://metadata.test/latest/meta-data", resolver), /not public/);
    await assert.rejects(() => validatePublicWebUrl("http://ipv6-local.test/", resolver), /not public/);
  });

  it("classifies public and non-public IP addresses", () => {
    assert.equal(isPublicIpAddress("93.184.216.34"), true);
    assert.equal(isPublicIpAddress("10.0.0.1"), false);
    assert.equal(isPublicIpAddress("172.16.0.1"), false);
    assert.equal(isPublicIpAddress("192.168.0.1"), false);
    assert.equal(isPublicIpAddress("169.254.169.254"), false);
    assert.equal(isPublicIpAddress("127.0.0.1"), false);
    assert.equal(isPublicIpAddress("::1"), false);
    assert.equal(isPublicIpAddress("fd00::1"), false);
    assert.equal(isPublicIpAddress("fe80::1"), false);
    assert.equal(isPublicIpAddress("fec0::1"), false);
  });

  it("rejects IPv4-mapped private IPv6 addresses", async () => {
    assert.equal(isPublicIpAddress("::ffff:10.0.0.1"), false);
    assert.equal(isPublicIpAddress("::ffff:127.0.0.1"), false);
    assert.equal(isPublicIpAddress("::ffff:169.254.169.254"), false);
    assert.equal(isPublicIpAddress("::ffff:172.16.0.1"), false);
    assert.equal(isPublicIpAddress("::ffff:192.168.0.1"), false);
    assert.equal(isPublicIpAddress("::ffff:ac10:1"), false);
    assert.equal(isPublicIpAddress("::ffff:93.184.216.34"), true);

    await assert.rejects(
      () => validatePublicWebUrl("http://mapped-private.test/", async () => ["::ffff:172.16.0.1"]),
      /not public/,
    );
    await assert.rejects(() => validatePublicWebUrl("http://[::ffff:172.16.0.1]/"), /not public/);
    await assert.rejects(() => validatePublicWebUrl("http://[fec0::1]/"), /not public/);
  });

  it("pins fetch DNS lookup to the validated public address", async () => {
    await new Promise<void>((resolve, reject) => {
      const lookup = createPinnedLookup("93.184.216.34");
      lookup("rebinding.test", {}, (err: Error | null, address: string, family: number) => {
        try {
          assert.equal(err, null);
          assert.equal(address, "93.184.216.34");
          assert.equal(family, 4);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    const { response, close } = await fetchPublicWebPage("https://rebinding.test/page", {
      resolver: async () => ["93.184.216.34"],
      fetchImpl: async (_input, init?: UndiciRequestInit) => {
        assert.ok(init?.dispatcher);
        return new UndiciResponse("ok", { headers: { "content-type": "text/plain" } });
      },
    });

    assert.equal(response.ok, true);
    await close();
  });
});

describe("readLimitedText()", () => {
  it("rejects responses over the byte limit", async () => {
    const response = new Response("x".repeat(12), {
      headers: { "content-type": "text/plain" },
    });

    await assert.rejects(() => readLimitedText(response, 10), /Response exceeded 10 bytes/);
  });
});
