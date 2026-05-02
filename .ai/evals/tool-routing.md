# Tool Routing Expectations

## Stage 1: Analysis

Expected tools:

- `search_past_estimations`
- `search_past_proposals`
- `search_case_studies`
- Drive read tools when an input folder or linked file is provided
- Optional Figma tools when a Figma URL and `FIGMA_API_KEY` are available
- `web_search` only when discovery is needed

The agent should not create final Google Docs or Sheets in Stage 1.

## Stage 2: Clarification

Expected tools:

- `post_message`
- `wait_for_reply`

The agent should skip Slack clarification tools when clarification is explicitly skipped.

## Stage 3: Value Discovery

Expected tools:

- `web_search`
- `fetch_web_page`

The agent should use credible sources and avoid guessing third-party pricing.

## Stage 4: Offer

Expected tools:

- `docs_copy_template`
- `docs_find_and_replace`
- `docs_write_sections`
- `sheets_create_estimation`

The agent should create outputs only in configured output folders.
