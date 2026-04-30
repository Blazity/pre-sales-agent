# SPEC-023: Codex PR Review Integration

**Status:** Planning
**Date:** 2026-03-05

## Summary

Integrate OpenAI's Codex Cloud as an automated PR reviewer. A GitHub Actions workflow triggers `@codex review` on every PR. Codex reads `AGENTS.md` which references the existing `.ai/skills/code-review/` checklist (DRY — no duplication). Branch protection on `master` requires Codex approval before merge.

## Goals

- Every PR is reviewed by Codex before merge (blocking)
- Codex uses the same review checklist as the existing code-review skill
- Zero API key management — Codex Cloud handles auth
- Seamless — triggers automatically on PR open/update

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Review engine | Codex Cloud GitHub App | No API key needed, handles auth |
| Trigger | GitHub Action posts `@codex review` | Workflow control, can add gates later |
| Review guidelines | AGENTS.md → `.ai/skills/code-review/` | DRY, one source of truth |
| Blocking | Required review on `master` | Enforces quality gate |
| Gating | None — triggers immediately | Pre-commit hook catches type errors |
| Draft PRs | Skipped | No point reviewing drafts |

---

## Design

### 1. AGENTS.md (repo root)

References existing code-review skill and checklist. Gives Codex severity guidance:
- Critical/High → request changes (blocks merge)
- Medium/Low → comments only (advisory)

Key rules inlined: MCP isolation, orchestrator sync, placeholder tokens, Pinecone model lock, no secrets.

### 2. GitHub Actions Workflow

`.github/workflows/codex-review.yml`:
- Triggers on `pull_request` events: opened, reopened, synchronize, ready_for_review
- Skips draft PRs
- Concurrency group per PR number (cancels in-progress on new push)
- Single step: `gh pr comment` with `@codex review`
- Uses `CODEX_TRIGGER_TOKEN` (PAT) to comment as the repo owner — Codex only responds to reviews requested by authorized users, not `github-actions[bot]`

### 3. Branch Protection

Manual GitHub Settings config:
- Require PR reviews before merging on `master`
- Codex Cloud's review counts as required reviewer

### 4. CLAUDE.md Update

Step 7 updated from local code-review skill to Codex-based flow.

---

## One-Time Setup (Manual)

- [x] Connect GitHub account at codex.openai.com
- [x] Enable this repo in Codex settings
- [x] Toggle "Code review" for the repo
- [x] Create fine-grained PAT (resource owner: Blazity, repo: estimation-agent, scope: Pull requests Read/Write)
- [x] Add PAT as repo secret `CODEX_TRIGGER_TOKEN`
- [x] GitHub Settings → Branches → Branch protection rule for `master`:
  - Require PR before merging (no approval count — the agentic loop enforces quality)

## Implementation Plan

- [ ] Create `AGENTS.md` at repo root
- [ ] Create `.github/workflows/codex-review.yml`
- [ ] Update CLAUDE.md step 7 (Development Workflow)
- [ ] Update `.ai/lessons.md` with Codex review lesson
- [ ] Type-check and test
- [ ] Commit and push
