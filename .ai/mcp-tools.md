# MCP Tools Reference

Tools available to the orchestrator through standalone MCP servers.

| Server | Stage | Tool | Purpose |
|---|---:|---|---|
| knowledge-base | 1 | `search_past_estimations` | Search past estimations for structured effort and cost data. |
| knowledge-base | 1 | `search_past_proposals` | Search past proposal text chunks for writing reference material. |
| knowledge-base | 1 | `search_case_studies` | Search configured agency case studies with optional industry/problem filters. |
| google-workspace | 1/4 | `drive_list_files` | List files in a Drive folder. |
| google-workspace | 1/4 | `drive_get_file` | Read Drive file metadata. |
| google-workspace | 1/4 | `drive_search_files` | Search Drive files by name query. |
| google-workspace | 1/4 | `drive_export_file` | Export Google Docs, Sheets, Slides, or supported uploads for agent-readable content. |
| google-workspace | 4 | `docs_create_document` | Create a Google Doc in a folder. |
| google-workspace | 1/4 | `docs_get_document` | Read plain-text Google Doc content. |
| google-workspace | 4 | `docs_copy_template` | Copy the offer template into the output folder. |
| google-workspace | 4 | `docs_find_and_replace` | Fill `{{PLACEHOLDER}}` tokens in a Google Doc. |
| google-workspace | 4 | `docs_write_sections` | Write richly formatted proposal sections, tables, charts, images, and page breaks. |
| google-workspace | 4 | `sheets_create_estimation` | Create the nine-column estimation spreadsheet from the configured template. |
| web-research | 1/3 | `web_search` | Search the web through Brave Search. |
| web-research | 3 | `fetch_web_page` | Fetch and extract text from a URL, optionally with AI extraction. |
| slack-interaction | 2 | `post_message` | Post a message to the configured Slack thread. |
| slack-interaction | 2 | `wait_for_reply` | Wait for a human reply in the configured Slack thread for up to 15 minutes. |
| figma | 1 | `get_figma_data` | Read Figma file or node layout data when `FIGMA_API_KEY` is configured. |
| figma | 1 | `download_figma_images` | Download rendered Figma node images when `FIGMA_API_KEY` is configured. |

Run `npm run check:ai-docs` after changing tool names, allowed tools, or stage mappings.
