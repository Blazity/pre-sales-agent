# Configuration

Configuration is split into provider credentials and agency profile data.

Provider credentials live in Vercel Environment Variables for deployed projects. `.env.example` exists only as a local development template.

Agency profile data should live in `config/agency.example.json` and later in user-specific profile files. The profile controls agency name, positioning, brand colors, pricing rules, offer sections, proof points, research domains, and Slack copy.

Set `AGENCY_PROFILE_PATH=config/agency.example.json` to load the starter profile. For a real agency, copy the file to an untracked profile path, replace the proof points with verified public claims, and point `AGENCY_PROFILE_PATH` at that file.

`AGENCY_NAME` and `AGENCY_ACCENT_COLOR` are also used by `scripts/create-template.ts` when creating a Google Docs template. `CASE_STUDIES_BASE_URL` controls which public case-study listing is used by `scripts/seed-case-studies.ts`.
