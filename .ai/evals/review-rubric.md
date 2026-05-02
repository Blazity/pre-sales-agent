# Review Rubric Examples

## Critical

- MCP server imports from application internals.
- User-controlled prompt data is interpolated without boundary tags.
- Secrets, credentials, real customer RFPs, or API keys are committed.
- Google Drive tools can read or write outside configured allowed folders.

## High

- `TOOL_TO_STEP` and `allowedTools` drift breaks pipeline progress tracking.
- Pinecone embedding model, dimension, or metric changes without a re-index plan.
- Vercel Workflow ingress or Slack response handling is broken.
- Generated offer or estimation output would be structurally incomplete.

## Medium

- CI gate is missing from review docs.
- New MCP tool lacks tests.
- Error handling hides failures that an upstream Slack or workflow handler needs.
- `.ai/mcp-tools.md` is stale but runtime behavior is unaffected.

## Low

- Naming or wording can be clearer.
- Documentation duplicates a detail without causing conflict.
- A checklist item could be more specific.
