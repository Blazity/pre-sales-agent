import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Set required env vars before importing the module
const REQUIRED_ENV_VARS: Record<string, string> = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
  GSHEETS_TEMPLATE_ID: "test-sheet-template",
};
for (const [k, v] of Object.entries(REQUIRED_ENV_VARS)) {
  if (!process.env[k]) process.env[k] = v;
}

const {
  parseFormattedText,
  buildChartSheetData,
  groupSections,
  buildSimpleBatch,
  buildTableFillRequests,
  extractCellPositions,
  buildEstimationRows,
  calculateCalendarDays,
  fileHasAllowedAncestor,
} = await import("./google-workspace.js");

// ── parseFormattedText (unchanged) ──────────────────────────────────────────

describe("fileHasAllowedAncestor()", () => {
  it("allows a file with a direct allowed parent", async () => {
    const fetchMock = async (url: string) => {
      assert.ok(url.includes("/drive/v3/files/file_1"));
      return new Response(JSON.stringify({ id: "file_1", parents: ["folder_allowed"] }), { status: 200 });
    };

    const allowed = await fileHasAllowedAncestor("file_1", ["folder_allowed"], "token", fetchMock as typeof fetch);
    assert.equal(allowed, true);
  });

  it("allows a file with an allowed ancestor folder", async () => {
    const parents: Record<string, string[]> = {
      file_1: ["folder_child"],
      folder_child: ["folder_allowed"],
    };
    const fetchMock = async (url: string) => {
      const id = url.match(/files\/([^?]+)/)?.[1] ?? "";
      return new Response(JSON.stringify({ id, parents: parents[id] ?? [] }), { status: 200 });
    };

    const allowed = await fileHasAllowedAncestor("file_1", ["folder_allowed"], "token", fetchMock as typeof fetch);
    assert.equal(allowed, true);
  });

  it("blocks a file outside allowed folders", async () => {
    const parents: Record<string, string[]> = {
      file_1: ["folder_other"],
      folder_other: [],
    };
    const fetchMock = async (url: string) => {
      const id = url.match(/files\/([^?]+)/)?.[1] ?? "";
      return new Response(JSON.stringify({ id, parents: parents[id] ?? [] }), { status: 200 });
    };

    const allowed = await fileHasAllowedAncestor("file_1", ["folder_allowed"], "token", fetchMock as typeof fetch);
    assert.equal(allowed, false);
  });
});

describe("parseFormattedText()", () => {
  it("parses plain text", () => {
    const runs = parseFormattedText("hello world");
    assert.equal(runs.length, 1);
    assert.equal(runs[0].text, "hello world");
    assert.equal(runs[0].bold, undefined);
    assert.equal(runs[0].italic, undefined);
  });

  it("parses **bold** markers", () => {
    const runs = parseFormattedText("this is **bold** text");
    assert.equal(runs.length, 3);
    assert.equal(runs[0].text, "this is ");
    assert.equal(runs[1].text, "bold");
    assert.equal(runs[1].bold, true);
    assert.equal(runs[2].text, " text");
  });

  it("parses *italic* markers", () => {
    const runs = parseFormattedText("this is *italic* text");
    assert.equal(runs.length, 3);
    assert.equal(runs[1].text, "italic");
    assert.equal(runs[1].italic, true);
  });

  it("parses mixed bold and italic", () => {
    const runs = parseFormattedText("**bold** and *italic*");
    assert.equal(runs.length, 3);
    assert.equal(runs[0].text, "bold");
    assert.equal(runs[0].bold, true);
    assert.equal(runs[1].text, " and ");
    assert.equal(runs[2].text, "italic");
    assert.equal(runs[2].italic, true);
  });

  it("parses ~~#HEX~~colored~~ text", () => {
    const runs = parseFormattedText("price: ~~#F97316~~€50,000~~");
    assert.equal(runs.length, 2);
    assert.equal(runs[0].text, "price: ");
    assert.equal(runs[1].text, "€50,000");
    assert.equal(runs[1].color, "#F97316");
  });

  it("parses mixed bold and colored text", () => {
    const runs = parseFormattedText("**bold** and ~~#3C43E7~~blue~~");
    assert.equal(runs.length, 3);
    assert.equal(runs[0].text, "bold");
    assert.equal(runs[0].bold, true);
    assert.equal(runs[1].text, " and ");
    assert.equal(runs[2].text, "blue");
    assert.equal(runs[2].color, "#3C43E7");
  });
});

