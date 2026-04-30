import { describe, it } from "node:test";
import assert from "node:assert/strict";

const REQUIRED_ENV_VARS: Record<string, string> = {
  PINECONE_API_KEY: "test-key",
  VOYAGE_API_KEY: "test-key",
};
for (const [k, v] of Object.entries(REQUIRED_ENV_VARS)) {
  if (!process.env[k]) process.env[k] = v;
}

const { buildCaseStudyFilter, formatEstimationResults } = await import("./knowledge-base.js");

describe("buildCaseStudyFilter()", () => {
  it("returns undefined with no extra params", () => {
    const filter = buildCaseStudyFilter();
    assert.deepEqual(filter, undefined);
  });

  it("returns industry filter when provided", () => {
    const filter = buildCaseStudyFilter("e-commerce");
    assert.deepEqual(filter, { industry: { $eq: "e-commerce" } });
  });

  it("combines both filters with $and", () => {
    const filter = buildCaseStudyFilter("saas", "modernization");
    assert.deepEqual(filter, {
      $and: [
        { industry: { $eq: "saas" } },
        { problem_type: { $eq: "modernization" } },
      ],
    });
  });
});

describe("formatEstimationResults()", () => {
  it("groups features under their project summary", () => {
    const matches = [
      {
        id: "sheet_abc_summary",
        score: 0.92,
        metadata: {
          type: "estimation_summary",
          project_name: "Acme Corp",
          total_hours: 200,
          total_cost_eur: 17000,
          team_roles: "Senior Developer, Architect",
          feature_count: 5,
          sheet_url: "https://sheets/abc",
          linked_proposal_id: "doc123",
        },
      },
      {
        id: "sheet_abc_feat_0",
        score: 0.88,
        metadata: {
          type: "estimation_feature",
          project_name: "Acme Corp",
          feature_name: "Auth",
          role: "Senior Developer",
          hours: 80,
          cost_eur: 6800,
          sheet_id: "abc",
        },
      },
    ];

    const result = formatEstimationResults(matches);
    assert.ok(result.includes("Acme Corp"));
    assert.ok(result.includes("200h"));
    assert.ok(result.includes("€17,000"));
    assert.ok(result.includes("Auth"));
    assert.ok(result.includes("80h"));
  });

  it("returns fallback message for empty matches", () => {
    const result = formatEstimationResults([]);
    assert.ok(result.includes("No matching"));
  });
});
