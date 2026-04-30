const controllers = new Map<string, AbortController>();

export function registerJob(jobId: string): AbortController {
  const controller = new AbortController();
  controllers.set(jobId, controller);
  return controller;
}

export function cancelJob(jobId: string): boolean {
  const controller = controllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  controllers.delete(jobId);
  return true;
}

export function unregisterJob(jobId: string) {
  controllers.delete(jobId);
}