// ── groupSections ───────────────────────────────────────────────────────────

describe("groupSections()", () => {
  it("returns empty groups for empty array", () => {
    assert.deepEqual(groupSections([]), []);
  });

  it("groups all simple sections into one group", () => {
    const sections = [
      { type: "heading" as const, level: 1 as const, text: "Title" },
      { type: "paragraph" as const, text: "Body" },
    ];
    const groups = groupSections(sections);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].type, "simple");
    if (groups[0].type === "simple") {
      assert.equal(groups[0].sections.length, 2);
      assert.deepEqual(groups[0].originalIndices, [0, 1]);
    }
  });

  it("table at start creates table group + simple group", () => {
    const sections = [
      { type: "table" as const, headers: ["A"], rows: [["1"]] },
      { type: "paragraph" as const, text: "After" },
    ];
    const groups = groupSections(sections);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].type, "table");
    assert.equal(groups[1].type, "simple");
  });

  it("table in middle splits into simple + table + simple", () => {
    const sections = [
      { type: "heading" as const, level: 1 as const, text: "Before" },
      { type: "table" as const, headers: ["A"], rows: [["1"]] },
      { type: "paragraph" as const, text: "After" },
    ];
    const groups = groupSections(sections);
    assert.equal(groups.length, 3);
    assert.equal(groups[0].type, "simple");
    assert.equal(groups[1].type, "table");
    assert.equal(groups[2].type, "simple");
  });

  it("multiple tables are correctly grouped", () => {
    const sections = [
      { type: "table" as const, headers: ["A"], rows: [["1"]] },
      { type: "table" as const, headers: ["B"], rows: [["2"]] },
    ];
    const groups = groupSections(sections);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].type, "table");
    assert.equal(groups[1].type, "table");
    if (groups[0].type === "table") assert.equal(groups[0].originalIndex, 0);
    if (groups[1].type === "table") assert.equal(groups[1].originalIndex, 1);
  });
});

// ── buildSimpleBatch ────────────────────────────────────────────────────────

