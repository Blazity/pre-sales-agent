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

export function resolveSnapshotCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { token: string; teamId: string; projectId: string } | { reason: string } {
  const token = env.VERCEL_TOKEN;
  const teamId = env.VERCEL_TEAM_ID;
  const projectId = env.VERCEL_PROJECT_ID;
  if (!token || !teamId || !projectId) {
    const missing = [
      !token && "VERCEL_TOKEN",
      !teamId && "VERCEL_TEAM_ID",
      !projectId && "VERCEL_PROJECT_ID",
    ].filter(Boolean).join(", ");
    return { reason: `${missing} not set — skipping sandbox snapshot. Runtime will fall back to git-clone path.` };
  }
  return { token, teamId, projectId };
}

async function writeSnapshotIdFile(snapshotId: string | null): Promise<void> {
  const literal = snapshotId === null ? "null" : JSON.stringify(snapshotId);
  const content = `export const SANDBOX_TEMPLATE_SNAPSHOT_ID: string | null = ${literal};\n`;
  await writeFile(SNAPSHOT_ID_FILE, content, "utf8");
}

async function main(): Promise<void> {
  const env = process.env;
  const creds = resolveSnapshotCredentials(env);
  if ("reason" in creds) {
    warn(creds.reason);
    if (env.VERCEL === "1") {
      warn(
        "BUILD-TIME SANDBOX SNAPSHOT WAS NOT CREATED. " +
          "Set VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID in this project's Build env, " +
          "then redeploy. Without the snapshot, every estimation pays ~60–120s of npm ci/build, " +
          "and the runtime sandbox must clone the source repo (private repos require AGENT_REPO_TOKEN).",
      );
    }
    return;
  }
  const { token, teamId, projectId } = creds;

  const repoUrl = resolveRepoUrl(env);
  const revision = resolveRepoRevision(env);
  const gitToken = env.AGENT_REPO_TOKEN ?? env.GITHUB_TOKEN;
  const source = gitToken
    ? {
        type: "git" as const,
        url: repoUrl,
        revision,
        depth: 1,
        username: env.AGENT_REPO_USERNAME ?? gitToken,
        password: env.AGENT_REPO_USERNAME ? gitToken : "x-oauth-basic",
      }
    : { type: "git" as const, url: repoUrl, revision, depth: 1 };

  warn(`Creating template sandbox from ${repoUrl}@${revision}`);
  const sandbox = await Sandbox.create({
    teamId,
    projectId,
    token,
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
