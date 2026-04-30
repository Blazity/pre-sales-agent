# Google Template Bootstrap Design

## Goal

Let new adopters create a usable Google Docs offer template and Google Sheets estimation template without starting from blank Google Drive files.

## Design

Add a local bootstrap command that uses the adopter's Google OAuth credentials to create both templates in their configured Drive folder and prints the two environment variables the app already expects:

```bash
npm run setup:google-templates
```

The generated templates stay owned by the adopter's Google account. The repository does not depend on Blazity-owned public template IDs.

## Template Quality

The default visual structure should stay close to the current internal proposal shape without leaking private brand claims:

- Google Doc cover: `{{CLIENT_NAME}} & AGENCY`, `Proposal`, `{{PROJECT_NAME}}`, `{{DATE}}`.
- Typography defaults: JetBrains Mono for the cover headline, Inter for proposal metadata and body-oriented styles.
- Color model: use the configured agency profile colors, with the public starter profile as the default.
- Body remains empty after the cover page because the agent writes the full offer body in `docs_write_sections`.
- Google Sheet: nine columns matching `sheets_create_estimation`, header row, description row, frozen first two rows, sensible widths, dropdown validation for type and risk, checkbox-style boolean validation for optional items, and starter formatting.

## Flexibility

Template construction should be data-driven from the agency profile where practical:

- `name` controls the offer template title and cover agency label.
- `brand.accentColor`, `brand.textColor`, `brand.borderColor`, and `brand.headerTextColor` control Doc and Sheet styling.
- `commercials.currency` appears in sheet descriptions where relevant.

The first implementation should keep template IDs explicit in env vars. Runtime auto-creation can be considered later, after preview deployment behavior is proven.

## Files

- Add pure builders in `src/templates/google-templates.ts`.
- Add tests in `src/templates/google-templates.test.ts`.
- Add `scripts/setup-google-templates.ts` for Google API calls.
- Add `setup:google-templates` to `package.json`.
- Update README and setup/deployment/configuration docs.

## Verification

- Unit tests assert placeholder coverage, brand configurability, sheet headers, sheet validations, and no private brand names in defaults.
- Full gates: typecheck, tests, build, secret scan, MCP isolation, high audit.