describe("buildSimpleBatch()", () => {
  it("single heading → correct insert + style + charsInserted", () => {
    const { requests, charsInserted } = buildSimpleBatch(
      [{ type: "heading", level: 1, text: "Title" }],
      1, [0],
    );
    const insert = requests.find((r: any) => r.insertText);
    assert.ok(insert);
    assert.equal(insert.insertText.text, "Title\n");
    assert.equal(insert.insertText.location.index, 1);
    const style = requests.find((r: any) => r.updateParagraphStyle);
    assert.ok(style);
    assert.equal(style.updateParagraphStyle.paragraphStyle.namedStyleType, "HEADING_1");
    assert.equal(charsInserted, 6); // "Title\n"
  });

  it("heading + paragraph → spacing \\n between them", () => {
    const { requests, charsInserted } = buildSimpleBatch(
      [
        { type: "heading", level: 2, text: "H" },
        { type: "paragraph", text: "P" },
      ],
      1, [0, 1],
    );
    // First: heading "H\n" (2 chars), then spacing "\n" (1 char), then paragraph "P\n" (2 chars)
    const inserts = requests.filter((r: any) => r.insertText);
    assert.equal(inserts[0].insertText.text, "H\n");
    assert.equal(inserts[0].insertText.location.index, 1);
    assert.equal(inserts[1].insertText.text, "\n"); // spacing
    assert.equal(inserts[1].insertText.location.index, 3); // 1 + 2
    assert.equal(inserts[2].insertText.text, "P\n");
    assert.equal(inserts[2].insertText.location.index, 4); // 1 + 2 + 1
    assert.equal(charsInserted, 5); // 2 + 1 + 2
  });

  it("paragraph with **bold** → correct style range relative to cursor", () => {
    const { requests } = buildSimpleBatch(
      [{ type: "paragraph", text: "Hello **world** end" }],
      10, [0],
    );
    // cursor=10, spacing \n at 10 (since cursor > 1), then insert at 11
    const boldStyle = requests.find((r: any) => r.updateTextStyle);
    assert.ok(boldStyle);
    // "Hello " is 6 chars, cursor starts at 11
    assert.equal(boldStyle.updateTextStyle.range.startIndex, 11 + 6);
    assert.equal(boldStyle.updateTextStyle.range.endIndex, 11 + 6 + 5);
    assert.equal(boldStyle.updateTextStyle.textStyle.bold, true);
  });

  it("bullet list → correct text + createParagraphBullets range", () => {
    const { requests } = buildSimpleBatch(
      [{ type: "bullet_list", items: ["Item 1", "Item 2"] }],
      1, [0],
    );
    const insert = requests.find((r: any) => r.insertText);
    assert.ok(insert);
    assert.equal(insert.insertText.text, "Item 1\nItem 2\n");
    const bullets = requests.find((r: any) => r.createParagraphBullets);
    assert.ok(bullets);
    assert.equal(bullets.createParagraphBullets.bulletPreset, "BULLET_DISC_CIRCLE_SQUARE");
  });

  it("bullet list with **bold** items → updateTextStyle with bold", () => {
    const { requests } = buildSimpleBatch(
      [{ type: "bullet_list", items: ["**Bold item**", "Plain item"] }],
      1, [0],
    );
    const insert = requests.find((r: any) => r.insertText);
    assert.ok(insert);
    assert.equal(insert.insertText.text, "Bold item\nPlain item\n");
    const boldStyle = requests.find((r: any) => r.updateTextStyle?.textStyle?.bold);
    assert.ok(boldStyle, "Expected an updateTextStyle request with bold");
    assert.equal(boldStyle.updateTextStyle.range.startIndex, 1);
    assert.equal(boldStyle.updateTextStyle.range.endIndex, 1 + "Bold item".length);
    assert.equal(boldStyle.updateTextStyle.textStyle.bold, true);
  });

  it("starting cursor > 1 → spacing before first section", () => {
    const { requests } = buildSimpleBatch(
      [{ type: "heading", level: 1, text: "X" }],
      5, [0],
    );
    // First request should be spacing \n at cursor 5
    assert.equal(requests[0].insertText.text, "\n");
    assert.equal(requests[0].insertText.location.index, 5);
    // Then heading at cursor 6
    assert.equal(requests[1].insertText.text, "X\n");
    assert.equal(requests[1].insertText.location.index, 6);
  });

  it("starting cursor = 1 → no spacing before first section", () => {
    const { requests } = buildSimpleBatch(
      [{ type: "heading", level: 1, text: "X" }],
      1, [0],
    );
    // First request should be the heading directly, not spacing
    assert.equal(requests[0].insertText.text, "X\n");
    assert.equal(requests[0].insertText.location.index, 1);
  });

  it("paragraph with alignment → correct updateParagraphStyle", () => {
    const { requests } = buildSimpleBatch(
      [{ type: "paragraph", text: "Centered", alignment: "CENTER" }],
      1, [0],
    );
    const alignStyle = requests.find(
      (r: any) => r.updateParagraphStyle?.paragraphStyle?.alignment,
    );
    assert.ok(alignStyle);
    assert.equal(alignStyle.updateParagraphStyle.paragraphStyle.alignment, "CENTER");
  });

  it("paragraph with fontSize → correct updateTextStyle", () => {
    const { requests } = buildSimpleBatch(
      [{ type: "paragraph", text: "Big", fontSize: 18 }],
      1, [0],
    );
    const fontStyle = requests.find(
      (r: any) => r.updateTextStyle?.textStyle?.fontSize,
    );
    assert.ok(fontStyle);
    assert.equal(fontStyle.updateTextStyle.textStyle.fontSize.magnitude, 18);
    assert.equal(fontStyle.updateTextStyle.textStyle.fontSize.unit, "PT");
  });

  it("heading with fontSize → correct updateTextStyle", () => {
    const { requests } = buildSimpleBatch(
      [{ type: "heading", level: 1, text: "Title", fontSize: 32 }],
      1, [0],
    );
    const fontStyle = requests.find(
      (r: any) => r.updateTextStyle?.textStyle?.fontSize,
    );
    assert.ok(fontStyle);
    assert.equal(fontStyle.updateTextStyle.textStyle.fontSize.magnitude, 32);
  });
});

