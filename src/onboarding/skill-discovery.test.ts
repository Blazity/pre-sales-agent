import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedSkillLinks,
  findSkillDiscoveryProblems,
} from "./skill-discovery.js";

test("expectedSkillLinks uses ai-harness discovery targets", () => {
  assert.deepEqual(expectedSkillLinks, [
    { path: ".claude/skills", target: "../.ai/skills" },
    { path: ".agents/skills", target: "../.ai/skills" },
    { path: ".cursor/skills", target: "../.ai/skills" },
  ]);
});

test("findSkillDiscoveryProblems passes for valid symlinks", () => {
  const problems = findSkillDiscoveryProblems({
    ".ai/skills/first-launch/SKILL.md": "file",
    ".claude/skills": "../.ai/skills",
    ".agents/skills": "../.ai/skills",
    ".cursor/skills": "../.ai/skills",
  });

  assert.deepEqual(problems, []);
});

test("findSkillDiscoveryProblems fails when a harness link is missing", () => {
  const problems = findSkillDiscoveryProblems({
    ".ai/skills/first-launch/SKILL.md": "file",
    ".claude/skills": "../.ai/skills",
    ".agents/skills": "../.ai/skills",
  });

  assert.deepEqual(problems, [".cursor/skills must point to ../.ai/skills"]);
});
