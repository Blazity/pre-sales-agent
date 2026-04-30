import { Sandbox } from "@vercel/sandbox";
import { logger } from "../lib/logger.js";

export type WorkspaceProvider = "vercel-sandbox" | "local";

export function resolveWorkspaceProvider(env: NodeJS.ProcessEnv = process.env): WorkspaceProvider {
  const configured = env.AGENT_WORKSPACE_PROVIDER;
  if (configured === "vercel-sandbox" || configured === "local") return configured;
  return env.VERCEL ? "vercel-sandbox" : "local";
}

export async function runSandboxSmokeTest(): Promise<{ sandboxId: string; exitCode: number }> {
  const sandbox = await Sandbox.create({
    resources: { vcpus: 2 },
    runtime: "node24",
    timeout: 5 * 60 * 1000,
  });

  try {
    const result = await sandbox.runCommand({
      cmd: "node",
      args: ["--version"],
      stdout: process.stdout,
      stderr: process.stderr,
    });

    logger.info("Vercel Sandbox smoke test completed", {
      sandboxId: sandbox.sandboxId,
      exitCode: result.exitCode,
    });

    return { sandboxId: sandbox.sandboxId, exitCode: result.exitCode };
  } finally {
    await sandbox.stop().catch((err) => {
      logger.warn("Failed to stop Vercel Sandbox after smoke test", {
        sandboxId: sandbox.sandboxId,
        error: String(err),
      });
    });
  }
}