// ── buildTableFillRequests ──────────────────────────────────────────────────

describe("buildTableFillRequests()", () => {
  it("2×2 table with mock cellPositions → correct insert positions with shift", () => {
    const cellPositions = [[10, 15], [20, 25]];
    const { requests, totalTextInserted } = buildTableFillRequests(
      ["Name", "Age"],
      [["Alice", "30"]],
      cellPositions,
    );
    // Header: "Name" at 10+0=10, "Age" at 15+4=19
    // Row: "Alice" at 20+4+3=27, "30" at 25+4+3+5=37
    assert.equal(requests[0].insertText.location.index, 10);
    assert.equal(requests[0].insertText.text, "Name");
    // Bold for "Name"
    assert.equal(requests[1].updateTextStyle.range.startIndex, 10);
    assert.equal(requests[1].updateTextStyle.range.endIndex, 14);
    assert.equal(requests[2].insertText.location.index, 19); // 15 + 4
    assert.equal(requests[2].insertText.text, "Age");
    // Bold for "Age"
    assert.equal(requests[3].updateTextStyle.range.startIndex, 19);
    assert.equal(requests[3].updateTextStyle.range.endIndex, 22);
    // Data row
    assert.equal(requests[4].insertText.location.index, 27); // 20 + 7
    assert.equal(requests[4].insertText.text, "Alice");
    assert.equal(requests[5].insertText.location.index, 37); // 25 + 12
    assert.equal(requests[5].insertText.text, "30");
    assert.equal(totalTextInserted, 14); // 4+3+5+2
  });

  it("bold header styling has correct ranges", () => {
    const cellPositions = [[5, 10], [20, 25]];
    const { requests } = buildTableFillRequests(
      ["A", "B"],
      [["x", "y"]],
      cellPositions,
    );
    // "A" at 5, bold [5,6]
    assert.equal(requests[1].updateTextStyle.range.startIndex, 5);
    assert.equal(requests[1].updateTextStyle.range.endIndex, 6);
    // "B" at 10+1=11, bold [11,12]
    assert.equal(requests[3].updateTextStyle.range.startIndex, 11);
    assert.equal(requests[3].updateTextStyle.range.endIndex, 12);
  });

  it("empty cells are skipped", () => {
    const cellPositions = [[5, 10]];
    const { requests, totalTextInserted } = buildTableFillRequests(
      ["A", ""],
      [],
      cellPositions,
    );
    // Only "A" + bold for "A"
    assert.equal(requests.length, 2);
    assert.equal(totalTextInserted, 1);
  });

  it("single row (headers only) → bold applied", () => {
    const cellPositions = [[5, 10]];
    const { requests } = buildTableFillRequests(["X", "Y"], [], cellPositions);
    const boldStyles = requests.filter((r: any) => r.updateTextStyle);
    assert.equal(boldStyles.length, 2);
  });

  it("header text color → correct foregroundColor on header cells", () => {
    const cellPositions = [[5, 10]];
    const { requests } = buildTableFillRequests(
      ["A", "B"], [], cellPositions, { headerTextColor: "#FFFFFF" },
    );
    const colorStyles = requests.filter(
      (r: any) => r.updateTextStyle?.textStyle?.foregroundColor,
    );
    assert.equal(colorStyles.length, 2);
    assert.deepEqual(
      colorStyles[0].updateTextStyle.textStyle.foregroundColor,
      { color: { rgbColor: { red: 1, green: 1, blue: 1 } } },
    );
  });

  it("total row text color → correct foregroundColor on last row", () => {
    const cellPositions = [[5, 10], [20, 25]];
    const { requests } = buildTableFillRequests(
      ["A", "B"], [["x", "y"]], cellPositions, { totalRowTextColor: "#FFFFFF" },
    );
    const colorStyles = requests.filter(
      (r: any) => r.updateTextStyle?.textStyle?.foregroundColor,
    );
    assert.equal(colorStyles.length, 2);
  });
});

// ── extractCellPositions ────────────────────────────────────────────────────

