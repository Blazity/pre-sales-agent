import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RepoSnapshot {
  gitBranch: string;
  packageJson: string;
  ciWorkflow: string;
  agentsMd: string;
  claudeMd: string;
  lessonsMd: string;
  architectureMd: string;
  mcpToolsMd: string;
  codeReviewSkillMd: string;
  codeReviewChecklistMd: string;
  orchestratorTs: string;
  slackInteractionTs: string;
  mcpServerSources: string[];
}

export type DriftFindingCode =
  | "branch-conflict"
  | "runtime-fact-missing"
  | "stale-runtime-claim"
  | "timeout-mismatch"
  | "mcp-tool-undocumented"
  | "mcp-tool-not-registered"
  | "allowed-tool-missing-step"
  | "review-gate-missing"
  | "script-missing";

export interface DriftFinding {
  code: DriftFindingCode;
  severity: "error";
  message: string;
}

const ALLOWED_TOOL_STEP_EXEMPTIONS = new Set([
  "drive_list_files",
  "drive_get_file",
  "drive_search_files",
  "drive_export_file",
  "docs_get_document",
  "docs_copy_template",
  "post_message",
  "get_figma_data",
  "download_figma_images",
]);

const REQUIRED_REVIEW_GATES = [
  "npm run typecheck",
  "npm test",
  "npm run audit:high",
  "npm run scan:secrets",
  "npm run check:mcp-isolation",
  "npm run check:ai-docs",
];

const REQUIRED_RUNTIME_FACTS = [
  {
    label: "Vercel Functions",
    pattern: /\bVercel Functions?\b/i,
  },
  {
    label: "Vercel Workflow",
    pattern: /\bVercel Workflow\b/i,
  },
  {
    label: "Vercel Sandbox",
    pattern: /\bVercel Sandbox\b/i,
  },
  {
    label: "Claude Agent SDK",
    pattern: /\bClaude Agent SDK\b/i,
  },
  {
    label: "MCP servers",
    pattern: /\bMCP (?:tool )?servers?\b/i,
  },
];

function finding(code: DriftFindingCode, message: string): DriftFinding {
  return { code, severity: "error", message };
}

export function parseWaitForReplyTimeoutMinutes(source: string): number | null {
  const implementationMatch = source.match(/Date\.now\(\)\s*\+\s*(\d+)\s*\*\s*60\s*\*\s*1000/);
  if (implementationMatch) {
    return Number(implementationMatch[1]);
  }

  const proseMatch = source.match(/\b(?:up\s+to|within|for|after|timeout(?:s)?\s+after|waits?\s+for)\s+(\d+)\s*(?:minutes?|mins?|min)\b/i);
  if (proseMatch) {
    return Number(proseMatch[1]);
  }

  const compactProseMatch = source.match(/\((?:up\s+to\s+)?(\d+)\s*(?:minutes?|mins?|min)\)/i);
  return compactProseMatch ? Number(compactProseMatch[1]) : null;
}

export function parseMcpServerTools(source: string): string[] {
  const tools = new Set<string>();
  const toolPattern = /\bserver\.tool\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;

  for (const match of source.matchAll(toolPattern)) {
    tools.add(match[1]);
  }

  return [...tools].sort();
}

export function parseDocumentedTools(markdown: string): Set<string> {
  const tools = new Set<string>();

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) {
      continue;
    }

    for (const match of line.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)) {
      tools.add(match[1]);
    }
  }

  return tools;
}

export function parseToolToStep(source: string): Map<string, number> {
  const map = new Map<string, number>();
  const objectMatch = source.match(/\bTOOL_TO_STEP\b[^=]*=\s*{([\s\S]*?)}\s*;/);
  if (!objectMatch) {
    return map;
  }

  const entryPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(\d+)\s*,?/g;
  for (const match of objectMatch[1].matchAll(entryPattern)) {
    map.set(match[1], Number(match[2]));
  }

  return map;
}

export function parseAllowedTools(source: string): Set<string> {
  const tools = new Set<string>();
  const allowedToolsArray = extractArrayAfterProperty(source, "allowedTools");
  if (!allowedToolsArray) {
    return tools;
  }

  const allowedToolPattern = /mcp__[^"'`\s]+__([a-zA-Z0-9_]+)/g;

  for (const match of allowedToolsArray.matchAll(allowedToolPattern)) {
    tools.add(match[1]);
  }

  return tools;
}

function extractArrayAfterProperty(source: string, propertyName: string): string | null {
  const propertyMatch = new RegExp(`\\b${propertyName}\\s*:`).exec(source);
  if (!propertyMatch) {
    return null;
  }

  const arrayStart = source.indexOf("[", propertyMatch.index + propertyMatch[0].length);
  if (arrayStart === -1) {
    return null;
  }

  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = arrayStart; index < source.length; index++) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "[") {
      depth++;
      continue;
    }

    if (char === "]") {
      depth--;
      if (depth === 0) {
        return source.slice(arrayStart + 1, index);
      }
    }
  }

  return null;
}

