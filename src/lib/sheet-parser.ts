export interface SheetFeature {
  featureName: string;
  role: string;
  hours: number;
  costEur: number;
}

export interface ParsedEstimation {
  projectName: string;
  sheetId: string;
  totalHours: number;
  totalCostEur: number;
  features: SheetFeature[];
  teamRoles: string[];
  fullText: string;
}

interface CellValue {
  formattedValue?: string;
}

interface RowData {
  values?: CellValue[];
}

export interface GridData {
  rowData?: RowData[];
}

const HEADER_PATTERNS: Record<string, RegExp> = {
  feature: /^(feature|task|module|item|scope)/i,
  role: /^role/i,
  hours: /^(hours?|hrs?|effort)/i,
  rate: /^rate/i,
  cost: /^(cost|price|total|amount|eur)/i,
};

const SKIP_ROW_PATTERNS = /^(total|subtotal|sub-total|pm overhead|overhead|grand total|sum)/i;

function cellText(cell?: CellValue): string {
  return (cell?.formattedValue ?? "").trim();
}

function cellNumber(cell?: CellValue): number {
  const raw = cellText(cell).replace(/[^0-9.-]/g, "");
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

function detectHeaderRow(rows: RowData[]): { index: number; columns: Record<string, number> } | null {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].values ?? [];
    const columns: Record<string, number> = {};

    for (let j = 0; j < cells.length; j++) {
      const text = cellText(cells[j]);
      for (const [key, pattern] of Object.entries(HEADER_PATTERNS)) {
        if (pattern.test(text) && !(key in columns)) {
          columns[key] = j;
        }
      }
    }

    // Need at least feature + hours OR feature + cost to be a valid header
    if ("feature" in columns && ("hours" in columns || "cost" in columns)) {
      return { index: i, columns };
    }
  }

  return null;
}

export function parseEstimationSheet(
  projectName: string,
  sheetId: string,
  gridData: GridData,
): ParsedEstimation {
  const rows = gridData.rowData ?? [];
  const header = detectHeaderRow(rows);

  if (!header) {
    const fullText = rows
      .map((r) => (r.values ?? []).map(cellText).filter(Boolean).join(" | "))
      .filter(Boolean)
      .join("\n");
    return { projectName, sheetId, totalHours: 0, totalCostEur: 0, features: [], teamRoles: [], fullText };
  }

  const features: SheetFeature[] = [];
  let totalHours = 0;
  let totalCostEur = 0;
  const roles = new Set<string>();
  const textLines: string[] = [];

  for (let i = header.index + 1; i < rows.length; i++) {
    const cells = rows[i].values ?? [];
    const featureText = cellText(cells[header.columns.feature]);

    if (!featureText) continue;

    // Build full text regardless
    textLines.push((cells).map(cellText).filter(Boolean).join(" | "));

    // Check for total/subtotal rows — extract totals but don't add as features
    if (SKIP_ROW_PATTERNS.test(featureText)) {
      const rowHours = header.columns.hours !== undefined ? cellNumber(cells[header.columns.hours]) : 0;
      const rowCost = header.columns.cost !== undefined ? cellNumber(cells[header.columns.cost]) : 0;
      if (/^total$/i.test(featureText) || /^grand total$/i.test(featureText)) {
        totalHours = rowHours || totalHours;
        totalCostEur = rowCost || totalCostEur;
      }
      continue;
    }

    const role = header.columns.role !== undefined ? cellText(cells[header.columns.role]) : "";
    const hours = header.columns.hours !== undefined ? cellNumber(cells[header.columns.hours]) : 0;
    const costEur = header.columns.cost !== undefined ? cellNumber(cells[header.columns.cost]) : 0;

    if (role) roles.add(role);
    features.push({ featureName: featureText, role, hours, costEur });
  }

  // If no explicit total row, sum from features
  if (totalHours === 0) totalHours = features.reduce((sum, f) => sum + f.hours, 0);
  if (totalCostEur === 0) totalCostEur = features.reduce((sum, f) => sum + f.costEur, 0);

  // Add header to text
  const headerText = (rows[header.index].values ?? []).map(cellText).filter(Boolean).join(" | ");
  const fullText = `${projectName}\n\n${headerText}\n${textLines.join("\n")}`;

  return {
    projectName,
    sheetId,
    totalHours,
    totalCostEur,
    features,
    teamRoles: [...roles],
    fullText,
  };
}

export function normalizeFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")           // strip extension
    .replace(/[^\w\s]/g, " ")          // punctuation → space
    .replace(/\s+/g, " ")             // collapse whitespace
    .trim()
    .toLowerCase();
}
