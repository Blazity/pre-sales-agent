import type { AgencyProfile } from "../config/agency-profile.js";

export type GoogleApiRequest = Record<string, unknown>;

export interface OfferTemplatePlan {
  title: string;
  coverText: string;
  placeholders: string[];
  requests: GoogleApiRequest[];
}

export interface EstimationSheetTemplatePlan {
  title: string;
  sheetTitle: string;
  values: string[][];
  requests: GoogleApiRequest[];
}

export const OFFER_TEMPLATE_PLACEHOLDERS = [
  "{{CLIENT_NAME}}",
  "{{PROJECT_NAME}}",
  "{{DATE}}",
] as const;

export const ESTIMATION_TEMPLATE_HEADERS = [
  "Module",
  "Action Item",
  "Effort (MD)",
  "Risk-adjusted Effort (MD)",
  "Type",
  "Optional",
  "Risk",
  "Assumptions",
  "Figma Link",
] as const;

const ESTIMATION_TEMPLATE_DESCRIPTIONS = [
  "Functional module or workstream.",
  "Concrete action item included in the delivery scope.",
  "Base effort in man-days before risk adjustment.",
  "Effort after applying the risk buffer.",
  "Frontend, Backend, Design, QA, or DevOps.",
  "TRUE for optional scope, FALSE for required scope.",
  "Low, Medium, or High delivery risk.",
  "Assumptions behind this item.",
  "Relevant Figma URL, if available.",
] as const;

const BODY_FONT = "Inter";
const DISPLAY_FONT = "JetBrains Mono";
const SHEET_FONT = "Montserrat";

function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : "111827";
  return {
    red: parseInt(normalized.slice(0, 2), 16) / 255,
    green: parseInt(normalized.slice(2, 4), 16) / 255,
    blue: parseInt(normalized.slice(4, 6), 16) / 255,
  };
}

function color(hex: string): Record<string, unknown> {
  return { color: { rgbColor: hexToRgb(hex) } };
}

export function buildOfferTemplatePlan(profile: AgencyProfile): OfferTemplatePlan {
  const titleLine = `${OFFER_TEMPLATE_PLACEHOLDERS[0]} & ${profile.name.toUpperCase()}`;
  const proposalLine = "Proposal";
  const coverText = `${titleLine}\n${proposalLine}\n\n${OFFER_TEMPLATE_PLACEHOLDERS[1]}\n${OFFER_TEMPLATE_PLACEHOLDERS[2]}\n`;

  const titleStart = 1;
  const titleEnd = titleStart + titleLine.length;
  const proposalStart = titleEnd + 1;
  const proposalEnd = proposalStart + proposalLine.length;
  const metaStart = proposalEnd + 2;
  const metaEnd = titleStart + coverText.length - 1;
  const pageBreakIndex = titleStart + coverText.length;

  const textColor = color(profile.brand.textColor);
  const accentColor = color(profile.brand.accentColor);

  const requests: GoogleApiRequest[] = [
    {
      updateDocumentStyle: {
        documentStyle: {
          marginTop: { magnitude: 72, unit: "PT" },
          marginBottom: { magnitude: 72, unit: "PT" },
          marginLeft: { magnitude: 72, unit: "PT" },
          marginRight: { magnitude: 72, unit: "PT" },
        },
        fields: "marginTop,marginBottom,marginLeft,marginRight",
      },
    },
    { insertText: { location: { index: titleStart }, text: coverText } },
    {
      updateTextStyle: {
        range: { startIndex: titleStart, endIndex: titleEnd },
        textStyle: {
          weightedFontFamily: { fontFamily: DISPLAY_FONT },
          fontSize: { magnitude: 28, unit: "PT" },
          foregroundColor: textColor,
        },
        fields: "weightedFontFamily,fontSize,foregroundColor",
      },
    },
    {
      updateTextStyle: {
        range: { startIndex: proposalStart, endIndex: proposalEnd },
        textStyle: {
          weightedFontFamily: { fontFamily: DISPLAY_FONT },
          fontSize: { magnitude: 28, unit: "PT" },
          foregroundColor: accentColor,
        },
        fields: "weightedFontFamily,fontSize,foregroundColor",
      },
    },
    {
      updateTextStyle: {
        range: { startIndex: metaStart, endIndex: metaEnd },
        textStyle: {
          weightedFontFamily: { fontFamily: BODY_FONT },
          fontSize: { magnitude: 14, unit: "PT" },
          foregroundColor: textColor,
        },
        fields: "weightedFontFamily,fontSize,foregroundColor",
      },
    },
    {
      updateParagraphStyle: {
        range: { startIndex: titleStart, endIndex: metaEnd },
        paragraphStyle: {
          spaceAbove: { magnitude: 0, unit: "PT" },
          spaceBelow: { magnitude: 10, unit: "PT" },
          lineSpacing: 115,
        },
        fields: "spaceAbove,spaceBelow,lineSpacing",
      },
    },
    { insertPageBreak: { location: { index: pageBreakIndex } } },
    { insertText: { location: { index: pageBreakIndex + 1 }, text: "\n" } },
  ];

  return {
    title: `${profile.name} Offer Template`,
    coverText,
    placeholders: [...OFFER_TEMPLATE_PLACEHOLDERS],
    requests,
  };
}

