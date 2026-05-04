import assert from "node:assert/strict";
import test from "node:test";
import {
  apiFunctionConfig,
  mergeRoutes,
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
