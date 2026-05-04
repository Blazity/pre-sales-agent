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
