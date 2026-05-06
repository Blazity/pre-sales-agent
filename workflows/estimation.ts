import { FatalError, sleep } from "workflow";
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

interface PumpStepInput {
  jobId: string;
  sandbox: Sandbox;
  command: Command;
  offset: number;
  isFirstTick: boolean;
}

interface PumpStepResult {
  done: boolean;
  status?: "completed" | "failed";
  error?: string;
  offset: number;
}

const MAX_PUMP_ITERATIONS = 1200;

export async function estimationWorkflow(job: EstimationJob): Promise<EstimationWorkflowResult> {
  "use workflow";

  const { resolveWorkspaceProvider } = await import("../src/runtime/sandbox.js");
  const provider = resolveWorkspaceProvider();

  if (provider !== "vercel-sandbox") {
    await runLocalAgentStep(job);
    return { jobId: job.jobId, status: "completed" };
  }

  const booted = await bootJobStep(job);
  let result: PumpStepResult | null = null;
  let offset = 0;
  try {
    for (let i = 0; i < MAX_PUMP_ITERATIONS; i++) {
      const tick = await pumpSandboxStep({
        jobId: booted.jobId,
        sandbox: booted.sandbox,
        command: booted.command,
        offset,
        isFirstTick: i === 0,
      });
      offset = tick.offset;
      if (tick.done) {
        result = tick;
        break;
      }
      await sleep("3s");
    }
  } finally {
    await cleanupSandboxStep({ jobId: booted.jobId, sandbox: booted.sandbox });
  }

  if (!result) {
    throw new FatalError(
      `Sandbox orchestrator did not finish within ${MAX_PUMP_ITERATIONS} pump iterations`,
    );
  }
  if (result.status !== "completed") {
    throw new FatalError(result.error ?? "Sandbox orchestrator failed without an error message");
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

async function pumpSandboxStep(input: PumpStepInput): Promise<PumpStepResult> {
  "use step";

  const { createWorkflowReporter } = await import("../src/lib/workflow-reporter.js");
  const { pumpOrchestratorEventsOnce } = await import("../src/runtime/sandbox.js");
  const reporter = createWorkflowReporter(input.jobId);

  if (input.isFirstTick) {
    await reporter.system("Attached to sandbox", {
      sandboxId: input.sandbox.sandboxId,
      eventOffset: input.offset,
    });
  }

  const tick = await pumpOrchestratorEventsOnce({
    sandbox: input.sandbox,
    command: input.command,
    reporter,
    offset: input.offset,
    isFirstTick: input.isFirstTick,
  });

  return {
    done: tick.done,
    status: tick.status,
    error: tick.error,
    offset: tick.offset,
  };
}
pumpSandboxStep.maxRetries = 3;

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
