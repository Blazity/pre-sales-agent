import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEstimationSheet, normalizeFilename } from "./sheet-parser.js";

describe("normalizeFilename()", () => {
  it("lowercases and strips punctuation", () => {
    assert.equal(normalizeFilename("Acme Corp — Proposal (2).pdf"), "acme corp proposal 2");
  });

  it("collapses whitespace", () => {
    assert.equal(normalizeFilename("  Foo   Bar  "), "foo bar");
  });
});

describe("parseEstimationSheet()", () => {
  it("parses a standard feature breakdown table", () => {
    const gridData = {
      rowData: [
        // Header row
        { values: [
          { formattedValue: "Feature" },
          { formattedValue: "Role" },
          { formattedValue: "Hours" },
          { formattedValue: "Rate (EUR/h)" },
          { formattedValue: "Cost (EUR)" },
        ]},
        // Data rows
        { values: [
          { formattedValue: "Authentication" },
          { formattedValue: "Senior Developer" },
          { formattedValue: "80" },
          { formattedValue: "85" },
          { formattedValue: "6800" },
        ]},
        { values: [
          { formattedValue: "CMS Integration" },
          { formattedValue: "Mid Developer" },
          { formattedValue: "40" },
          { formattedValue: "75" },
          { formattedValue: "3000" },
        ]},
        // Total row
        { values: [
          { formattedValue: "Total" },
          { formattedValue: "" },
          { formattedValue: "120" },
          { formattedValue: "" },
          { formattedValue: "9800" },
        ]},
      ],
    };

    const result = parseEstimationSheet("Acme Corp", "sheet123", gridData);

    assert.equal(result.projectName, "Acme Corp");
    assert.equal(result.sheetId, "sheet123");
    assert.equal(result.totalHours, 120);
    assert.equal(result.totalCostEur, 9800);
    assert.equal(result.features.length, 2);
    assert.deepEqual(result.features[0], {
      featureName: "Authentication",
      role: "Senior Developer",
      hours: 80,
      costEur: 6800,
    });
    assert.deepEqual(result.teamRoles, ["Senior Developer", "Mid Developer"]);
  });

  it("detects header row by column name patterns", () => {
    const gridData = {
      rowData: [
        // Metadata row (not the header)
        { values: [
          { formattedValue: "Project: Acme" },
          { formattedValue: "" },
        ]},
        // Actual header
        { values: [
          { formattedValue: "Task" },
          { formattedValue: "Role" },
          { formattedValue: "Hrs" },
          { formattedValue: "Rate" },
          { formattedValue: "Cost" },
        ]},
        { values: [
          { formattedValue: "API Layer" },
          { formattedValue: "Architect" },
          { formattedValue: "20" },
          { formattedValue: "120" },
          { formattedValue: "2400" },
        ]},
      ],
    };

    const result = parseEstimationSheet("Acme", "s1", gridData);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].featureName, "API Layer");
  });

  it("skips subtotal and total rows", () => {
    const gridData = {
      rowData: [
        { values: [
          { formattedValue: "Feature" },
          { formattedValue: "Role" },
          { formattedValue: "Hours" },
          { formattedValue: "Rate" },
          { formattedValue: "Cost" },
        ]},
        { values: [
          { formattedValue: "Auth" },
          { formattedValue: "Senior Developer" },
          { formattedValue: "40" },
          { formattedValue: "85" },
          { formattedValue: "3400" },
        ]},
        { values: [
          { formattedValue: "Subtotal" },
          { formattedValue: "" },
          { formattedValue: "40" },
          { formattedValue: "" },
          { formattedValue: "3400" },
        ]},
        { values: [
          { formattedValue: "PM Overhead (10%)" },
          { formattedValue: "" },
          { formattedValue: "" },
          { formattedValue: "" },
          { formattedValue: "340" },
        ]},
        { values: [
          { formattedValue: "Total" },
          { formattedValue: "" },
          { formattedValue: "40" },
          { formattedValue: "" },
          { formattedValue: "3740" },
        ]},
      ],
    };

    const result = parseEstimationSheet("X", "s2", gridData);
    assert.equal(result.features.length, 1);
    assert.equal(result.totalCostEur, 3740);
  });

  it("returns empty features for a sheet with no detectable header", () => {
    const gridData = {
      rowData: [
        { values: [{ formattedValue: "Random text" }, { formattedValue: "More text" }] },
      ],
    };

    const result = parseEstimationSheet("X", "s3", gridData);
    assert.equal(result.features.length, 0);
    assert.equal(result.totalHours, 0);
  });
});
