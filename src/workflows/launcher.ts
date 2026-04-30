import { start } from "workflow/api";
import type { Run } from "workflow/api";
import type { EstimationWorkflowResult } from "../../workflows/estimation.js";
import type { EstimationJob } from "../agents/orchestrator.js";

type EstimationWorkflowInput = Omit<EstimationJob, "jobId"> | EstimationJob;
const ESTIMATION_WORKFLOW = {
  workflowId: "workflow//./workflows/estimation//estimationWorkflow",
} as const;

type StartEstimationWorkflow = (
  workflow: typeof ESTIMATION_WORKFLOW,
  args: [EstimationJob]
) => Promise<Pick<Run<EstimationWorkflowResult>, "runId">>;

export function buildEstimationWorkflowPayload(
  job: EstimationWorkflowInput,
  now = Date.now()
): EstimationJob {
  return {
    ...job,
    jobId: "jobId" in job && job.jobId ? job.jobId : `est_${now}`,
  };
}

export function createEstimationWorkflowStarter(startWorkflow: StartEstimationWorkflow = start) {
  return async function startEstimationWorkflow(
    job: EstimationWorkflowInput,
    now = Date.now()
  ): Promise<{ jobId: string; runId: string }> {
    const payload = buildEstimationWorkflowPayload(job, now);
    const run = await startWorkflow(ESTIMATION_WORKFLOW, [payload]);
    return { jobId: payload.jobId, runId: run.runId };
  };
}

export const startEstimationWorkflow = createEstimationWorkflowStarter();
