# SPEC-011: Table Population Fix

**Status:** Implemented
**Date:** 2026-02-27

---

# Coding Agent Prompt — Table Population Fix

## Context

Tables in generated Google Docs are created (empty structure appears) but never populated with data. The root cause is an exact `startIndex` match in `extractCellPositions` and `executeSections`. When the Google Docs API inserts a table at index N, the resulting table element's `startIndex` can be N+1 or N+2 (the API inserts paragraph breaks around the table structure). The exact `===` match fails, `extractCellPositions` throws "Table not found at index X", the error is caught silently, and the table is left empty.

## Branch

Work on the current branch (master or whatever is checked out). No new branch needed — this is a small targeted fix.

## Scope

You are modifying:
- `src/mcp-servers/google-workspace.ts` — 3 small changes
- `src/mcp-servers/google-workspace.test.ts` — 1 test addition

## Changes

### 1. `extractCellPositions` — fuzzy match (line ~632)

Current:
```typescript
const tableEl = doc.body.content.find(
  (el: any) => el.table && el.startIndex === tableStartIdx,
);
if (!tableEl) throw new Error(`Table not found at index ${tableStartIdx}`);
```

Change to:
```typescript
const tableEl = doc.body.content.find(
  (el: any) => el.table && el.startIndex >= tableStartIdx,
);
if (!tableEl) throw new Error(`Table not found at or after index ${tableStartIdx}`);
```

Uses `>=` instead of `===`. Finds the first table at or after the expected position. Since tables are processed forward in order, this always matches the table that was just inserted.

### 2. `executeSections` table element lookup (line ~752-753)

Current:
```typescript
const tableEl = doc.body.content.find(
  (el: any) => el.table && el.startIndex === tableInsertIdx,
);
```

Change to:
```typescript
const tableEl = doc.body.content.find(
  (el: any) => el.table && el.startIndex >= tableInsertIdx,
);
```

Same fix — this lookup is used for cursor advancement after filling the table. If it doesn't find the table, `tableEl` is undefined and cursor falls back to the old value, breaking all subsequent groups.

### 3. Add error logging in `executeSections` catch block (line ~758)

Current:
```typescript
} catch (err) {
  const label = group.type === "simple"
    ? `Sections ${group.originalIndices.join(",")}`
    : `Section ${group.originalIndex} (table)`;
  errors.push(`${label}: ${String(err)}`);
```

Change to:
```typescript
} catch (err) {
  const label = group.type === "simple"
    ? `Sections ${group.originalIndices.join(",")}`
    : `Section ${group.originalIndex} (table)`;
  console.error(`[docs_write_sections] ${label}: ${String(err)}`);
  errors.push(`${label}: ${String(err)}`);
```

Adds `console.error` so table errors are visible in process logs, not just swallowed into the errors array.

### 4. Add test case for fuzzy match in `extractCellPositions`

In the existing `describe("extractCellPositions()")` block, add a new test:

```typescript
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
          startIndex: 4, // Table starts at 4, but we search from 2
          endIndex: 20,
        },
      ],
    },
  };
  // Search from index 2 — table is at index 4 (offset by API paragraph insertion)
  const positions = extractCellPositions(doc, 2);
  assert.deepEqual(positions, [[8, 13]]);
});
```

Also update the "throws when table not found" test's error message assertion to match the new text:

Current:
```typescript
assert.throws(() => extractCellPositions(doc, 99), /Table not found/);
```

This should still pass since the regex `Table not found` matches the new message "Table not found at or after index 99".

## Verification

```bash
npx tsc --noEmit && node --test dist/mcp-servers/google-workspace.test.js
```

Both must pass.

## Commit

```
fix(docs-formatting): use fuzzy startIndex match for table lookup
```