export function checkAiDocsDrift(snapshot: RepoSnapshot): DriftFinding[] {
  const findings: DriftFinding[] = [];

  findings.push(...checkBranchConflicts(snapshot));
  findings.push(...checkRequiredRuntimeFacts(snapshot));
  findings.push(...checkStaleRuntimeClaims(snapshot));
  findings.push(...checkWaitForReplyTimeout(snapshot));
  findings.push(...checkMcpToolDocs(snapshot));
  findings.push(...checkAllowedToolSteps(snapshot));
  findings.push(...checkReviewGates(snapshot));
  findings.push(...checkPackageScripts(snapshot));

  return findings;
}

function checkRequiredRuntimeFacts(snapshot: RepoSnapshot): DriftFinding[] {
  return REQUIRED_RUNTIME_FACTS.flatMap(({ label, pattern }) => {
    if (pattern.test(snapshot.architectureMd)) {
      return [];
    }

    return [finding("runtime-fact-missing", `.ai/architecture.md must mention current runtime fact: ${label}.`)];
  });
}

function checkBranchConflicts(snapshot: RepoSnapshot): DriftFinding[] {
  const expected = snapshot.gitBranch.trim();
  const conflictingBranch = expected === "main" ? "master" : expected === "master" ? "main" : null;
  if (!conflictingBranch) {
    return [];
  }

  return Object.entries({
    "AGENTS.md": snapshot.agentsMd,
    "CLAUDE.md": snapshot.claudeMd,
    ".ai/lessons.md": snapshot.lessonsMd,
  }).flatMap(([name, source]) => {
    if (!new RegExp(`\\b${conflictingBranch}\\b`, "i").test(source)) {
      return [];
    }

    return [
      finding(
        "branch-conflict",
        `${name} mentions ${conflictingBranch}, but the default branch is ${expected}.`,
      ),
    ];
  });
}

function checkStaleRuntimeClaims(snapshot: RepoSnapshot): DriftFinding[] {
  const runtimePattern = /\b(?:BullMQ|Express\/Bolt|Express)\b/i;
  const qualifierPattern = /\b(?:historical|legacy|older)\b/i;
  const docs = {
    "AGENTS.md": snapshot.agentsMd,
    "CLAUDE.md": snapshot.claudeMd,
    ".ai/architecture.md": snapshot.architectureMd,
  };

  const findings: DriftFinding[] = [];
  for (const [name, source] of Object.entries(docs)) {
    const staleLine = source.split(/\r?\n/).find((line) => runtimePattern.test(line) && !qualifierPattern.test(line));
    if (staleLine) {
      findings.push(finding("stale-runtime-claim", `${name} has an unqualified stale runtime claim: ${staleLine.trim()}`));
    }
  }

  return findings;
}

function checkWaitForReplyTimeout(snapshot: RepoSnapshot): DriftFinding[] {
  const implementationMinutes = parseWaitForReplyTimeoutMinutes(snapshot.slackInteractionTs);
  if (implementationMinutes === null) {
    return [
      finding("timeout-mismatch", "Could not parse wait_for_reply timeout from src/mcp-servers/slack-interaction.ts."),
    ];
  }

  const docs = {
    ".ai/mcp-tools.md": snapshot.mcpToolsMd,
    ".ai/lessons.md": snapshot.lessonsMd,
    ".ai/architecture.md": snapshot.architectureMd,
    "CLAUDE.md": snapshot.claudeMd,
    "AGENTS.md": snapshot.agentsMd,
  };

  const findings: DriftFinding[] = [];
  for (const [name, source] of Object.entries(docs)) {
    for (const line of source.split(/\r?\n/)) {
      if (!/\bwait_for_reply\b/.test(line)) {
        continue;
      }

      const documentedMinutes = parseWaitForReplyTimeoutMinutes(line);
      if (documentedMinutes !== null && documentedMinutes !== implementationMinutes) {
        findings.push(
          finding(
            "timeout-mismatch",
            `${name} says wait_for_reply waits ${documentedMinutes} minutes, but implementation waits ${implementationMinutes} minutes.`,
          ),
        );
      }
    }
  }

  return findings;
}

function checkMcpToolDocs(snapshot: RepoSnapshot): DriftFinding[] {
  const registeredServerTools = new Set(snapshot.mcpServerSources.flatMap(parseMcpServerTools));
  const documentedTools = parseDocumentedTools(snapshot.mcpToolsMd);
  const sourceRegisteredTools = new Set([...registeredServerTools, ...parseAllowedTools(snapshot.orchestratorTs)]);
  const findings: DriftFinding[] = [];

  for (const tool of [...registeredServerTools].sort()) {
    if (!documentedTools.has(tool)) {
      findings.push(finding("mcp-tool-undocumented", `MCP tool ${tool} is registered in source but missing from .ai/mcp-tools.md.`));
    }
  }

  for (const tool of [...documentedTools].sort()) {
    if (!sourceRegisteredTools.has(tool)) {
      findings.push(finding("mcp-tool-not-registered", `MCP tool ${tool} is documented in .ai/mcp-tools.md but not registered in source.`));
    }
  }

  return findings;
}

