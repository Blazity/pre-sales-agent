# Demo Runbook

Use this runbook to produce a public demo video, launch screenshots, or a maintainer smoke test without exposing private client data.

## Demo Inputs

Use the sample RFP:

```text
examples/rfps/sample-rfp.md
```

Use the starter agency profile:

```text
config/agency.example.json
```

The sample is intentionally generic: an enterprise training customer portal with authentication, catalog browsing, seat management, invoice history, admin reporting, and CRM handoff.

## Slack Demo Script

Invite the bot to a test channel and send:

```text
!estimate Acme Learning needs a customer portal for enterprise training buyers.

The portal should support account login, course catalog browsing, team seat management, invoice history, admin reporting, and CRM handoff for expansion opportunities.

The first release should be ready in three months. The client prefers a modern TypeScript stack and wants a clear estimate, delivery plan, risks, assumptions, and recommended team shape.
```

Slash command variant:

```text
/estimate Acme Learning needs a customer portal for enterprise training buyers. The portal should support account login, course catalog browsing, team seat management, invoice history, admin reporting, and CRM handoff for expansion opportunities. The first release should be ready in three months.
```

## Expected Demo Milestones

The Slack thread should show:

1. Request acknowledgement.
2. RFP analysis summary.
3. Clarifying questions or assumptions.
4. Research and estimation progress updates.
5. Final Google Doc and Google Sheet links.

The generated Google Doc should show:

1. Cover placeholders filled with client, project, and date.
2. Executive summary.
3. Delivery approach.
4. Scope breakdown.
5. Assumptions, risks, exclusions, and next steps.

The generated Google Sheet should show:

1. Module-level work breakdown.
2. Effort in man-days.
3. Risk-adjusted effort.
4. Optional flags.
5. Subtotals and summary rows.

## Recording Checklist

Before recording:

1. Use a disposable Slack channel and test Google Drive folder.
2. Verify the Slack channel contains no private customer messages.
3. Verify generated Docs and Sheets use sample data only.
4. Collapse or hide browser sidebars that expose account names or private folders.
5. Keep API keys, Vercel project settings, and OAuth screens out of frame.

Suggested clip sequence:

1. README with Deploy Button and CI badge.
2. Vercel `/api/health` response.
3. Slack request being sent.
4. Slack progress thread.
5. Generated Google Doc.
6. Generated Google Sheet.
7. `docs/architecture.md` or `docs/setup.md` to show implementation depth.

## Demo Talking Points

- The workflow is not a chatbot wrapper; it is a durable agent pipeline with Vercel Workflow-backed execution.
- MCP tools are isolated standalone stdio processes.
- Untrusted RFP text is boundary-tagged in prompts.
- Agency positioning and proof points are configurable through an external profile.
- Vercel is the default public deployment path.
