# Vercel Workflow Deployment Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy both Slack/API ingress functions and Vercel Workflow runtime functions so `/estimate` runs to completion, while wiring project skill discovery for supported agent harnesses.

**Architecture:** Use Vercel Build Output API as the single deployment artifact. A repo-owned build script runs Workflow's Vercel output build, bundles the existing API handlers into `.vercel/output/functions`, copies narrow static output, and a checker verifies required routes/functions. Project skills stay canonical in `.ai/skills` and are discovered through ai-harness-style symlinks from `.claude/skills`, `.agents/skills`, and `.cursor/skills`.

**Tech Stack:** Node.js 20+, TypeScript ESM, `tsx`, `esbuild` for API function bundling, Vercel Build Output API v3, Vercel Workflow CLI, Node's built-in test runner.

---

## File Structure

- Create: `scripts/build-vercel-output.ts` - build `.vercel/output` by combining Workflow-generated functions, bundled API functions, and static assets.
- Create: `scripts/check-vercel-output.ts` - verify required Build Output API config, function directories, routes, and static files.
- Create: `src/vercel-output/config.ts` - pure helpers for route merging and function config generation.
- Create: `src/vercel-output/config.test.ts` - tests for route merging and function config helpers.
- Create: `src/onboarding/skill-discovery.ts` - pure helpers to validate `.ai/skills` discovery symlinks.
- Create: `src/onboarding/skill-discovery.test.ts` - tests for skill discovery validation.
- Create: `public/index.html` - minimal static landing page.
- Create symlinks: `.claude/skills`, `.agents/skills`, `.cursor/skills` -> `../.ai/skills`.
- Modify: `package.json` - build and verification scripts, `esbuild` dev dependency.
- Modify: `tsconfig.json` - include `scripts/**/*`.
- Modify: `README.md`, `docs/first-launch.md`, `docs/setup.md`, `docs/deployment/vercel.md`, `.ai/skills/README.md`, `.ai/skills/first-launch/SKILL.md` - document build verification and skill discovery.
- Modify: `.ai/checks/check-ai-docs-drift.ts`, `.ai/checks/check-ai-docs-drift.test.ts` - prevent docs/scripts from drifting on gates, Slack setup, and skill discovery.
- Modify: `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `AGENTS.md`, `.ai/skills/code-review/SKILL.md`, `.ai/skills/code-review/references/checklist.md` - add new required checks.

### Task 1: Build Output Config Helpers

**Files:**
- Create: `src/vercel-output/config.ts`
- Create: `src/vercel-output/config.test.ts`

- [ ] **Step 1: Write tests for route merge and function config**

Create `src/vercel-output/config.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/vercel-output/config.test.ts
```

Expected: fails because `src/vercel-output/config.ts` does not exist.

- [ ] **Step 3: Implement config helpers**

Create `src/vercel-output/config.ts`:

```ts
export interface VercelRoute {
  src: string;
  dest: string;
}

export interface VercelOutputConfig {
  version: 3;
  routes?: VercelRoute[];
}

export interface VercelFunctionConfig {
  runtime: "nodejs20.x";
  handler: "index.js";
  launcherType: "Nodejs";
  shouldAddHelpers: true;
}

export function mergeRoutes(
  config: VercelOutputConfig,
  routesToAdd: VercelRoute[],
): VercelOutputConfig {
  const routes = [...(config.routes ?? [])];
  const seen = new Set(routes.map((route) => `${route.src}\u0000${route.dest}`));

  for (const route of routesToAdd) {
    const key = `${route.src}\u0000${route.dest}`;
    if (!seen.has(key)) {
      routes.push(route);
      seen.add(key);
    }
  }

  return { ...config, routes };
}

export function apiFunctionConfig(): VercelFunctionConfig {
  return {
    runtime: "nodejs20.x",
    handler: "index.js",
    launcherType: "Nodejs",
    shouldAddHelpers: true,
  };
}
```

- [ ] **Step 4: Run the test**

Run:

```bash
npm test -- src/vercel-output/config.test.ts
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/vercel-output/config.ts src/vercel-output/config.test.ts
git commit -m "test: add vercel output config helpers"
```

### Task 2: Combined Vercel Output Build

**Files:**
- Create: `scripts/build-vercel-output.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `public/index.html`