function checkAllowedToolSteps(snapshot: RepoSnapshot): DriftFinding[] {
  const toolToStep = parseToolToStep(snapshot.orchestratorTs);
  const allowedTools = parseAllowedTools(snapshot.orchestratorTs);
  const findings: DriftFinding[] = [];

  for (const tool of [...allowedTools].sort()) {
    if (!toolToStep.has(tool) && !ALLOWED_TOOL_STEP_EXEMPTIONS.has(tool)) {
      findings.push(finding("allowed-tool-missing-step", `Allowed tool ${tool} is missing from TOOL_TO_STEP.`));
    }
  }

  return findings;
}

function checkReviewGates(snapshot: RepoSnapshot): DriftFinding[] {
  const reviewDocs = `${snapshot.codeReviewSkillMd}\n${snapshot.codeReviewChecklistMd}`;

  return REQUIRED_REVIEW_GATES.flatMap((command) => {
    if (reviewDocs.includes(command)) {
      return [];
    }

    return [finding("review-gate-missing", `Code review docs do not mention required gate: ${command}.`)];
  });
}

function checkPackageScripts(snapshot: RepoSnapshot): DriftFinding[] {
  try {
    const packageJson = JSON.parse(snapshot.packageJson) as { scripts?: Record<string, string> };
    const checkAiDocsScript = packageJson.scripts?.["check:ai-docs"];
    if (checkAiDocsScript && invokesAiDocsDriftChecker(checkAiDocsScript)) {
      return [];
    }
  } catch (error) {
    return [finding("script-missing", `Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`)];
  }

  return [finding("script-missing", "package.json scripts.check:ai-docs must run .ai/checks/check-ai-docs-drift.ts.")];
}

function invokesAiDocsDriftChecker(script: string): boolean {
  const checkerPath = String.raw`\.ai/checks/check-ai-docs-drift\.ts`;
  const commandPatterns = [
    new RegExp(String.raw`(?:^|&&|\|\||;)\s*tsx\s+${checkerPath}(?:\s|$)`),
    new RegExp(String.raw`(?:^|&&|\|\||;)\s*npx\s+tsx\s+${checkerPath}(?:\s|$)`),
    new RegExp(String.raw`(?:^|&&|\|\||;)\s*node\s+--import\s+tsx\s+${checkerPath}(?:\s|$)`),
  ];

  return commandPatterns.some((pattern) => pattern.test(script));
}

export function loadRepoSnapshot(root: string): RepoSnapshot {
  const ciWorkflow = readOptionalFile(root, ".github/workflows/ci.yml");

  return {
    gitBranch: detectDefaultBranch(root, ciWorkflow),
    packageJson: readRequiredFile(root, "package.json"),
    ciWorkflow,
    agentsMd: readOptionalFile(root, "AGENTS.md"),
    claudeMd: readOptionalFile(root, "CLAUDE.md"),
    lessonsMd: readOptionalFile(root, ".ai/lessons.md"),
    architectureMd: readOptionalFile(root, ".ai/architecture.md"),
    mcpToolsMd: readOptionalFile(root, ".ai/mcp-tools.md"),
    codeReviewSkillMd: readOptionalFile(root, ".ai/skills/code-review/SKILL.md"),
    codeReviewChecklistMd: readOptionalFile(root, ".ai/skills/code-review/references/checklist.md"),
    orchestratorTs: readOptionalFile(root, "src/agents/orchestrator.ts"),
    slackInteractionTs: readOptionalFile(root, "src/mcp-servers/slack-interaction.ts"),
    mcpServerSources: readMcpServerSources(root),
  };
}

function readRequiredFile(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readOptionalFile(root: string, relativePath: string): string {
  const fullPath = path.join(root, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function readMcpServerSources(root: string): string[] {
  const mcpServerDir = path.join(root, "src/mcp-servers");
  if (!fs.existsSync(mcpServerDir)) {
    return [];
  }

  return fs
    .readdirSync(mcpServerDir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .sort()
    .map((file) => fs.readFileSync(path.join(mcpServerDir, file), "utf8"));
}

function detectDefaultBranch(root: string, ciWorkflow: string): string {
  const ciBranchMatch = ciWorkflow.match(/branches:\s*\[\s*(main|master)\s*\]/);
  if (ciBranchMatch) {
    return ciBranchMatch[1];
  }

  try {
    return execSync("git symbolic-ref --short refs/remotes/origin/HEAD", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().replace(/^origin\//, "");
  } catch {
    return execSync("git branch --show-current", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  }
}

function findRepoRoot(start: string): string {
  let current = path.resolve(start);
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "package.json")) && fs.existsSync(path.join(current, ".ai"))) {
      return current;
    }
    current = path.dirname(current);
  }

  return path.resolve(start);
}

function runCli(): void {
  const snapshot = loadRepoSnapshot(findRepoRoot(process.cwd()));
  const findings = checkAiDocsDrift(snapshot);

  if (findings.length === 0) {
    console.log("AI docs drift check passed.");
    return;
  }

  console.error("AI docs drift check failed:");
  for (const item of findings) {
    console.error(`- [${item.severity}] ${item.code}: ${item.message}`);
  }
  process.exitCode = 1;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  runCli();
}