function columnWidth(sheetId: number, startIndex: number, endIndex: number, pixelSize: number): GoogleApiRequest {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex, endIndex },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  };
}

function oneOfListValidation(values: string[]): Record<string, unknown> {
  return {
    condition: {
      type: "ONE_OF_LIST",
      values: values.map((userEnteredValue) => ({ userEnteredValue })),
    },
    strict: true,
    showCustomUi: true,
  };
}

function setValidation(sheetId: number, columnIndex: number, rule: Record<string, unknown>): GoogleApiRequest {
  return {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 2,
        endRowIndex: 500,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      rule,
    },
  };
}

export function buildEstimationSheetTemplatePlan(
  profile: AgencyProfile,
  sheetId: number,
): EstimationSheetTemplatePlan {
  const accent = hexToRgb(profile.brand.accentColor);
  const headerText = hexToRgb(profile.brand.headerTextColor);
  const text = hexToRgb(profile.brand.textColor);
  const border = hexToRgb(profile.brand.borderColor);

  const requests: GoogleApiRequest[] = [
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          title: "Estimation",
          gridProperties: {
            rowCount: 120,
            columnCount: ESTIMATION_TEMPLATE_HEADERS.length,
            frozenRowCount: 2,
          },
        },
        fields: "title,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: ESTIMATION_TEMPLATE_HEADERS.length },
        cell: {
          userEnteredFormat: {
            backgroundColor: accent,
            textFormat: { foregroundColor: headerText, bold: true, fontFamily: SHEET_FONT, fontSize: 10 },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: ESTIMATION_TEMPLATE_HEADERS.length },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.98, green: 0.98, blue: 0.98 },
            textFormat: { foregroundColor: text, italic: true, fontFamily: SHEET_FONT, fontSize: 9 },
            wrapStrategy: "WRAP",
            borders: {
              bottom: { style: "SOLID", width: 1, color: border },
            },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,wrapStrategy,borders)",
      },
    },
    columnWidth(sheetId, 0, 1, 160),
    columnWidth(sheetId, 1, 2, 280),
    columnWidth(sheetId, 2, 4, 120),
    columnWidth(sheetId, 4, 7, 120),
    columnWidth(sheetId, 7, 8, 340),
    columnWidth(sheetId, 8, 9, 220),
    setValidation(sheetId, 4, oneOfListValidation(["Frontend", "Backend", "Design", "QA", "DevOps"])),
    setValidation(sheetId, 5, { condition: { type: "BOOLEAN" }, strict: true, showCustomUi: true }),
    setValidation(sheetId, 6, oneOfListValidation(["Low", "Medium", "High"])),
  ];

  return {
    title: `${profile.name} Estimation Template`,
    sheetTitle: "Estimation",
    values: [
      [...ESTIMATION_TEMPLATE_HEADERS],
      [...ESTIMATION_TEMPLATE_DESCRIPTIONS],
    ],
    requests,
  };
}
