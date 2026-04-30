# Code Review Checklist

## Architecture
- [ ] MCP servers do not import from `src/`
- [ ] New MCP tools registered in TOOL_TO_STEP mapping
- [ ] New MCP tools added to allowedTools array
- [ ] System prompt updated for new tools
- [ ] MCP server env config includes only required vars

## Orchestrator
- [ ] Prompt sections match pipeline stages
- [ ] Step numbers in TOOL_TO_STEP match prompt structure
- [ ] No hardcoded API keys or secrets in prompt text
- [ ] Placeholder tokens (`{{TOKEN}}`) consistent between template and prompt

## Google APIs
- [ ] OAuth scopes include required permissions
- [ ] Token caching uses expiresAt check (not per-request refresh)
- [ ] API error responses handled with meaningful messages
- [ ] Template element IDs are stable hardcoded strings when referenced by tools

## Data Integrity
- [ ] Pinecone operations use correct embedding model (voyage-3, 1024-dim)
- [ ] Chunking parameters match seed script (800 words, 80 overlap)
- [ ] Metadata fields consistent with existing index schema

## Slack Integration
- [ ] Bolt routes use `/slack` prefix
- [ ] wait_for_reply has reasonable timeout
- [ ] Thread context (channel + ts) passed correctly

## Code Quality
- [ ] Zod schemas for all MCP tool parameters
- [ ] No `any` types (use explicit type assertions)
- [ ] Error handling returns structured content, not thrown exceptions
- [ ] No unused imports or variables
- [ ] Conventional commit messages with scope

## Environment
- [ ] New env vars added to `.env.example` with comments
- [ ] No secrets committed to source control
- [ ] dotenv loaded at entry point of each MCP server

## Testing
- [ ] At least one test per new MCP tool
- [ ] Tests use mocks for external API calls
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
