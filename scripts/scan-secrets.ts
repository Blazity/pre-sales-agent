import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

interface Rule {
  name: string;
  pattern: RegExp;
}

const rules: Rule[] = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: "Slack token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "Anthropic API key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI API key", pattern: /(?:sk-proj-|sk-)[A-Za-z0-9_-]{32,}/g },
  { name: "GitHub token", pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}/g },
  { name: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "Vercel token", pattern: /vercel_[A-Za-z0-9]{24,}/g },
];

const excludedFiles = new Set([
  "package-lock.json",
]);

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((file) => existsSync(file))
    .filter((file) => !excludedFiles.has(file));
}

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function redact(match: string): string {
  if (match.length <= 12) return "[redacted]";
  return `${match.slice(0, 6)}...${match.slice(-4)}`;
}

const findings: string[] = [];

for (const file of trackedFiles()) {
  const content = readFileSync(file, "utf8");
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of content.matchAll(rule.pattern)) {
      findings.push(`${file}:${lineNumber(content, match.index ?? 0)} ${rule.name} ${redact(match[0])}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secrets found:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("No high-confidence secrets found.");
