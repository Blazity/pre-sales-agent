import assert from "node:assert/strict";
import test from "node:test";
import {
  checkAiDocsDrift,
  parseAllowedTools,
  parseExternalMcpTools,
  parseMcpServerTools,
  parseToolToStep,
  parseWaitForReplyTimeoutMinutes,
  type RepoSnapshot,
} from "./check-ai-docs-drift.js";

function snapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    gitBranch: "main",
    packageJson: JSON.stringify({
      scripts: {
        typecheck: "tsc --noEmit",
        test: "tsx --test src/**/*.test.ts .ai/checks/*.test.ts",
        "audit:high": "npm audit --audit-level=high",
        "scan:secrets": "tsx scripts/scan-secrets.ts",
        "check:mcp-isolation": "rg \"from ['\\\"]\\.\\./\" src/mcp-servers && exit 1 || exit 0",
        "check:ai-docs": "tsx .ai/checks/check-ai-docs-drift.ts",
      },
    }),
    ciWorkflow: `
name: CI
jobs:
  test:
    steps:
      - run: npm run typecheck
      - run: npm test
      - run: npm run audit:high
      - run: npm run scan:secrets
      - run: npm run check:mcp-isolation
`,
    agentsMd: `
# Pre-Sales Agent
- Default branch: \`main\`
- Required gates: \`npm run typecheck\`, \`npm test\`, \`npm run audit:high\`, \`npm run scan:secrets\`, \`npm run check:mcp-isolation\`, \`npm run check:ai-docs\`
`,
    claudeMd: `
# Pre-Sales Agent
@AGENTS.md
`,
    lessonsMd: `
# Lessons Learned
All pull requests target \`main\`.
`,
    architectureMd: `
# Architecture
Slack -> Vercel Function ingress -> Vercel Workflow -> Claude Agent SDK orchestrator -> MCP servers -> Google Workspace outputs.
The default runtime uses Vercel Functions, Vercel Workflow, and Vercel Sandbox.
`,
    mcpToolsMd: `
# MCP Tools Reference
| Server | Stage | Tool |
|---|---:|---|
| knowledge-base | 1 | \`search_past_estimations\` |
| knowledge-base | 1 | \`search_past_proposals\` |
| knowledge-base | 1 | \`search_case_studies\` |
| google-workspace | 4 | \`drive_list_files\` |
| google-workspace | 4 | \`drive_get_file\` |
| google-workspace | 4 | \`drive_search_files\` |
| google-workspace | 4 | \`drive_export_file\` |
| google-workspace | 4 | \`docs_create_document\` |
| google-workspace | 4 | \`docs_get_document\` |
| google-workspace | 4 | \`docs_copy_template\` |
| google-workspace | 4 | \`docs_find_and_replace\` |
| google-workspace | 4 | \`docs_write_sections\` |
| google-workspace | 4 | \`sheets_create_estimation\` |
| web-research | 1 | \`web_search\` |
| web-research | 3 | \`fetch_web_page\` |
| slack-interaction | 2 | \`post_message\` |
| slack-interaction | 2 | \`wait_for_reply\` |
| figma | 1 | \`get_figma_data\` |
| figma | 1 | \`download_figma_images\` |

\`wait_for_reply\` waits for up to 15 minutes.
`,
    codeReviewSkillMd: `
# Code Review
- Scope
- MCP isolation
- Checklist
- TypeScript
- Tests
- Dependency audit
- Secret scan
- AI docs drift
- Lessons check
`,
    codeReviewChecklistMd: `
# Code Review Checklist
- [ ] \`npm run typecheck\` passes
- [ ] \`npm test\` passes
- [ ] \`npm run audit:high\` passes or non-high advisories are documented
- [ ] \`npm run scan:secrets\` passes
- [ ] \`npm run check:mcp-isolation\` passes
- [ ] \`npm run check:ai-docs\` passes
`,
    orchestratorTs: `
const TOOL_TO_STEP: Record<string, number> = {
  search_past_estimations: 1,
  search_past_proposals: 1,
  search_case_studies: 1,
  get_figma_data: 1,
  download_figma_images: 1,
  web_search: 1,
  fetch_web_page: 3,
  wait_for_reply: 2,
  docs_create_document: 4,
  docs_find_and_replace: 4,
  docs_write_sections: 4,
  sheets_create_estimation: 4,
};
mcpServers: {
  "figma": {
    command: "npx",
    args: ["-y", "figma-developer-mcp", "--stdio"],
  },
},
allowedTools: [
  "mcp__knowledge-base__search_past_estimations",
  "mcp__knowledge-base__search_past_proposals",
  "mcp__knowledge-base__search_case_studies",
  "mcp__google-workspace__drive_list_files",
  "mcp__google-workspace__drive_get_file",
  "mcp__google-workspace__drive_search_files",
  "mcp__google-workspace__drive_export_file",
  "mcp__google-workspace__docs_create_document",
  "mcp__google-workspace__docs_get_document",
  "mcp__google-workspace__docs_copy_template",
  "mcp__google-workspace__docs_find_and_replace",
  "mcp__google-workspace__docs_write_sections",
  "mcp__google-workspace__sheets_create_estimation",
  "mcp__web-research__fetch_web_page",
  "mcp__web-research__web_search",
  "mcp__slack-interaction__post_message",
  "mcp__slack-interaction__wait_for_reply",
  "mcp__figma__get_figma_data",
  "mcp__figma__download_figma_images",
]
`,
    slackInteractionTs: `
server.tool(
  "wait_for_reply",
  "Wait for a human to reply in a Slack thread. Polls every 5 seconds up to 15 minutes.",
  {},
  async () => {
    const deadline = Date.now() + 15 * 60 * 1000;
  }
);
`,
    mcpServerSources: [
      `server.tool("search_past_estimations", "", {}, async () => ({})); server.tool("search_past_proposals", "", {}, async () => ({})); server.tool("search_case_studies", "", {}, async () => ({}));`,
      `server.tool("drive_list_files", "", {}, async () => ({})); server.tool("drive_get_file", "", {}, async () => ({})); server.tool("drive_search_files", "", {}, async () => ({})); server.tool("drive_export_file", "", {}, async () => ({})); server.tool("docs_create_document", "", {}, async () => ({})); server.tool("docs_get_document", "", {}, async () => ({})); server.tool("docs_copy_template", "", {}, async () => ({})); server.tool("docs_find_and_replace", "", {}, async () => ({})); server.tool("docs_write_sections", "", {}, async () => ({})); server.tool("sheets_create_estimation", "", {}, async () => ({}));`,
      `server.tool("fetch_web_page", "", {}, async () => ({})); server.tool("web_search", "", {}, async () => ({}));`,
      `server.tool("post_message", "", {}, async () => ({})); server.tool("wait_for_reply", "", {}, async () => ({}));`,
    ],
    ...overrides,
  };
}