- [ ] **Step 1: Add esbuild and scripts**

Modify `package.json`:

```json
{
  "scripts": {
    "build": "workflow validate --strict && npm run typecheck && tsx scripts/build-vercel-output.ts",
    "typecheck": "tsc --noEmit",
    "dev": "npx vercel dev",
    "dev:vercel": "npx vercel dev",
    "seed": "tsx scripts/seed-knowledge-base.ts",
    "setup:google-templates": "tsx scripts/setup-google-templates.ts",
    "doctor:first-launch": "tsx scripts/doctor-first-launch.ts",
    "check:vercel-sandbox": "tsx scripts/check-vercel-sandbox.ts",
    "check:vercel-output": "tsx scripts/check-vercel-output.ts",
    "test": "tsx --test src/**/*.test.ts .ai/checks/*.test.ts",
    "audit:high": "npm audit --audit-level=high",
    "scan:secrets": "tsx scripts/scan-secrets.ts",
    "check:mcp-isolation": "rg \"from ['\\\"]\\.\\./\" src/mcp-servers && exit 1 || exit 0",
    "check:ai-docs": "tsx .ai/checks/check-ai-docs-drift.ts"
  },
  "devDependencies": {
    "@types/express": "latest",
    "@types/node": "latest",
    "esbuild": "latest",
    "tsx": "latest",
    "typescript": "latest"
  }
}
```

Preserve unchanged package metadata, dependencies, overrides, and ordering where possible; only add the new script and dev dependency.

- [ ] **Step 2: Include scripts in TypeScript checks**

Modify `tsconfig.json`:

```json
{
  "include": ["src/**/*", "api/**/*", "workflows/**/*", "scripts/**/*"]
}
```

Preserve existing compiler options.

- [ ] **Step 3: Add static output source**

Create `public/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Pre-Sales Agent</title>
  </head>
  <body>
    <main>
      <h1>Pre-Sales Agent</h1>
      <p>Slack and Vercel Workflow runtime are deployed. Health: <a href="/api/health">/api/health</a>.</p>
    </main>
  </body>
</html>
```

- [ ] **Step 4: Implement the combined build script**

Create `scripts/build-vercel-output.ts`:

```ts
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import {
  apiFunctionConfig,
  mergeRoutes,
  type VercelOutputConfig,
} from "../src/vercel-output/config.js";

const root = process.cwd();
const outputDir = path.join(root, ".vercel", "output");
const functionsDir = path.join(outputDir, "functions");
const staticDir = path.join(outputDir, "static");
const configPath = path.join(outputDir, "config.json");

const apiFunctions = [
  {
    entry: "api/health.ts",
    outDir: "api/health.func",
    route: { src: "^\\/api\\/health$", dest: "/api/health" },
  },
  {
    entry: "api/slack/events.ts",
    outDir: "api/slack/events.func",
    route: { src: "^\\/api\\/slack\\/events$", dest: "/api/slack/events" },
  },
] as const;

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? "unknown status"}`));
      }
    });
  });
}

async function runWorkflowBuild(): Promise<void> {
  await run("npx", ["workflow", "build", "--target", "vercel-build-output-api"]);
}

