# Codex PR Review Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add automated Codex Cloud PR reviews that block merge on `master`, using the existing code-review checklist via AGENTS.md.

**Architecture:** A GitHub Actions workflow triggers `@codex review` on every non-draft PR. Codex Cloud reads `AGENTS.md` at repo root, which references the existing `.ai/skills/code-review/` skill and checklist. Branch protection on `master` requires Codex approval.

**Tech Stack:** GitHub Actions, Codex Cloud GitHub App, AGENTS.md

---

### Task 1: Create AGENTS.md

**Files:**
- Create: `AGENTS.md`

**Step 1: Create the file**

`AGENTS.md` at repo root:

```markdown
# Estimation Agent — Codex Review Guidelines

## Review Process

Follow the code review workflow defined in `.ai/skills/code-review/SKILL.md`.
Use the checklist at `.ai/skills/code-review/references/checklist.md`.

Run every check in the workflow:
1. Scope — identify all changed files
2. MCP isolation gate — verify no MCP server imports from `src/`
3. Checklist — run through every item in `references/checklist.md`
4. TypeScript gate — `npx tsc --noEmit` must pass
5. Test gate — `npm test` must pass
6. Lessons check — does this change risk any pitfall in `.ai/lessons.md`?
7. Output — list findings by severity

## Severity Levels

- **Critical** — Security vulnerabilities, data loss risks, MCP isolation violations. Must fix before merge.
- **High** — Architecture violations, broken orchestrator pipeline, wrong Pinecone config. Must fix before merge.
- **Medium** — Convention violations, missing error handling. Should fix.
- **Low** — Style, naming. Optional.

**Request changes** for Critical and High findings only. Medium and Low are comments.

## Key Rules

- MCP servers in `src/mcp-servers/` must NEVER import from `src/`. Each is a standalone stdio process with its own `dotenv/config`.
- The orchestrator `TOOL_TO_STEP` map and `allowedTools` array must stay in sync with MCP tool names.
- Google Doc template `{{PLACEHOLDER}}` tokens must match between the template and orchestrator prompt.
- Pinecone is locked to `voyage-3` (1024-dim, cosine). Changing the model requires full re-index.
- Never commit secrets (.env, credentials, API keys).
```

**Step 2: Verify the file references are correct**

Confirm these paths exist:
- `.ai/skills/code-review/SKILL.md`
- `.ai/skills/code-review/references/checklist.md`
- `.ai/lessons.md`

**Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "feat(codex-review): add AGENTS.md for Codex PR review guidelines"
```

---

### Task 2: Create GitHub Actions workflow

**Files:**
- Create: `.github/workflows/codex-review.yml`

**Step 1: Create the directory**

```bash
mkdir -p .github/workflows
```

**Step 2: Create the workflow file**

`.github/workflows/codex-review.yml`:

```yaml
name: Codex PR Review

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

concurrency:
  group: codex-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  trigger-review:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - name: Trigger Codex review
        env:
          GH_TOKEN: ${{ secrets.CODEX_TRIGGER_TOKEN }}
        run: |
          gh pr comment ${{ github.event.pull_request.number }} \
            --repo ${{ github.repository }} \
            --body "@codex review"
```

**Step 3: Commit**

```bash
git add .github/workflows/codex-review.yml
git commit -m "feat(codex-review): add GitHub Actions workflow to trigger Codex on PRs"
```

---

### Task 3: Update CLAUDE.md and lessons

**Files:**
- Modify: `CLAUDE.md:51`
- Modify: `.ai/lessons.md` (append)

**Step 1: Update Development Workflow step 7**

In `CLAUDE.md`, change line 51 from:

```
7. **Review** — run code review (`.ai/skills/code-review`), fix Critical/Important issues
```

To:

```
7. **Review** — Codex reviews the PR automatically using `.ai/skills/code-review` checklist. Fix Critical/High issues before merge.
```

**Step 2: Add lesson to `.ai/lessons.md`**

Append to the file:

```markdown
---

### Codex reviews every PR before merge

**Context:** Codex Cloud is configured as an automated PR reviewer via GitHub Actions + AGENTS.md.
**Problem:** Merging without Codex review bypasses the quality gate.
**Rule:** Every PR to `master` must have Codex approval. The GitHub Action triggers `@codex review` automatically. AGENTS.md points Codex to `.ai/skills/code-review/` — do NOT duplicate the checklist.
**Recovery:** If Codex doesn't review, check that the GitHub App is installed and "Code review" is enabled in Codex settings. Manually comment `@codex review` on the PR.
**Applies to:** All pull requests to `master`.
```

**Step 3: Type-check (sanity)**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add CLAUDE.md .ai/lessons.md
git commit -m "feat(codex-review): update dev workflow and lessons for Codex reviews"
```

---

### Task 4: Manual setup steps (not code — do these in browser)

These steps must be done manually by the repo owner. They are NOT automated.

**Step 1: Connect Codex Cloud to GitHub**

1. Go to [codex.openai.com](https://codex.openai.com)
2. Connect your GitHub account
3. Enable the `estimation-agent` repo
4. Toggle **Code review** for the repo

**Step 2: Configure branch protection**

1. Go to GitHub repo → Settings → Branches
2. Add branch protection rule for `master`:
   - Check "Require a pull request before merging"
   - Check "Require approvals" (set to 1)
   - Codex Cloud's GitHub App review will count as the required approval

**Step 3: Test the integration**

1. Create a test branch with a small change
2. Open a PR to `master`
3. Verify the GitHub Action runs and posts `@codex review`
4. Verify Codex picks up the comment and posts a review
5. Close the test PR

**Step 4: Update spec status**

In `.ai/specs/README.md`, change SPEC-023 status to "Implemented".
In `.ai/specs/SPEC-023-codex-pr-review.md`, check off completed items.

```bash
git add .ai/specs/
git commit -m "feat(codex-review): mark SPEC-023 implemented"
```