test("parses wait_for_reply timeout from implementation", () => {
  assert.equal(parseWaitForReplyTimeoutMinutes(snapshot().slackInteractionTs), 15);
});

test("parses MCP server tool registrations", () => {
  assert.deepEqual(parseMcpServerTools(`server.tool("alpha", "", {}, async () => ({}));`), ["alpha"]);
});

test("parses TOOL_TO_STEP entries", () => {
  assert.equal(parseToolToStep(snapshot().orchestratorTs).get("fetch_web_page"), 3);
});

test("parses allowedTools short names", () => {
  assert.ok(parseAllowedTools(snapshot().orchestratorTs).has("drive_export_file"));
});

test("parses external MCP package registrations", () => {
  assert.deepEqual([...parseExternalMcpTools(snapshot().orchestratorTs)].sort(), [
    "download_figma_images",
    "get_figma_data",
  ]);
});

test("parses only the allowedTools array for allowed tool names", () => {
  const source = `
const unrelated = "mcp__google-workspace__not_allowed";
allowedTools: [
  "mcp__google-workspace__docs_create_document",
  "mcp__slack-interaction__wait_for_reply",
],
const later = "mcp__google-workspace__also_not_allowed";
`;

  assert.deepEqual([...parseAllowedTools(source)].sort(), ["docs_create_document", "wait_for_reply"]);
});