describe("extractCellPositions()", () => {
  it("extracts correct cell positions from mock document", () => {
    const doc = {
      body: {
        content: [
          { paragraph: {}, startIndex: 0, endIndex: 1 },
          {
            table: {
              tableRows: [
                {
                  tableCells: [
                    { content: [{ startIndex: 5 }] },
                    { content: [{ startIndex: 10 }] },
                  ],
                },
                {
                  tableCells: [
                    { content: [{ startIndex: 20 }] },
                    { content: [{ startIndex: 25 }] },
                  ],
                },
              ],
            },
            startIndex: 2,
            endIndex: 30,
          },
        ],
      },
    };
    const positions = extractCellPositions(doc, 2);
    assert.deepEqual(positions, [[5, 10], [20, 25]]);
  });

  it("finds table when startIndex is slightly above search value", () => {
    const doc = {
      body: {
        content: [
          { paragraph: {}, startIndex: 0, endIndex: 1 },
          {
            table: {
              tableRows: [
                {
                  tableCells: [
                    { content: [{ startIndex: 8 }] },
                    { content: [{ startIndex: 13 }] },
                  ],
                },
              ],
            },
            startIndex: 4,
            endIndex: 20,
          },
        ],
      },
    };
    const positions = extractCellPositions(doc, 2);
    assert.deepEqual(positions, [[8, 13]]);
  });

  it("throws when table not found", () => {
    const doc = {
      body: {
        content: [{ paragraph: {}, startIndex: 0, endIndex: 1 }],
      },
    };
    assert.throws(() => extractCellPositions(doc, 99), /Table not found/);
  });
});

// ── buildChartSheetData (unchanged) ─────────────────────────────────────────

describe("buildChartSheetData()", () => {
  it("builds correct 2D array with header row and data rows", () => {
    const data = buildChartSheetData(
      ["Q1", "Q2", "Q3"],
      [
        { label: "Revenue", data: [100, 200, 300] },
        { label: "Cost", data: [50, 100, 150] },
      ],
    );
    assert.equal(data.length, 3);
    assert.deepEqual(data[0], ["", "Q1", "Q2", "Q3"]);
    assert.deepEqual(data[1], ["Revenue", 100, 200, 300]);
    assert.deepEqual(data[2], ["Cost", 50, 100, 150]);
  });

  it("handles single dataset", () => {
    const data = buildChartSheetData(
      ["A", "B"],
      [{ label: "Values", data: [10, 20] }],
    );
    assert.equal(data.length, 2);
    assert.deepEqual(data[0], ["", "A", "B"]);
    assert.deepEqual(data[1], ["Values", 10, 20]);
  });

  it("handles empty labels and data", () => {
    const data = buildChartSheetData([], []);
    assert.equal(data.length, 1);
    assert.deepEqual(data[0], [""]);
  });
});

// ── buildEstimationRows ──────────────────────────────────────────────────────