async function bundleApiFunction(entry: string, outDir: string): Promise<void> {
  const functionDir = path.join(functionsDir, outDir);
  await mkdir(functionDir, { recursive: true });

  await build({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(functionDir, "index.js"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: true,
    logLevel: "info",
  });

  await writeFile(
    path.join(functionDir, ".vc-config.json"),
    `${JSON.stringify(apiFunctionConfig(), null, 2)}\n`,
  );
  await writeFile(path.join(functionDir, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
}

async function updateConfig(): Promise<void> {
  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw) as VercelOutputConfig;
  const updated = mergeRoutes(config, apiFunctions.map((apiFunction) => apiFunction.route));
  await writeFile(configPath, `${JSON.stringify(updated, null, 2)}\n`);
}

async function copyStaticOutput(): Promise<void> {
  await mkdir(staticDir, { recursive: true });
  await cp(path.join(root, "public"), staticDir, { recursive: true });
}

async function main(): Promise<void> {
  await rm(outputDir, { recursive: true, force: true });
  await runWorkflowBuild();

  for (const apiFunction of apiFunctions) {
    await bundleApiFunction(apiFunction.entry, apiFunction.outDir);
  }

  await updateConfig();
  await copyStaticOutput();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: passes. If TypeScript reports missing `esbuild`, run `npm install` once to update `package-lock.json`, then rerun.

- [ ] **Step 6: Run build**

Run:

```bash
npm run build
```

Expected: `.vercel/output` contains workflow functions, `api/health.func`, `api/slack/events.func`, and `static/index.html`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json public/index.html scripts/build-vercel-output.ts src/vercel-output/config.ts src/vercel-output/config.test.ts
git commit -m "fix: emit vercel workflow and api functions"
```

### Task 3: Build Output Verification

**Files:**
- Create: `scripts/check-vercel-output.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the verification script**

Create `scripts/check-vercel-output.ts`:

```ts
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { VercelOutputConfig } from "../src/vercel-output/config.js";

const root = process.cwd();

const requiredFiles = [
  ".vercel/output/config.json",
  ".vercel/output/functions/.well-known/workflow/v1/flow.func/.vc-config.json",
  ".vercel/output/functions/.well-known/workflow/v1/step.func/.vc-config.json",
  ".vercel/output/functions/.well-known/workflow/v1/webhook/[token].func/.vc-config.json",
  ".vercel/output/functions/api/health.func/.vc-config.json",
  ".vercel/output/functions/api/slack/events.func/.vc-config.json",
  "public/index.html",
  ".vercel/output/static/index.html",
];

const requiredRoutes = [
  "/.well-known/workflow/v1/webhook/[token]",
  "/api/health",
  "/api/slack/events",
];

async function exists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const missingFiles: string[] = [];

  for (const file of requiredFiles) {
    if (!await exists(file)) {
      missingFiles.push(file);
    }
  }

  const rawConfig = await readFile(path.join(root, ".vercel/output/config.json"), "utf8");
  const config = JSON.parse(rawConfig) as VercelOutputConfig;
  const routeDests = new Set((config.routes ?? []).map((route) => route.dest));
  const missingRoutes = requiredRoutes.filter((route) => !routeDests.has(route));

  if (config.version !== 3) {
    throw new Error(`Expected .vercel/output/config.json version 3, received ${String(config.version)}`);
  }

  if (missingFiles.length > 0 || missingRoutes.length > 0) {
    throw new Error([
      missingFiles.length > 0 ? `Missing files:\n${missingFiles.map((file) => `- ${file}`).join("\n")}` : "",
      missingRoutes.length > 0 ? `Missing routes:\n${missingRoutes.map((route) => `- ${route}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n"));
  }

  console.log("Vercel output contains required API, Workflow, and static assets.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Run the checker before build**

Run:

```bash
rm -rf .vercel/output
npm run check:vercel-output
```

Expected: fails because `.vercel/output/config.json` is missing.

- [ ] **Step 3: Run build and checker**

Run:

```bash
npm run build
npm run check:vercel-output
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-vercel-output.ts package.json package-lock.json
git commit -m "test: verify vercel build output"
```

### Task 4: Wire Agent Skill Discovery

**Files:**
- Create symlinks: `.claude/skills`, `.agents/skills`, `.cursor/skills`
- Create: `src/onboarding/skill-discovery.ts`
- Create: `src/onboarding/skill-discovery.test.ts`
- Modify: `.ai/skills/README.md`
- Modify: `README.md`

- [ ] **Step 1: Add ai-harness-style discovery symlinks**

Run:

```bash
mkdir -p .claude .agents .cursor
ln -s ../.ai/skills .claude/skills
ln -s ../.ai/skills .agents/skills
ln -s ../.ai/skills .cursor/skills
```

Expected: `find .claude .agents .cursor -maxdepth 1 -type l -print` lists all three skill links.

- [ ] **Step 2: Write skill discovery tests**

Create `src/onboarding/skill-discovery.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedSkillLinks,
  findSkillDiscoveryProblems,
} from "./skill-discovery.js";

test("expectedSkillLinks uses ai-harness discovery targets", () => {
  assert.deepEqual(expectedSkillLinks, [
    { path: ".claude/skills", target: "../.ai/skills" },
    { path: ".agents/skills", target: "../.ai/skills" },
    { path: ".cursor/skills", target: "../.ai/skills" },
  ]);
});

test("findSkillDiscoveryProblems passes for valid symlinks", () => {
  const problems = findSkillDiscoveryProblems({
    ".ai/skills/first-launch/SKILL.md": "file",
    ".claude/skills": "../.ai/skills",
    ".agents/skills": "../.ai/skills",
    ".cursor/skills": "../.ai/skills",
  });

  assert.deepEqual(problems, []);
});

test("findSkillDiscoveryProblems fails when a harness link is missing", () => {
  const problems = findSkillDiscoveryProblems({
    ".ai/skills/first-launch/SKILL.md": "file",
    ".claude/skills": "../.ai/skills",
    ".agents/skills": "../.ai/skills",
  });

  assert.deepEqual(problems, [".cursor/skills must point to ../.ai/skills"]);
});
```

- [ ] **Step 3: Implement skill discovery helper**

Create `src/onboarding/skill-discovery.ts`:

```ts
export interface SkillLink {
  path: string;
  target: string;
}

export const expectedSkillLinks: SkillLink[] = [
  { path: ".claude/skills", target: "../.ai/skills" },
  { path: ".agents/skills", target: "../.ai/skills" },
  { path: ".cursor/skills", target: "../.ai/skills" },
];

export function findSkillDiscoveryProblems(entries: Record<string, string>): string[] {
  const problems: string[] = [];

  if (!Object.keys(entries).some((entry) => entry.startsWith(".ai/skills/") && entry.endsWith("/SKILL.md"))) {
    problems.push(".ai/skills must contain at least one SKILL.md");
  }

  for (const link of expectedSkillLinks) {
    if (entries[link.path] !== link.target) {
      problems.push(`${link.path} must point to ${link.target}`);
    }
  }

  return problems;
}
```

- [ ] **Step 4: Update skill docs**

Modify `.ai/skills/README.md` so the opening section says:

```md
# Skills

This directory is the canonical project skill source. Supported harnesses discover it through ai-harness-style symlinks:

- `.claude/skills` -> `../.ai/skills` for Claude Code.
- `.agents/skills` -> `../.ai/skills` for Codex and agents that read `.agents`.
- `.cursor/skills` -> `../.ai/skills` for Cursor.

If a Windows checkout cannot materialize symlinks, replace each link with a directory junction or a copied `.ai/skills` directory and run `npm run check:ai-docs`.
```

Keep the existing available-skills table after this section.

- [ ] **Step 5: Update README start instructions**

Modify `README.md` step 3 under "Start Here" to:

```md
3. If you are working with an AI coding assistant, use the registered `first-launch` skill. The canonical skill lives in `.ai/skills/first-launch/SKILL.md` and is discovered through `.claude/skills`, `.agents/skills`, and `.cursor/skills`.
```

- [ ] **Step 6: Run skill tests**

Run:

```bash
npm test -- src/onboarding/skill-discovery.test.ts
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills .agents/skills .cursor/skills src/onboarding/skill-discovery.ts src/onboarding/skill-discovery.test.ts .ai/skills/README.md README.md
git commit -m "fix: wire project skill discovery"
```

### Task 5: First-Launch Docs And Skill Corrections

**Files:**
- Modify: `docs/first-launch.md`
- Modify: `docs/setup.md`
- Modify: `docs/deployment/vercel.md`
- Modify: `.ai/skills/first-launch/SKILL.md`

- [ ] **Step 1: Update Slack setup details in docs**

In each first-launch/setup doc section that lists Slack scopes, use:

```md
Required bot token scopes:

- `app_mentions:read`
- `channels:history`
- `chat:write`
- `commands`
- `files:read`

Add `groups:history` only if private channels should work.
```

For event subscriptions, use:

```md
Subscribe to bot events:

- `message.channels`

The first-launch runtime handles `!estimate` channel messages and `/estimate` slash commands. Do not subscribe `app_mention` or `message.im` for first launch unless matching handlers are added and tested.
```

- [ ] **Step 2: Document `/estimate` minimum**

Add near the first estimate examples:

```md
`/estimate` requires at least 20 characters of project description. Shorter input returns an ephemeral Slack rejection and does not start a workflow.
```

- [ ] **Step 3: Document optional seeding variables**

Add to seeding guidance:

```md
Optional knowledge-base source variables:

- `GDRIVE_ESTIMATIONS_FOLDER_ID`
- `GDRIVE_PROPOSALS_FOLDER_ID`
- `CASE_STUDIES_BASE_URL`

First launch can succeed with an empty Pinecone index, but retrieval quality improves only after seeding native Google Sheets estimations, Google Docs proposals, or public case studies.
```

- [ ] **Step 4: Add workflow deployment smoke check**

Add after the build/deploy step:

Run locally before deploying or when diagnosing a stuck workflow:

```bash
npm run build
npm run check:vercel-output
```

The check must confirm both API functions and Workflow runtime functions are present in `.vercel/output`.

- [ ] **Step 5: Update first-launch skill**

Modify `.ai/skills/first-launch/SKILL.md` checklist to include:

```md
- [ ] Project skills discoverable through `.claude/skills`, `.agents/skills`, or `.cursor/skills`
- [ ] `npm run build` emits API and Workflow runtime functions
- [ ] `npm run check:vercel-output` passes
- [ ] Slack bot scopes configured exactly
- [ ] Slack Events subscriptions match supported triggers
```

Modify the common blocker table row for workflow start:

```md
| Slack posts "workflow started" but no thread updates happen | Workflow runtime functions are missing from deployment | Run `npm run build` and `npm run check:vercel-output`; redeploy only after both API and Workflow functions are emitted |
```

- [ ] **Step 6: Commit**

```bash
git add docs/first-launch.md docs/setup.md docs/deployment/vercel.md .ai/skills/first-launch/SKILL.md
git commit -m "docs: clarify first launch workflow setup"
```

### Task 6: Drift Checks And Required Gates

**Files:**
- Modify: `.ai/checks/check-ai-docs-drift.ts`
- Modify: `.ai/checks/check-ai-docs-drift.test.ts`
- Modify: `AGENTS.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/pull_request_template.md`
- Modify: `.ai/skills/code-review/SKILL.md`
- Modify: `.ai/skills/code-review/references/checklist.md`

- [ ] **Step 1: Extend drift snapshot type**

Add fields to `RepoSnapshot` in `.ai/checks/check-ai-docs-drift.ts`:

```ts
firstLaunchMd: string;
setupMd: string;
deploymentVercelMd: string;
skillsReadmeMd: string;
skillLinkEntries: Record<string, string>;
```

Load these in the real snapshot from disk. For symlinks, use `fs.lstatSync(path).isSymbolicLink()` and `fs.readlinkSync(path)`.

- [ ] **Step 2: Add drift finding codes**

Extend `DriftFindingCode` with:

```ts
| "vercel-output-check-missing"
| "skill-discovery-missing"
| "slack-first-launch-doc-missing"
```

- [ ] **Step 3: Add checks**

In `checkAiDocsDrift`, add:

```ts
if (!packageScripts.has("check:vercel-output")) {
  findings.push(finding("script-missing", "package.json must define npm run check:vercel-output"));
}

for (const command of ["npm run check:vercel-output"]) {
  if (!snapshot.agentsMd.includes(command) || !snapshot.ciWorkflow.includes(command)) {
    findings.push(finding("vercel-output-check-missing", `${command} must be listed in AGENTS.md and CI`));
  }
}

for (const problem of findSkillDiscoveryProblems(snapshot.skillLinkEntries)) {
  findings.push(finding("skill-discovery-missing", problem));
}

const slackDocs = [snapshot.firstLaunchMd, snapshot.setupMd, snapshot.deploymentVercelMd].join("\n");
for (const required of ["app_mentions:read", "channels:history", "chat:write", "commands", "files:read", "message.channels", "20 characters", "GDRIVE_ESTIMATIONS_FOLDER_ID", "GDRIVE_PROPOSALS_FOLDER_ID", "CASE_STUDIES_BASE_URL"]) {
  if (!slackDocs.includes(required)) {
    findings.push(finding("slack-first-launch-doc-missing", `First-launch docs must mention ${required}`));
  }
}
```

Import `findSkillDiscoveryProblems` from `src/onboarding/skill-discovery.ts`.

- [ ] **Step 4: Update drift tests**

In `.ai/checks/check-ai-docs-drift.test.ts`, add defaults to `snapshot()` for the new fields and tests:

```ts
test("fails when project skill discovery symlink is missing", () => {
  const findings = checkAiDocsDrift(snapshot({
    skillLinkEntries: {
      ".ai/skills/first-launch/SKILL.md": "file",
      ".claude/skills": "../.ai/skills",
      ".agents/skills": "../.ai/skills",
    },
  }));

  assert.ok(findings.some((finding) => finding.code === "skill-discovery-missing"));
});

test("fails when vercel output check is absent from CI", () => {
  const findings = checkAiDocsDrift(snapshot({
    ciWorkflow: "run: npm run typecheck",
  }));

  assert.ok(findings.some((finding) => finding.code === "vercel-output-check-missing"));
});

test("fails when first-launch docs omit Slack setup details", () => {
  const findings = checkAiDocsDrift(snapshot({
    firstLaunchMd: "Slack setup",
    setupMd: "Setup",
    deploymentVercelMd: "Deployment",
  }));

  assert.ok(findings.some((finding) => finding.code === "slack-first-launch-doc-missing"));
});
```

- [ ] **Step 5: Add new gate everywhere**

Add `npm run check:vercel-output` after `npm run build` in CI and to required-gate docs:

```yaml
      - name: Build Vercel output
        run: npm run build

      - name: Vercel output check
        run: npm run check:vercel-output
```

Add `npm run check:vercel-output` to:

- `AGENTS.md`
- `.github/pull_request_template.md`
- `.ai/skills/code-review/SKILL.md`
- `.ai/skills/code-review/references/checklist.md`

- [ ] **Step 6: Run checks**

Run:

```bash
npm test -- .ai/checks/check-ai-docs-drift.test.ts src/onboarding/skill-discovery.test.ts
npm run check:ai-docs
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add .ai/checks/check-ai-docs-drift.ts .ai/checks/check-ai-docs-drift.test.ts AGENTS.md .github/workflows/ci.yml .github/pull_request_template.md .ai/skills/code-review/SKILL.md .ai/skills/code-review/references/checklist.md
git commit -m "test: guard vercel output and skill discovery drift"
```

### Task 7: Final Verification

**Files:**
- No new files expected.

- [ ] **Step 1: Run required gates**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run check:vercel-output
npm run audit:high
npm run scan:secrets
npm run check:mcp-isolation
npm run check:ai-docs
```

Expected:

- Typecheck passes.
- Tests pass.
- Build emits `.vercel/output`.
- Vercel output check passes.
- Audit has no high advisories. If it reports only lower-than-high advisories, document them without forcing breaking dependency changes.
- Secret scan passes.
- MCP isolation passes.
- AI docs drift check passes.

- [ ] **Step 2: Inspect generated output**

Run:

```bash
find .vercel/output/functions -maxdepth 6 -name .vc-config.json | sort
```

Expected output includes:

```text
.vercel/output/functions/.well-known/workflow/v1/flow.func/.vc-config.json
.vercel/output/functions/.well-known/workflow/v1/step.func/.vc-config.json
.vercel/output/functions/.well-known/workflow/v1/webhook/[token].func/.vc-config.json
.vercel/output/functions/api/health.func/.vc-config.json
.vercel/output/functions/api/slack/events.func/.vc-config.json
```

- [ ] **Step 3: Final status**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: worktree clean except ignored `.vercel/output`; recent commits show this recovery sequence.
