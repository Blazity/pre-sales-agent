# MCP Tools Reference

Tools available to the orchestrator agent via MCP servers.

## knowledge-base

| Tool | Description |
|------|-------------|
| `search_past_estimations` | Search past estimations (Google Sheets) for structured effort/cost data with optional tech/role filters |
| `search_past_proposals` | Search past proposals (Google Docs) for writing reference text chunks |
| `search_case_studies` | Search configured agency case studies with optional industry/problem_type filters |

## google-workspace

| Tool | Description |
|------|-------------|
| `drive_list_files` | List files in a Google Drive folder |
| `drive_get_file` | Get metadata for a Drive file |
| `drive_search_files` | Search Drive by name query |
| `drive_export_file` | Export a Google Doc/Sheet as plain text or PDF |
| `docs_create_document` | Create a new Google Doc in a folder |
| `docs_get_document` | Read the full content of a Google Doc |
| `docs_copy_template` | Copy the offer template doc into the output folder |
| `docs_find_and_replace` | Replace `{{PLACEHOLDER}}` tokens in a doc |
| `docs_write_sections` | Write formatted sections with headings, tables, and bold text |

## web-research

| Tool | Description |
|------|-------------|
| `web_search` | Search the web via Brave Search API. Returns titles, URLs, and snippets |
| `fetch_web_page` | Fetch any URL and extract text content, with optional AI summarization |

## figma (optional — requires FIGMA_API_KEY)

| Tool | Description |
|------|-------------|
| `get_figma_data` | Get layout, style, and component data from a Figma file or node |
| `download_figma_images` | Download rendered images of Figma nodes |

## slack-interaction

| Tool | Description |
|------|-------------|
| `post_message` | Post a message to a Slack channel/thread |
| `wait_for_reply` | Wait for a human reply in a Slack thread (up to 30 min) |