test("passes for aligned AI docs", () => {
  assert.deepEqual(checkAiDocsDrift(snapshot()), []);
});

test("fails on branch name conflicts", () => {
  const findings = checkAiDocsDrift(snapshot({ lessonsMd: "All pull requests target `master`." }));
  assert.ok(findings.some((finding) => finding.code === "branch-conflict"));
});

test("fails on stale runtime claims in always-loaded files", () => {
  const findings = checkAiDocsDrift(snapshot({ claudeMd: "Slack -> Express/Bolt -> BullMQ -> Orchestrator" }));
  assert.ok(findings.some((finding) => finding.code === "stale-runtime-claim"));
});

test("fails when current runtime facts are missing", () => {
  const findings = checkAiDocsDrift(snapshot({
    agentsMd: "# Pre-Sales Agent\n- Default branch: `main`",
    architectureMd: "# Architecture\nSlack -> orchestrator -> output.",
  }));

  assert.ok(findings.some((finding) => finding.code === "runtime-fact-missing"));
});

test("fails when architecture docs miss current runtime facts even if AGENTS mentions them", () => {
  const findings = checkAiDocsDrift(snapshot({
    agentsMd: `
# Pre-Sales Agent
- Default branch: \`main\`
- Vercel Functions, Vercel Workflow, Vercel Sandbox, Claude Agent SDK, MCP servers
`,
    architectureMd: "# Architecture\nSlack -> orchestrator -> output.",
  }));

  assert.ok(findings.some((finding) => finding.code === "runtime-fact-missing"));
});

test("fails on wait_for_reply timeout mismatch", () => {
  const findings = checkAiDocsDrift(snapshot({ mcpToolsMd: snapshot().mcpToolsMd.replace("15", "30") }));
  assert.ok(findings.some((finding) => finding.code === "timeout-mismatch"));
});

test("fails when documented MCP tools miss source registrations", () => {
  const findings = checkAiDocsDrift(snapshot({ mcpToolsMd: snapshot().mcpToolsMd.replace("| web-research | 1 | `web_search` |", "") }));
  assert.ok(findings.some((finding) => finding.code === "mcp-tool-undocumented"));
});

test("fails when documented MCP tools only exist in allowedTools", () => {
  const findings = checkAiDocsDrift(snapshot({
    mcpToolsMd: `${snapshot().mcpToolsMd}\n| typo | 1 | \`stale_tool_name\` |`,
    orchestratorTs: snapshot().orchestratorTs.replace(
      '  "mcp__figma__download_figma_images",\n]',
      '  "mcp__figma__download_figma_images",\n  "mcp__typo__stale_tool_name",\n]',
    ),
  }));

  assert.ok(findings.some((finding) => finding.code === "mcp-tool-not-registered"));
});

test("fails when allowed tools are missing TOOL_TO_STEP entries unless exempt", () => {
  const findings = checkAiDocsDrift(snapshot({
    orchestratorTs: snapshot().orchestratorTs.replace("fetch_web_page: 3,", ""),
  }));
  assert.ok(findings.some((finding) => finding.code === "allowed-tool-missing-step"));
});

test("fails when code review docs miss CI gates", () => {
  const findings = checkAiDocsDrift(snapshot({ codeReviewChecklistMd: "`npm run typecheck` passes" }));
  assert.ok(findings.some((finding) => finding.code === "review-gate-missing"));
});

test("fails when check:ai-docs script points at the wrong command", () => {
  const findings = checkAiDocsDrift(snapshot({
    packageJson: JSON.stringify({
      scripts: {
        "check:ai-docs": "echo ok",
      },
    }),
  }));

  assert.ok(findings.some((finding) => finding.code === "script-missing"));
});

test("fails when check:ai-docs script only echoes the checker path", () => {
  const findings = checkAiDocsDrift(snapshot({
    packageJson: JSON.stringify({
      scripts: {
        "check:ai-docs": "echo .ai/checks/check-ai-docs-drift.ts",
      },
    }),
  }));

  assert.ok(findings.some((finding) => finding.code === "script-missing"));
});
