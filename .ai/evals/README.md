# Agent Eval Expectations

These files define lightweight, inspectable expectations for agent behavior. They are not a hosted eval framework.

Use them when changing prompts, MCP tool routing, review rules, or guardrails.

Files:

- `prompt-boundaries.md` - untrusted-input examples and expected safe handling.
- `tool-routing.md` - expected tool choices by pipeline stage.
- `review-rubric.md` - concrete examples for review severity levels.

Future work can convert these examples into automated trace graders.
