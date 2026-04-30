# SPEC-028: Unmerge Template Cells After Copy

**Status**: Implemented
**Date**: 2026-03-11

## Problem

The Google Sheets template has 13 merged cell ranges (column A for area names, column C for area-level effort, summary rows B:D). After `values.clear`, merges survive. Writing per-item MD values to non-anchor cells is silently dropped by the Sheets API, causing most effort cells to be empty and summary rows to be missing.

## Root Cause

`values.clear` clears cell content but does NOT remove merge structure. The SPEC-026 per-item layout writes to every row in column C, but only merge anchor cells (first cell of each merge) accept writes. All other writes are silently ignored.

## Design

After copying the template and fetching metadata, unmerge all cells before any data writes. Single `batchUpdate` API call with `unmergeCells` requests.

## Files Changed

| File | Change |
|------|--------|
| `src/mcp-servers/google-workspace.ts` | Add `sheets.merges` to metadata fields, add unmerge batchUpdate step |

## Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unmerge all cells in the template copy before writing data, so per-item MD values land in every row.

**Architecture:** Expand the existing metadata fetch to include merge info. If merges exist, send one `batchUpdate` with `unmergeCells` requests. Inserted between step 2 (metadata) and step 3 (clear). No schema or prompt changes.

**Tech Stack:** TypeScript, Google Sheets API v4 batchUpdate

---

### Task 1: Expand metadata fields and add unmerge step

**Files:**
- Modify: `src/mcp-servers/google-workspace.ts:1219` and insert after line 1231

**Step 1: Update the metadata fetch URL to include merges**

Find this line (~1219):

```typescript
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
```

Replace with:

```typescript
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties,sheets.merges`,
```

**Step 2: Update the metadata type to include merges**

Find this type (~1226-1228):

```typescript
      const meta = (await metaRes.json()) as {
        sheets: Array<{ properties: { sheetId: number; title: string; gridProperties: { rowCount: number } } }>;
      };
```

Replace with:

```typescript
      const meta = (await metaRes.json()) as {
        sheets: Array<{
          properties: { sheetId: number; title: string; gridProperties: { rowCount: number } };
          merges?: Array<{ sheetId: number; startRowIndex: number; endRowIndex: number; startColumnIndex: number; endColumnIndex: number }>;
        }>;
      };
```

**Step 3: Add unmerge step after metadata extraction**

Find this line (~1232):

```typescript
      // Quote sheet title for A1 notation (handles spaces and special chars)
```

Insert BEFORE it:

```typescript
      // 2b. Unmerge all cells so per-item writes land in every row
      const merges = firstSheet.merges ?? [];
      if (merges.length > 0) {
        const unmergeRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: merges.map((m) => ({ unmergeCells: { range: m } })),
            }),
          },
        );
        if (!unmergeRes.ok) {
          const text = await unmergeRes.text();
          return { content: [{ type: "text" as const, text: `Unmerge error: ${text}` }] };
        }
      }

```

**Step 4: Commit**

```bash
git add src/mcp-servers/google-workspace.ts
git commit -m "fix(mandays): unmerge template cells after copy so per-item writes land"
```

---

### Task 2: Type-check and test

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (no test changes needed — existing tests don't use the API).

**Step 3: Commit spec update**

Mark tasks complete in this spec, update status to "Implemented", update `.ai/specs/README.md`.

```bash
git add .ai/specs/SPEC-028-unmerge-template-cells.md .ai/specs/README.md
git commit -m "docs(mandays): mark SPEC-028 as implemented"
```

---

- [x] Task 1: Expand metadata fields and add unmerge step
- [x] Task 2: Type-check and test
