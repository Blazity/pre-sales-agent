import { FatalError } from "workflow";
import type { Sandbox, Command } from "@vercel/sandbox";
import type { EstimationJob } from "../src/agents/orchestrator.js";

export interface EstimationWorkflowResult {
  jobId: string;
  status: "completed";
}

interface BootJobResult {
  jobId: string;
  sandbox: Sandbox;
  command: Command;
}

interface StreamResult {
  status: "completed" | "failed";
  error?: string;
  offset: number;
}

export async function estimationWorkflow(job: EstimationJob): Promise<EstimationWorkflowResult> {
  "use workflow";

  const { resolveWorkspaceProvider } = await import("../src/runtime/sandbox.js");
  const provider = resolveWorkspaceProvider();

  if (provider !== "vercel-sandbox") {
    await runLocalAgentStep(job);
    return { jobId: job.jobId, status: "completed" };
  }

  const booted = await bootJobStep(job);
  let stream: StreamResult | null = null;
  try {
    stream = await streamOrchestratorStep({
      jobId: booted.jobId,
      sandbox: booted.sandbox,
      command: booted.command,
      offset: 0,
    });
  } finally {
    await cleanupSandboxStep({ jobId: booted.jobId, sandbox: booted.sandbox });
  }

  if (!stream || stream.status !== "completed") {
    throw new FatalError(stream?.error ?? "Sandbox orchestrator failed without an error message");
  }

  return { jobId: job.jobId, status: "completed" };
}

async function runLocalAgentStep(job: EstimationJob): Promise<void> {
  "use step";

  const { createWorkflowReporter } = await import("../src/lib/workflow-reporter.js");
  const { runEstimationWorkflow } = await import("../src/agents/orchestrator.js");
  const reporter = createWorkflowReporter(job.jobId);
  await reporter.progress({ status: "running", step: 0, stepName: "Initializing", turnsCompleted: 0 });
  await reporter.system("Running estimation in local provider", { provider: "local" });
  try {
    await runEstimationWorkflow(job, reporter);
  } catch (err) {
    await reporter.progress({ status: "failed" });
    await reporter.system("Local agent step failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

async function bootJobStep(job: EstimationJob): Promise<BootJobResult> {
  "use step";

  const { createWorkflowReporter } = await import("../src/lib/workflow-reporter.js");
  const { bootSandboxForJob } = await import("../src/runtime/sandbox.js");
  const reporter = createWorkflowReporter(job.jobId);

  await reporter.progress({ status: "running", step: 0, stepName: "Initializing", turnsCompleted: 0 });
  await reporter.system("Booting Vercel Sandbox for agent execution", { provider: "vercel-sandbox" });

  try {
    const { sandbox, command } = await bootSandboxForJob({ job });
    await reporter.system("Sandbox ready", { sandboxId: sandbox.sandboxId });
    return { jobId: job.jobId, sandbox, command };
  } catch (err) {
    await reporter.progress({ status: "failed" });
    await reporter.system("Sandbox boot failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
bootJobStep.maxRetries = 0;

interface StreamStepInput {
  jobId: string;
  sandbox: Sandbox;
  command: Command;
  offset: number;
}

async function streamOrchestratorStep(input: StreamStepInput): Promise<StreamResult> {
  "use step";

  const { createWorkflowReporter } = await import("../src/lib/workflow-reporter.js");
  const { streamOrchestratorEvents } = await import("../src/runtime/sandbox.js");
  const reporter = createWorkflowReporter(input.jobId);

  await reporter.system("Attached to sandbox", {
    sandboxId: input.sandbox.sandboxId,
    eventOffset: input.offset,
  });

  return await streamOrchestratorEvents({
    sandbox: input.sandbox,
    command: input.command,
    reporter,
    offset: input.offset,
  });
}
streamOrchestratorStep.maxRetries = 5;

interface CleanupStepInput {
  jobId: string;
  sandbox: Sandbox;
}

async function cleanupSandboxStep(input: CleanupStepInput): Promise<void> {
  "use step";

  const { stopSandbox } = await import("../src/runtime/sandbox.js");
  await stopSandbox(input.sandbox, input.jobId);
}
cleanupSandboxStep.maxRetries = 2;
