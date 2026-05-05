export interface VercelRoute {
  src: string;
  dest: string;
}

export interface VercelOutputConfig {
  version: 3;
  routes?: VercelRoute[];
}

export interface VercelFunctionConfig {
  runtime: "nodejs20.x";
  handler: "index.js";
  launcherType: "Nodejs";
  shouldAddHelpers: true;
}

export const MCP_SERVER_NAMES = [
  "knowledge-base",
  "google-workspace",
  "web-research",
  "slack-interaction",
] as const;

export type McpServerName = typeof MCP_SERVER_NAMES[number];

export function mcpServerOutputPath(name: McpServerName): string {
  return `.vercel/output/functions/.well-known/workflow/v1/step.func/mcp-servers/${name}.mjs`;
}

export function requiredMcpServerOutputFiles(): string[] {
  return MCP_SERVER_NAMES.map((name) => mcpServerOutputPath(name));
}

export function mergeRoutes(
  config: VercelOutputConfig,
  routesToAdd: VercelRoute[],
): VercelOutputConfig {
  const routes = [...(config.routes ?? [])];
  const seen = new Set(routes.map((route) => `${route.src}\u0000${route.dest}`));

  for (const route of routesToAdd) {
    const key = `${route.src}\u0000${route.dest}`;
    if (!seen.has(key)) {
      routes.push(route);
      seen.add(key);
    }
  }

  return { ...config, routes };
}

export function apiFunctionConfig(): VercelFunctionConfig {
  return {
    runtime: "nodejs20.x",
    handler: "index.js",
    launcherType: "Nodejs",
    shouldAddHelpers: true,
  };
}
