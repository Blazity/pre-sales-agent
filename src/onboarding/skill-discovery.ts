export interface SkillLink {
  path: string;
  target: string;
}

export const expectedSkillLinks: SkillLink[] = [
  { path: ".claude/skills", target: "../.ai/skills" },
  { path: ".agents/skills", target: "../.ai/skills" },
  { path: ".cursor/skills", target: "../.ai/skills" },
];

export function findSkillDiscoveryProblems(entries: Record<string, string>): string[] {
  const problems: string[] = [];

  if (!Object.keys(entries).some((entry) => entry.startsWith(".ai/skills/") && entry.endsWith("/SKILL.md"))) {
    problems.push(".ai/skills must contain at least one SKILL.md");
  }

  for (const link of expectedSkillLinks) {
    if (entries[link.path] !== link.target) {
      problems.push(`${link.path} must point to ${link.target}`);
    }
  }

  return problems;
}
