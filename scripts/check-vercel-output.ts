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
