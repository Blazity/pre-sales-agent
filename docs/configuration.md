# Configuration

Configuration is split into provider credentials and agency profile data.

Provider credentials live in Vercel Environment Variables for deployed projects. `.env.example` exists only as a local development template.

Agency profile data should live in `config/agency.example.json` and later in user-specific profile files. The profile controls agency name, positioning, brand colors, pricing rules, offer sections, proof points, research domains, and Slack copy.

Set `AGENCY_PROFILE_PATH=config/agency.example.json` to load the starter profile. For a real agency, copy the file to an untracked profile path, replace the proof points with verified public claims, and point `AGENCY_PROFILE_PATH` at that file.

`AGENCY_NAME` and `AGENCY_ACCENT_COLOR` are also used by `scripts/create-template.ts` when creating a Google Docs template. `CASE_STUDIES_BASE_URL` controls which public case-study listing is used by `scripts/seed-case-studies.ts`.

## Environment Groups

| Group | Required for deploy | Variables |
|---|---|---|
| Core AI | Yes | `ANTHROPIC_API_KEY` |
| Slack HTTP app | Yes | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` |
| Google Workspace | Yes | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GDRIVE_ROOT_FOLDER_ID`, `GDRIVE_TEMPLATE_ID`, `GSHEETS_TEMPLATE_ID` |
| Retrieval | Yes | `PINECONE_API_KEY`, `PINECONE_INDEX`, `VOYAGE_API_KEY` |
| Runtime state | Yes | `REDIS_URL`, `JOB_QUEUE_PROVIDER`, `VERCEL_QUEUE_TOPIC` |
| Vercel workspace | Yes | `AGENT_WORKSPACE_PROVIDER` |
| Agency profile | Yes | `AGENCY_PROFILE_PATH`, `AGENCY_NAME`, `AGENCY_ACCENT_COLOR`, `CASE_STUDIES_BASE_URL` |
| Web research | Optional | `BRAVE_SEARCH_API_KEY` |
| Figma enrichment | Optional | `FIGMA_API_KEY` |
| Knowledge-base seeding | Optional | `GDRIVE_ESTIMATIONS_FOLDER_ID`, `GDRIVE_PROPOSALS_FOLDER_ID`, `VOYAGE_RPM` |
| Admin panel | Optional | `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_ALLOWED_IPS`, `GDRIVE_OUTPUT_FOLDER_ID` |

See `docs/setup.md` for provider setup steps and `docs/deployment/vercel.md` for Vercel-specific defaults.
