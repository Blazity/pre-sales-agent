import type { EstimationJob } from "../src/agents/orchestrator.js";

export interface EstimationWorkflowResult {
  jobId: string;
  status: "completed";
}

export async function estimationWorkflow(job: EstimationJob): Promise<EstimationWorkflowResult> {
  "use workflow";

  await runAgentStep(job);
  return { jobId: job.jobId, status: "completed" };
}

async function runAgentStep(job: EstimationJob): Promise<void> {
  "use step";

  const { runEstimationWorkflow } = await import("../src/agents/orchestrator.js");
  const { createWorkflowReporter } = await import("../src/lib/workflow-reporter.js");

  const reporter = createWorkflowReporter(job.jobId);

  try {
    await reporter.progress({
      status: "running",
      step: 0,
      stepName: "Initializing",
      turnsCompleted: 0,
    });
    await runEstimationWorkflow(job, reporter);
  } catch (err) {
    await reporter.progress({ status: "failed" });
    await reporter.system("Workflow step failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
