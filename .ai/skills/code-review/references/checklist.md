# Code Review Checklist

## Architecture

- [ ] Runtime architecture references match Vercel Functions, Vercel Workflow, and Vercel Sandbox.
- [ ] MCP servers do not import from application internals.
- [ ] New MCP tools are registered in `TOOL_TO_STEP` when they affect pipeline stage tracking.
- [ ] New MCP tools are added to `allowedTools` when the orchestrator should be able to call them.
- [ ] System prompt instructions are updated when tool behavior or routing changes.
- [ ] MCP server env config includes only required variables.

## Orchestrator And Prompt Safety

- [ ] Prompt sections match pipeline stages.
- [ ] Step numbers in `TOOL_TO_STEP` match prompt structure.
- [ ] No hardcoded API keys, folder IDs, customer data, or secrets appear in prompt text.
- [ ] User-controlled prompt data is wrapped in declared boundary tags.
- [ ] Google Doc placeholder tokens are consistent between template setup and orchestrator prompt.

## Google APIs

- [ ] OAuth scopes include required permissions.
- [ ] Token caching uses an `expiresAt` check.
- [ ] API errors return meaningful messages or propagate to the upstream handler that must react.
- [ ] Template element IDs are stable when referenced by tools.
- [ ] Drive reads and writes respect configured folder allowlists.

## Data Integrity

- [ ] Pinecone operations use Voyage `voyage-3`, 1024 dimensions, cosine metric.
- [ ] Chunking parameters match seed scripts.
- [ ] Metadata fields match the existing index schema.
- [ ] The agent does not write unreviewed outputs into curated knowledge-base folders.

## Slack And Vercel Workflow

- [ ] Slack routes use `/api/slack/events` for Vercel ingress.
- [ ] Slack request signing is preserved.
- [ ] Thread context (`channel`, `thread_ts`) is passed correctly.
- [ ] `wait_for_reply` timeout is documented as 15 minutes.
- [ ] Workflow logs do not expose raw customer data or secrets.

## Code Quality

- [ ] Zod schemas exist for MCP tool parameters.
- [ ] Avoid `any` unless narrowly justified.
- [ ] Error handling does not swallow failures needed by Slack or Workflow handlers.
- [ ] No unused imports or variables.
- [ ] Public docs and `.ai` docs are updated with behavior changes.

## Environment And Security

- [ ] New env vars are added to `.env.example` with comments.
- [ ] No secrets are committed.
- [ ] `dotenv` is loaded at each MCP server entrypoint.
- [ ] Claude Code deny rules still cover `.env`, credentials, and customer-data paths.

## Testing And Gates

- [ ] At least one test covers each new MCP tool or pure helper.
- [ ] Tests use mocks for external API calls.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run audit:high` passes or only lower-than-high advisories are documented.
- [ ] `npm run scan:secrets` passes.
- [ ] `npm run check:mcp-isolation` passes.
- [ ] `npm run check:ai-docs` passes.
