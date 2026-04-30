# Google Template Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local setup command that creates high-quality starter Google Docs and Sheets templates in the adopter's Drive.

**Architecture:** Keep Google API request construction in pure, tested builders under `src/templates/`. Keep network/auth concerns in `scripts/setup-google-templates.ts`. Preserve the existing runtime contract: users still set `GDRIVE_TEMPLATE_ID` and `GSHEETS_TEMPLATE_ID`.

**Tech Stack:** TypeScript ESM, Node 20 fetch, Google Drive API, Google Docs API, Google Sheets API, `node:test`.

---

### Task 1: Pure Template Builders

**Files:**
- Create: `src/templates/google-templates.ts`
- Create: `src/templates/google-templates.test.ts`

- [ ] Write tests for offer placeholders, profile-driven brand colors, sheet headers, sheet descriptions, validation requests, and absence of private brand names.
- [ ] Implement `buildOfferTemplatePlan(profile)`.
- [ ] Implement `buildEstimationSheetTemplatePlan(profile, sheetId)`.
- [ ] Run `npx tsx --test src/templates/google-templates.test.ts`.

### Task 2: Google Setup Script

**Files:**
- Create: `scripts/setup-google-templates.ts`
- Modify: `package.json`

- [ ] Add a script that reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and target folder from `--folder-id` or `GDRIVE_ROOT_FOLDER_ID`.
- [ ] Create a Google Doc and apply the offer template batchUpdate plan.
- [ ] Create a Google Sheet, write the header/description rows, and apply sheet formatting and validations.
- [ ] Print `GDRIVE_TEMPLATE_ID` and `GSHEETS_TEMPLATE_ID`.
- [ ] Add `npm run setup:google-templates`.

### Task 3: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/setup.md`
- Modify: `docs/deployment/vercel.md`
- Modify: `docs/configuration.md`

- [ ] Explain that users without existing templates should run `npm run setup:google-templates`.
- [ ] Document the generated Doc placeholders and Sheet columns.
- [ ] Clarify that templates remain user-owned and configurable through the agency profile.

### Task 4: Verification

**Files:**
- Repository-wide checks

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run scan:secrets`.
- [ ] Run `npm run check:mcp-isolation`.
- [ ] Run `npm run audit:high`.
- [ ] Run `git diff --check`.