describe("buildEstimationRows()", () => {
  it("builds 9-column rows with module subtotals for a single area", () => {
    const { dataRows, subtotalPositions } = buildEstimationRows([
      {
        name: "Project Setup",
        items: [
          { name: "Next.js setup", effort_md: 1, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "Boilerplate", figma_link: "" },
          { name: "CI/CD", effort_md: 0.5, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
        ],
      },
    ]);
    assert.equal(dataRows.length, 2);
    assert.deepEqual(dataRows[0], ["Project Setup", "Next.js setup", 1, 1, "Frontend", false, "Low", "Boilerplate", ""]);
    assert.deepEqual(dataRows[1], ["", "CI/CD", 0.5, 0.5, "Frontend", false, "Low", "", ""]);
    assert.equal(subtotalPositions.length, 1);
    assert.equal(subtotalPositions[0].sheetRow, 5);
    assert.equal(subtotalPositions[0].firstDataRow, 3);
    assert.equal(subtotalPositions[0].lastDataRow, 4);
  });

  it("auto-calculates risk buffer from risk level", () => {
    const { dataRows } = buildEstimationRows([
      {
        name: "Dev",
        items: [
          { name: "Simple", effort_md: 2, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
          { name: "Risky", effort_md: 4, type: "Backend", optional: false, risk: "Medium" as const, assumptions: "", figma_link: "" },
          { name: "Very risky", effort_md: 4, type: "Backend", optional: false, risk: "High" as const, assumptions: "", figma_link: "" },
        ],
      },
    ]);
    assert.equal(dataRows[0][3], 2);     // Low: 2 × 1.0 = 2
    assert.equal(dataRows[1][3], 4.5);   // Medium: 4 × 1.15 = 4.6 → round to nearest 0.25 = 4.5
    assert.equal(dataRows[2][3], 5.25);  // High: 4 × 1.3 = 5.2 → round to nearest 0.25 = 5.25
  });

  it("rounds effort to nearest 0.25", () => {
    const { dataRows } = buildEstimationRows([
      {
        name: "Dev",
        items: [
          { name: "Task", effort_md: 0.3, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
        ],
      },
    ]);
    assert.equal(dataRows[0][2], 0.25);
    assert.equal(dataRows[0][3], 0.25);
  });

  it("handles multiple areas with correct subtotal positions", () => {
    const { dataRows, subtotalPositions } = buildEstimationRows([
      {
        name: "Setup",
        items: [
          { name: "Init", effort_md: 1, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
        ],
      },
      {
        name: "Dev",
        items: [
          { name: "Build", effort_md: 10, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
          { name: "Test", effort_md: 2, type: "QA", optional: true, risk: "Low" as const, assumptions: "", figma_link: "" },
        ],
      },
    ]);
    assert.equal(dataRows.length, 3);
    assert.equal(subtotalPositions.length, 2);
    assert.equal(subtotalPositions[0].sheetRow, 4);
    assert.equal(subtotalPositions[0].firstDataRow, 3);
    assert.equal(subtotalPositions[0].lastDataRow, 3);
    assert.equal(subtotalPositions[1].sheetRow, 7);
    assert.equal(subtotalPositions[1].firstDataRow, 5);
    assert.equal(subtotalPositions[1].lastDataRow, 6);
  });

  it("module name only on first item, blank on rest", () => {
    const { dataRows } = buildEstimationRows([
      {
        name: "Area",
        items: [
          { name: "A", effort_md: 1, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
          { name: "B", effort_md: 2, type: "Frontend", optional: false, risk: "Low" as const, assumptions: "", figma_link: "" },
        ],
      },
    ]);
    assert.equal(dataRows[0][0], "Area");
    assert.equal(dataRows[1][0], "");
  });

  it("handles item with zero effort", () => {
    const { dataRows } = buildEstimationRows([
      {
        name: "Optional",
        items: [{ name: "Nice to have", effort_md: 0, type: "Frontend", optional: true, risk: "Low" as const, assumptions: "", figma_link: "" }],
      },
    ]);
    assert.equal(dataRows[0][2], 0);
    assert.equal(dataRows[0][3], 0);
  });
});

// ── calculateCalendarDays ───────────────────────────────────────────────────

describe("calculateCalendarDays()", () => {
  it("calculates total MD ÷ devs with 15% buffer", () => {
    const days = calculateCalendarDays(30, 2);
    assert.equal(days, 18); // 30/2 * 1.15 = 17.25 → ceil = 18
  });

  it("rounds up to whole days", () => {
    const days = calculateCalendarDays(10, 3);
    assert.equal(days, 4); // 10/3 * 1.15 = 3.83 → ceil = 4
  });

  it("handles single developer", () => {
    const days = calculateCalendarDays(20, 1);
    assert.equal(days, 23); // 20/1 * 1.15 = 23
  });
});

// ── sheets_create_estimation row limits ───────────────────────────────────────

describe("sheets_create_estimation row limits", () => {
  it("buildEstimationRows handles >33 items without error", () => {
    const areas = [{
      name: "Large Area",
      items: Array.from({ length: 50 }, (_, i) => ({
        name: `Item ${i + 1}`,
        effort_md: 1,
        type: "Frontend",
        optional: false,
        risk: "Low" as const,
        assumptions: "Test",
        figma_link: "",
      })),
    }];
    const { dataRows } = buildEstimationRows(areas);
    assert.equal(dataRows.length, 50);
  });
});
