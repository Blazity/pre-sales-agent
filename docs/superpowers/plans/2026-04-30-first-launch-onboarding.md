# First Launch Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deploy-first first-launch path that guides OSS adopters from Vercel deployment to a successful Slack-driven estimation.

**Architecture:** Keep human guidance in `docs/first-launch.md`, agent guidance in `.ai/skills/first-launch/SKILL.md`, and machine checks in a small doctor module plus CLI. The doctor core is pure and tested; the CLI performs optional network checks only when credentials are available.

**Tech Stack:** TypeScript ESM, Node 20 fetch, `node:test`, Markdown docs, local `.ai` skill format.

---

### Task 1: Doctor Core

**Files:**
- Create: `src/onboarding/doctor.ts`
- Create: `src/onboarding/doctor.test.ts`

- [ ] Write tests for required env classification, deploy URL normalization, health payload validation, and grouped exit severity.
- [ ] Implement pure helpers and result types.
- [ ] Run `npx tsx --test src/onboarding/doctor.test.ts`.

### Task 2: Doctor CLI

**Files:**
- Create: `scripts/doctor-first-launch.ts`
- Modify: `package.json`

- [ ] Add `npm run doctor:first-launch`.
- [ ] Implement local checks for Node version and required env vars.
- [ ] Implement optional live checks for Vercel health, Google OAuth/Drive/templates, Slack auth, Pinecone, and Voyage.
- [ ] Print PASS/WARN/FAIL grouped output without secrets.

### Task 3: First Launch Guidance

**Files:**
- Create: `docs/first-launch.md`
- Create: `.ai/skills/first-launch/SKILL.md`
- Modify: `.ai/skills/README.md`

- [ ] Add deploy-first checklist.
- [ ] Add common failure triage.
- [ ] Add skill workflow with Path A and Path B.

### Task 4: Docs Wiring

**Files:**
- Modify: `README.md`
- Modify: `docs/setup.md`
- Modify: `docs/deployment/vercel.md`
- Modify: `docs/configuration.md`

- [ ] Change README Deploy Button to deploy the shell first instead of collecting all env vars upfront.
- [ ] Point users to `docs/first-launch.md`.
- [ ] Reposition `docs/setup.md` as provider reference.
- [ ] Mention `doctor:first-launch` in deployment/configuration docs.

### Task 5: Verification

**Files:**
- Repository-wide checks

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run scan:secrets`.
- [ ] Run `npm run check:mcp-isolation`.
- [ ] Run `npm run audit:high`.
- [ ] Run `git diff --check`.
