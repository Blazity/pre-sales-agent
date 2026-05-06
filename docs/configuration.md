# Configuration

Configuration is split into provider credentials and agency profile data.

Provider credentials live in Vercel Environment Variables for deployed projects. `.env.example` exists only as a local development template.

Agency profile data should live in `config/agency.example.json` and later in user-specific profile files. The profile controls agency name, positioning, brand colors, pricing rules, offer sections, proof points, research domains, and Slack copy.

By default, the app uses the starter agency profile. For a real agency, copy `config/agency.example.json` to an untracked profile path, replace the proof points with verified public claims, and point `AGENCY_PROFILE_PATH` at that file.

`npm run setup:google-templates` uses the agency profile when creating Google Docs and Sheets starter templates. `CASE_STUDIES_BASE_URL` controls which public case-study listing is used by `scripts/seed-case-studies.ts`.

## Environment Groups

| Group | Required for deploy | Variables |
|---|---|---|
| Core AI | Yes | `ANTHROPIC_API_KEY` |
| Slack HTTP app | Yes | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` |
| Google Workspace | Yes | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GDRIVE_ROOT_FOLDER_ID`, `GDRIVE_TEMPLATE_ID`, `GSHEETS_TEMPLATE_ID` |
| Retrieval | Yes | `PINECONE_API_KEY`, `VOYAGE_API_KEY` |
| Retrieval index override | Optional | `PINECONE_INDEX` |
| Workspace override | Optional | `AGENT_WORKSPACE_PROVIDER` |
| Vercel Sandbox snapshot | Automatic on Vercel | Platform-provided Sandbox authentication |
| Private repo clone access | Conditional | `AGENT_REPO_TOKEN` or `GITHUB_TOKEN` |
| Repo source override | Optional | `AGENT_REPO_URL`, `AGENT_REPO_REVISION` |
| Agency profile | Optional | `AGENCY_PROFILE_PATH`, `AGENCY_NAME`, `AGENCY_ACCENT_COLOR`, `CASE_STUDIES_BASE_URL` |
| Web research | Optional | `BRAVE_SEARCH_API_KEY` |
| Figma enrichment | Optional | `FIGMA_API_KEY` |
| Knowledge-base seeding | Optional | `GDRIVE_ESTIMATIONS_FOLDER_ID`, `GDRIVE_PROPOSALS_FOLDER_ID`, `VOYAGE_RPM` |
| Manual test output | Optional | `GDRIVE_OUTPUT_FOLDER_ID` |

See `docs/setup.md` for provider setup steps and `docs/deployment/vercel.md` for Vercel-specific defaults.

Run `npm run doctor:first-launch -- --health-url https://<your-vercel-domain>` after setting first-launch environment variables to verify local env presence, Vercel health, deployed Slack ingress, Google access, Slack auth, and Pinecone access. Use the stable production/project domain that Slack will call, not a deployment-specific preview URL.

Run `npm run doctor:seed` before `npm run seed` to verify the knowledge-base source folders, Google OAuth access, Pinecone index settings, and Voyage embeddings. The source folder IDs are optional for first launch, but required when running the seeding command.

## Template Generation

Run `npm run setup:google-templates` after configuring Google OAuth if you do not already have proposal and estimation templates. The generated files are created in the configured Drive folder and remain editable by the adopter.

The generated Google Doc keeps the existing offer flow: a formatted cover page with `{{CLIENT_NAME}}`, `{{PROJECT_NAME}}`, and `{{DATE}}`, followed by an empty body where the agent writes proposal sections. The generated Google Sheet matches the `sheets_create_estimation` contract: headers and descriptions in rows 1-2, generated work items from row 3, and formulas inserted by the runtime.
