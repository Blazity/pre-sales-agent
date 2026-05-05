import assert from "node:assert/strict";
import test from "node:test";
import {
  apiFunctionConfig,
  mcpServerOutputPath,
  MCP_SERVER_NAMES,
  mergeRoutes,
  requiredMcpServerOutputFiles,
  type VercelOutputConfig,
} from "./config.js";

test("mergeRoutes preserves existing workflow routes and adds missing API routes", () => {
  const base: VercelOutputConfig = {
    version: 3,
    routes: [
      {
        src: "^\\/\\.well-known\\/workflow\\/v1\\/webhook\\/([^\\/]+)$",
        dest: "/.well-known/workflow/v1/webhook/[token]",
      },
    ],
  };

  const result = mergeRoutes(base, [
    { src: "^\\/api\\/health$", dest: "/api/health" },
    { src: "^\\/api\\/slack\\/events$", dest: "/api/slack/events" },
    { src: "^\\/api\\/health$", dest: "/api/health" },
  ]);

  assert.deepEqual(result.routes, [
    {
      src: "^\\/\\.well-known\\/workflow\\/v1\\/webhook\\/([^\\/]+)$",
      dest: "/.well-known/workflow/v1/webhook/[token]",
    },
    { src: "^\\/api\\/health$", dest: "/api/health" },
    { src: "^\\/api\\/slack\\/events$", dest: "/api/slack/events" },
  ]);
});

test("apiFunctionConfig emits a Node function config for bundled handlers", () => {
  assert.deepEqual(apiFunctionConfig(), {
    runtime: "nodejs20.x",
    handler: "index.js",
    launcherType: "Nodejs",
    shouldAddHelpers: true,
  });
});

test("MCP server output paths match the workflow bundle runtime root", () => {
  assert.deepEqual(MCP_SERVER_NAMES, [
    "knowledge-base",
    "google-workspace",
    "web-research",
    "slack-interaction",
  ]);

  assert.equal(
    mcpServerOutputPath("knowledge-base"),
    ".vercel/output/functions/.well-known/workflow/v1/step.func/mcp-servers/knowledge-base.mjs",
  );
  assert.deepEqual(requiredMcpServerOutputFiles(), [
    ".vercel/output/functions/.well-known/workflow/v1/step.func/mcp-servers/knowledge-base.mjs",
    ".vercel/output/functions/.well-known/workflow/v1/step.func/mcp-servers/google-workspace.mjs",
    ".vercel/output/functions/.well-known/workflow/v1/step.func/mcp-servers/web-research.mjs",
    ".vercel/output/functions/.well-known/workflow/v1/step.func/mcp-servers/slack-interaction.mjs",
  ]);
});
