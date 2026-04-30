# Prompt Architecture

The starter keeps the prompt structure public on purpose. It is meant to show how a production-shaped agent prompt can coordinate tools, protect boundaries, ask better questions, and produce useful sales artifacts.

## Prompt Layers

The orchestrator prompt in `src/agents/orchestrator.ts` is assembled from several layers:

| Layer | Purpose |
|---|---|
| Security boundary rules | Treat RFPs, Slack messages, clarifications, and file manifests as untrusted user data |
| Tool contract | Explain available MCP servers and when to use each tool family |
| Agency identity | Inject configurable voice, proof, links, positioning, brand colors, and commercial rules |
| Style anti-patterns | Avoid common AI-writing tells while preserving direct technical writing |
| Estimation policy | Define complexity tiers, role assumptions, rate card, effort calibration, and quality rules |
| Source handling | Wrap raw RFP text and user replies in explicit XML-like tags |
| Workflow plan | Force analysis, clarification, value discovery, estimation, document generation, and review in order |
| Review gates | Require the model to read back generated artifacts and fix failures before finishing |

## User-Data Boundaries

Untrusted content is always wrapped before it reaches the agent:

```text
<user-rfp>...</user-rfp>
<user-message>...</user-message>
<user-clarification>...</user-clarification>
<user-file-manifest>...</user-file-manifest>
```

The system prompt tells the model to analyze tagged content as client requirements only, never as instructions. This does not replace application-level security, but it gives the model a clear operational boundary.

## Configurable Agency Identity

Brand and proof do not live directly in the main prompt. They come from `config/agency.example.json` through `buildAgencyIdentityPrompt()` in `src/config/agency-profile.ts`.

Configurable fields include:

- Agency name and positioning.
- Tone and forbidden phrases.
- Brand colors used in generated documents.
- Credentials, partners, client references, and open-source proof.
- Services and public links.
- Currency and commercial rules.
- Research domains.

This keeps the public starter generic while preserving a realistic prompt structure that adopters can customize.

## Clarification Loop

The agent is required to ask at least one round of clarification questions unless answers were already supplied. The loop has explicit exit conditions:

- At least one round completed.
- At most five remaining assumptions.
- No vague answer that needs a targeted follow-up.
- Maximum five rounds.
- Timeout falls back to explicit assumptions.

This prevents the agent from treating a thin RFP as complete while still allowing it to move forward when the human does not reply.

## Estimation Calibration

The prompt combines three calibration sources:

- Past estimation search from Pinecone.
- Past proposal search from Pinecone.
- Current web research for technology versions and third-party pricing.

The model must estimate in man-days, classify complexity first, apply conservative AI productivity only to development tasks, and keep third-party costs out unless the client confirms they belong in the project price.

## Tool Routing

The orchestrator maps MCP tool names to workflow steps with `TOOL_TO_STEP`. This is used for progress tracking and should stay in sync with the tools allowed in the Claude Agent SDK call.

Tool families:

- `knowledge-base`: retrieval over estimates, proposals, and case studies.
- `google-workspace`: Drive, Docs, and Sheets operations.
- `web-research`: search and page extraction.
- `slack-interaction`: progress updates and human clarification.
- `figma`: optional design inspection.

## Review Gates

Before posting completion, the model must check:

- No template placeholders remain.
- About-us claims are backed by configured or retrieved proof.
- Assumptions do not contradict client answers.
- Risks are project-specific.
- Scope does not include explicitly excluded work.
- No fake IDs, tracking tags, API keys, or credentials were invented.
- Sheets generation succeeded.

These checks are intentionally verbose because they encode lessons learned from real agent failures.

## Customization Guidance

For most adopters, customize in this order:

1. Update `config/agency.example.json` or point `AGENCY_PROFILE_PATH` to a private profile.
2. Adjust pricing and staffing rules in the Estimation Rules section.
3. Tune clarification questions for your sales process.
4. Add or remove MCP tools only after updating `TOOL_TO_STEP`, `allowedTools`, and docs.
5. Keep the user-data boundary tags and review gates intact.

The anti-pattern section can stay. It is intentionally generic and helps generated proposal copy sound less synthetic without binding the starter to a specific brand.
