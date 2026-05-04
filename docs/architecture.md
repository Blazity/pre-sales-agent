# Architecture

Pre-Sales Agent is a Vercel-supported starter for turning RFPs and briefs into clarification loops, estimates, and proposal drafts.

## What This System Runs On

Vercel is the supported runtime for this starter today. The shipped implementation assumes Vercel Functions for HTTP ingress, Vercel Workflow for durable execution, and Vercel Sandbox as the default agent workspace provider.

Other hosting models may be possible in principle, but they are not documented as supported first-launch paths in this repository.

## System Overview

The starter is built around one estimation workflow:

```text
Slack request
  -> Vercel Function ingress
  -> Vercel Workflow run
  -> Claude Agent SDK orchestrator
  -> MCP stdio tool servers
  -> Google Docs and Sheets outputs
  -> Slack thread completion message
```

Slack is the default request channel. Google Workspace is the default output system. Pinecone and Voyage provide retrieval for historical estimates, proposals, and case studies.

## Request Lifecycle

```text
Slack `!estimate` or `/estimate`
  -> `api/slack/events.ts`
  -> `src/slack/bolt-app.ts`
  -> `src/workflows/launcher.ts`
  -> `workflows/estimation.ts`
  -> `src/agents/orchestrator.ts`
  -> `src/mcp-servers/*.ts`
  -> Google Docs and Sheets
  -> Slack thread completion message
```

1. Slack sends an Events API or slash-command request to the deployed Vercel URL.
2. `api/slack/events.ts` forwards the raw HTTP request into the Bolt receiver mounted at `/events`.
3. `src/slack/bolt-app.ts` validates the request, parses `!estimate` or `/estimate`, ingests attached or linked files when present, and builds an estimation job.
4. `src/workflows/launcher.ts` starts the Vercel Workflow run and assigns a stable `jobId`.
5. `workflows/estimation.ts` runs the agent step and reports workflow progress.
6. `src/agents/orchestrator.ts` calls the Claude Agent SDK with MCP server configuration, allowed tools, workflow instructions, agency profile context, and prompt-injection boundaries.
7. MCP servers perform retrieval, web research, Slack interaction, and Google Workspace operations.
8. The workflow writes Google Docs and Sheets outputs and posts final links back to the Slack thread.

## Vercel Runtime

The Vercel runtime has four main responsibilities:

| Runtime part | Files | Purpose |
|---|---|---|
| Health check | `api/health.ts` | Confirms the deployment is reachable and Workflow is enabled |
| Slack ingress | `api/slack/events.ts` | Receives Slack HTTP traffic through a Vercel Function |
| Durable execution | `workflows/estimation.ts`, `src/workflows/launcher.ts` | Starts and runs the long-lived estimation workflow |
| Agent workspace | `src/runtime/sandbox.ts` | Uses Vercel Sandbox by default on Vercel |

Structured progress and tool events are reported through `src/lib/workflow-reporter.ts`, which writes events that can appear in Vercel logs and Workflow run timelines.

## Slack Ingress Boundary

Slack is the default ingress integration in this starter. It is responsible for:

- Receiving `!estimate` messages and `/estimate` slash commands.
- Downloading attached Slack files when present.
- Detecting Google Drive links in request text.
- Posting acknowledgement, progress, clarification, and completion messages in the originating thread.

The Slack code lives in `src/slack/bolt-app.ts`; the Vercel Function adapter lives in `api/slack/events.ts`.

Another channel, such as Microsoft Teams, should be treated as an extension after first launch works. A replacement ingress should produce the same kind of estimation job for `src/workflows/launcher.ts` instead of bypassing the workflow and orchestrator.

## Workflow Launcher

`src/workflows/launcher.ts` is the boundary between request handling and durable work. It accepts an estimation job, adds a `jobId` when one is missing, and starts the Vercel Workflow identified by `workflow//./workflows/estimation//estimationWorkflow`.

This keeps the Slack request handler short and prevents long-running agent work from being tied to a single HTTP request.

## Claude Agent SDK Orchestrator

`src/agents/orchestrator.ts` is the central agent coordinator. It:

- Validates required environment variables for the workflow.
- Loads the agency profile from `src/config/agency-profile.ts`.
- Builds the system prompt, workflow instructions, estimation rules, and review gates.
- Registers MCP stdio servers with the Claude Agent SDK.
- Whitelists allowed MCP tools.
- Maps tool calls to workflow progress steps through `TOOL_TO_STEP`.
- Reports progress, tool calls, errors, and completion through `WorkflowReporter`.

The orchestrator prompt treats RFPs, Slack messages, clarifications, and file manifests as untrusted user data. See `docs/prompt-architecture.md` for the prompt-layer details.

## MCP Tool Servers

MCP servers in `src/mcp-servers/` are standalone stdio processes. They must not import from application internals under `src/`. Each server loads its own environment configuration and exposes MCP-compatible content blocks.

Current MCP servers:

| Server | File | Main tools | Purpose |
|---|---|---|---|
| `knowledge-base` | `src/mcp-servers/knowledge-base.ts` | `search_past_estimations`, `search_past_proposals`, `search_case_studies` | Retrieve historical estimate, proposal, and case-study context from Pinecone |
| `google-workspace` | `src/mcp-servers/google-workspace.ts` | Drive, Docs, and Sheets tools | Read input files, create proposal documents, and create estimation spreadsheets |
| `web-research` | `src/mcp-servers/web-research.ts` | `web_search`, `fetch_web_page` | Discover and read public web context |
| `slack-interaction` | `src/mcp-servers/slack-interaction.ts` | `post_message`, `wait_for_reply` | Post progress and wait for human clarification replies in the allowed thread |
| `figma` | External MCP server | `get_figma_data`, `download_figma_images` | Optional design inspection when `FIGMA_API_KEY` is set |

When adding or changing MCP tools, keep these in sync:

- The server implementation in `src/mcp-servers/`.
- The MCP server config in `src/agents/orchestrator.ts`.
- The `allowedTools` array in `src/agents/orchestrator.ts`.
- The `TOOL_TO_STEP` map when the tool should affect workflow progress.
- Tests for the server and orchestrator behavior.

Use `.ai/skills/add-mcp-server/SKILL.md` for guided MCP server work.

## Google Workspace Outputs

Google Workspace is the default output system for first launch.

The Google Workspace MCP tools create and update:

- A Google Docs proposal based on `GDRIVE_TEMPLATE_ID`.
- A Google Sheets estimation based on `GSHEETS_TEMPLATE_ID`.
- Drive folders and file references for each estimation workspace.

Templates can be generated with:

```bash
npm run setup:google-templates -- --folder-id <GDRIVE_ROOT_FOLDER_ID>
```

Replacing Google Workspace means adding new output tools or changing the existing output MCP server. It is extension work, not part of the first-launch path.

## Retrieval Stack

Retrieval uses Pinecone with Voyage embeddings. The current locked settings are:

| Setting | Value |
|---|---|
| Embedding model | `voyage-3` |
| Dimension | `1024` |
| Metric | `cosine` |
| Default Pinecone index | `estimations` |

The seeding scripts load historical estimates, proposal text, and configured case studies into Pinecone namespaces. Changing the embedding model or dimension requires recreating and re-seeding the index.

## Agency Profile

Agency identity, proof points, brand colors, commercial rules, research domains, and output copy defaults are loaded through `src/config/agency-profile.ts`.

By default, the app uses a public starter profile. For a real agency, copy `config/agency.example.json` to an untracked profile, replace claims with verified public facts, and set:

```text
AGENCY_PROFILE_PATH=<your-profile-path>
```

`docs/configuration.md` explains the environment groups and agency profile fields.

## Security Boundaries

The starter uses several boundaries:

- Slack signing secrets validate incoming Slack requests.
- The orchestrator wraps untrusted RFP, message, clarification, and file-manifest content in explicit tags before sending it to the model.
- MCP tools are whitelisted through `allowedTools`.
- Slack MCP tools restrict posting and reading to the configured channel and thread.
- Google Workspace operations can be constrained through allowed folder IDs.
- MCP servers remain standalone stdio processes and do not import application internals.
- Secrets live in `.env` for local development and Vercel Environment Variables for deployed projects.

See `docs/security.md` and `docs/prompt-architecture.md` for deeper security and prompt-boundary notes.

## Extension Points

- Runtime: Vercel only for now.
- Ingress: Slack is the default. Add another adapter, such as Teams, after first launch works.
- Outputs: Google Workspace is the default. Add new output tools before replacing Docs or Sheets behavior.
- Retrieval: Pinecone and Voyage are the current stack. Changing embeddings requires a planned re-index.
- MCP tools: add servers through the MCP pattern and keep `TOOL_TO_STEP` and `allowedTools` in sync.
- Agency profile: customize identity and proof through `AGENCY_PROFILE_PATH` before editing prompt code.

## Key Files

| File | Purpose |
|---|---|
| `README.md` | Entry point and documentation map |
| `docs/first-launch.md` | Supported first-launch path from Vercel deployment to first Slack run |
| `docs/setup.md` | Provider setup reference |
| `api/health.ts` | Deployment health endpoint |
| `api/slack/events.ts` | Vercel Function adapter for Slack HTTP Events API |
| `src/slack/bolt-app.ts` | Slack command/message handlers and file-ingestion trigger |
| `src/workflows/launcher.ts` | Starts Vercel Workflow runs |
| `workflows/estimation.ts` | Durable Vercel Workflow definition |
| `src/agents/orchestrator.ts` | Claude Agent SDK orchestration, MCP config, tool routing, and prompt |
| `src/mcp-servers/*.ts` | Standalone MCP stdio servers |
| `src/lib/file-ingestion.ts` | Slack and Google Drive input ingestion |
| `src/lib/workflow-reporter.ts` | Structured workflow progress and tool logging |
| `src/config/agency-profile.ts` | Agency profile loading and prompt rendering |
| `scripts/setup-google-templates.ts` | Starter Google Docs and Sheets template generation |
| `scripts/seed-knowledge-base.ts` | Pinecone seeding from Google Drive sources |

## Related Docs

- `docs/first-launch.md` for the guided setup path.
- `docs/setup.md` for provider-specific setup detail.
- `docs/configuration.md` for environment variables and agency profile customization.
- `docs/prompt-architecture.md` for prompt structure, untrusted input boundaries, and review gates.
- `docs/security.md` for security notes and review gates.
- `.ai/skills/first-launch/SKILL.md` for AI-assisted onboarding.
- `.ai/skills/add-mcp-server/SKILL.md` for adding MCP tools.
