import { writeFile } from "node:fs/promises";
import path from "node:path";
import ms from "ms";
import { Sandbox } from "@vercel/sandbox";
import {
  resolveRepoRevision,
  resolveRepoUrl,
} from "../src/runtime/sandbox.js";

const root = process.cwd();
const SNAPSHOT_ID_FILE = path.join(root, "src", "runtime", "sandbox-snapshot-id.ts");
const SANDBOX_CWD = "/vercel/sandbox";
function warn(message: string): void {
  process.stdout.write(`[snapshot-sandbox] ${message}\n`);
}

export function shouldCreateSnapshot(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === "1";
}

async function writeSnapshotIdFile(snapshotId: string | null): Promise<void> {
  const literal = snapshotId === null ? "null" : JSON.stringify(snapshotId);
  const content = `export const SANDBOX_TEMPLATE_SNAPSHOT_ID: string | null = ${literal};\n`;
  await writeFile(SNAPSHOT_ID_FILE, content, "utf8");
}

async function main(): Promise<void> {
  const env = process.env;
  if (!shouldCreateSnapshot(env)) {
    warn("Not running on Vercel — skipping sandbox snapshot. Runtime will fall back to git-clone path.");
    return;
  }

  const repoUrl = resolveRepoUrl(env);
  const revision = resolveRepoRevision(env);
  const gitToken = env.AGENT_REPO_TOKEN ?? env.GITHUB_TOKEN;
  const source = gitToken
    ? {
        type: "git" as const,
        url: repoUrl,
        revision,
        depth: 1,
        username: "x-access-token",
        password: gitToken,
      }
    : { type: "git" as const, url: repoUrl, revision, depth: 1 };

  warn(`Creating template sandbox from ${repoUrl}@${revision}`);
  warn("Using Vercel-provided Sandbox authentication");
  const sandbox = await Sandbox.create({
    source,
    resources: { vcpus: 2 },
    runtime: "node24",
    timeout: ms("15m"),
  });

  try {
    warn(`Sandbox ${sandbox.sandboxId} created — running npm ci`);
    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["ci", "--no-audit", "--no-fund"],
      cwd: SANDBOX_CWD,
    });
    if (install.exitCode !== 0) {
      const stderr = await install.stderr();
      throw new Error(`npm ci failed (exit ${install.exitCode}): ${stderr.slice(0, 500)}`);
    }

    warn("Running npm run build");
    const build = await sandbox.runCommand({
      cmd: "npm",
      args: ["run", "build"],
      cwd: SANDBOX_CWD,
    });
    if (build.exitCode !== 0) {
      const stderr = await build.stderr();
      throw new Error(`npm run build failed (exit ${build.exitCode}): ${stderr.slice(0, 500)}`);
    }

    warn("Snapshotting template");
    const snapshot = await sandbox.snapshot({ expiration: 0 });
    warn(`Snapshot ${snapshot.snapshotId} created`);
    await writeSnapshotIdFile(snapshot.snapshotId);
    warn(`Wrote snapshot id to ${path.relative(root, SNAPSHOT_ID_FILE)}`);
  } catch (err) {
    await sandbox.stop().catch(() => {});
    warn(`Snapshot failed: ${err instanceof Error ? err.message : String(err)} — runtime will fall back to git-clone path.`);
    await writeSnapshotIdFile(null);
  }
}

const isEntrypoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntrypoint) {
  main().catch((err) => {
    warn(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(0);
  });
}
