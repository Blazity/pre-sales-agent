# SPEC-043: Vercel Ash Rebuild — New Repository, Parallel Cutover

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the Slack RFP estimation agent on Vercel using the Ash agent framework (`experimental-ash`) and Vercel Sandbox, replacing the Express + Slack Bolt + BullMQ + MCP-stdio + Railway stack. Production stays on Railway throughout the rebuild and cuts over only after eval parity is reached.

**Architecture:** Authored Ash app (`agent/` filesystem-conventional layout) with in-process tools, native Slack channel adapter, durable sessions, hybrid pipeline (skills for Analysis / Clarification / Value Discovery + subagent for Offer), Anthropic Claude via Vercel AI Gateway, Pinecone shared with the legacy bot, Vercel Sandbox for compute, OpenTelemetry for traces, eval suite gating cutover.

**Tech Stack:** `experimental-ash@0.3.0-alpha.26`, `@ai-sdk/anthropic`, `@vercel/sandbox`, `@vercel/otel`, Pinecone, Voyage `voyage-3`, Google Workspace APIs, Slack Web API, Vercel.

**Status:** Planning
**Date:** 2026-04-29
**Scope:** New repository — `Blazity/estimation-agent-ash`. Legacy repo `Blazity/estimation-agent` remains untouched in production until cutover.

---

## Why

The current agent has accumulated friction on every dimension we care about:

- **`wait_for_reply` 15-min Slack poll** (slack-interaction MCP) carries ongoing OOM risk on small Railway plans. Up to 12 simultaneous MCP processes per worker. See `.ai/lessons.md` → "wait_for_reply blocks agent turns".
- **Railway SIGTERM kills in-flight jobs** despite `lockDuration: 120s`, `maxStalledCount: 2`. Every deploy during an active estimation risks a permanent stall. See `.ai/lessons.md` → "Deploy during active job causes stall/permanent failure".
- **MCP stdio child processes** (4 per job) add IPC overhead, complicate logging, and require duplicated `dotenv/config` + helpers per server (`.ai/lessons.md` → "MCP servers must never import from `src/`").
- **Custom orchestration plumbing** — `TOOL_TO_STEP` map, `job-registry`, `job-logger`, `STEP_NAMES`, BullMQ wiring — all reinvent things Ash gives us natively (sessions, turn lifecycle events, OpenTelemetry traces).
- **Context pressure** required two full SPECs (SPEC-032, SPEC-035) to manage; Ash has compaction built in.
- **No eval harness** — every estimation-quality regression (SPEC-021, SPEC-029, SPEC-031, SPEC-039, SPEC-042) was caught in production. Ash ships `defineEvalSuite` + `ash eval` + Braintrust reporter.
- **Channel attachment asymmetry** (SPEC-035 + SPEC-041) was a class of bug; Ash's `attachments.resolve` makes upload paths symmetric by construction.

Ash subsumes ~60% of the current codebase (queue, worker, Express, Bolt, slack-interaction MCP, job-registry, job-logger) directly. The remaining 40% (Pinecone helpers, Google Workspace API, PDF/DOCX extract, sheet parsing, brand profile, estimation rules) ports cleanly into `agent/tools/`, `agent/lib/`, and `agent/system/`.

## What stays the same

- **Slack is and remains the only user-facing surface.** No web UI. No Chat SDK adoption.
- **Anthropic Claude.** Provider stays Claude (`claude-opus-4-7`). All ~12 SPECs of estimation-quality calibration carry forward.
- **Pinecone index** (locked to `voyage-3`, 1024-dim, cosine) is shared between legacy and rebuild bots. The legacy bot continues to seed; the rebuild reads.
- **Google Workspace** — same OAuth refresh token, same Drive folder IDs, same `{{PLACEHOLDER}}` template tokens.
- **Estimation rules** — rate card, AI productivity factor, complexity tiers, team sizing, page budgets, output discipline. Ported verbatim into `agent/system/` always-on layers.

## What changes

| Layer | Legacy | Rebuild |
|---|---|---|
| Agent runtime | Claude Agent SDK + manual orchestrator loop | Ash `defineAgent({ model: "anthropic/claude-opus-4-7" })` |
| Tooling | 4 MCP stdio child processes | In-process `agent/tools/<name>.ts` (Zod) |
| Slack | Express + Bolt + `wait_for_reply` poll | Ash `defineSlackAdapter` + `ask_question` |
| Pipeline | 4 stages enforced via `TOOL_TO_STEP` | Hybrid: skills for stages 1–3, subagent for Offer |
| Job queue | BullMQ + Redis + custom `job-registry` | Ash durable sessions (no external queue) |
| State | Redis hashes per job | Ash session storage + `ContextKey` |
| Channel attachments | `file-ingestion.ts` + Drive copy + manifest | `attachments.resolve(ref, ctx)` materializes into sandbox |
| Hosting | Railway (Docker) | Vercel (`ash build` → `.vercel/output`) |
| Sandbox | Local fs in worker container | Vercel Sandbox (`vercelBackend()`) |
| Provider gateway | Direct Anthropic API | Anthropic via Vercel AI Gateway (caching + retries + obs) |
| Telemetry | Bespoke `job-logger` JSON files | OpenTelemetry via `@vercel/otel` |
| Evals | None | `evals/*.eval.ts` via `ash eval` |
| Cron | Manual `npm run seed` | `agent/schedules/seed-knowledge-base.md` |
| Admin panel | Custom Next.js dashboard at `/admin` | Skipped — `ash dev` REPL + Vercel Logs cover ops |

## Authored Layout

```text
estimation-agent-ash/
├── agent/
│   ├── agent.ts                                   # defineAgent, model, compaction
│   ├── instrumentation.ts                         # @vercel/otel + (optional) Braintrust
│   ├── system.md                                  # core identity + sequencing rule
│   ├── system/
│   │   ├── 10-security-input-boundary.md          # boundary tags, never-reveal rules
│   │   ├── 20-brand-voice.md                      # Blazity tone, page budgets, formatting
│   │   ├── 30-estimation-rules.md                 # rate card, AI factor, complexity tiers, team sizing
│   │   └── 40-output-discipline.md                # anti-hallucination, scope-boundary, never-guess-pricing
│   ├── skills/
│   │   ├── analysis.md                            # KB + figma + web research procedure
│   │   ├── clarification.md                       # ask_question patterns, max rounds
│   │   └── value-discovery.md                     # client research, conditional on complexity
│   ├── tools/
│   │   ├── search_past_estimations.ts             # Pinecone (legacy MCP knowledge-base port)
│   │   ├── search_past_proposals.ts
│   │   ├── search_case_studies.ts
│   │   ├── get_figma_data.ts                      # legacy MCP figma port (or connection to figma-developer-mcp)
│   │   ├── download_figma_images.ts
│   │   ├── fetch_web_page.ts                      # wraps framework web_fetch with our truncation
│   │   └── web_search.ts                          # Brave-backed (or framework default)
│   ├── lib/
│   │   ├── pinecone.ts                            # Pinecone client + Voyage embeddings
│   │   ├── google-auth.ts                         # OAuth refresh-token cache
│   │   ├── pdf-extract.ts                         # ported as-is from legacy
│   │   ├── docx-extract.ts                        # ported as-is from legacy
│   │   ├── sheet-parser.ts                        # ported as-is from legacy
│   │   └── shared-prompts/                        # markdown blocks shared between root & offer subagent
│   ├── channels/
│   │   └── slack.ts                               # defineSlackAdapter, attachments.resolve, lifecycle handlers
│   ├── sandbox/
│   │   └── sandbox.ts                             # defaultBackend(), allow-all network policy initially
│   ├── schedules/
│   │   └── seed-knowledge-base.md                 # cron: re-index Drive folders weekly
│   └── subagents/
│       └── offer/
│           ├── subagent.ts                        # narrow input schema
│           ├── system.md                          # offer-specific rules; imports shared estimation-rules
│           ├── tools/
│           │   ├── docs_copy_template.ts
│           │   ├── docs_write_sections.ts
│           │   ├── docs_find_and_replace.ts
│           │   └── sheets_create_estimation.ts
│           └── lib/
│               └── google-workspace.ts            # Docs + Sheets API wrappers (legacy MCP port)
├── evals/
│   ├── smoke.eval.ts                              # one archived RFP → expects offer doc with 7 sections
│   ├── estimation-quality.eval.ts                 # pricing-bounds checks against past estimates
│   └── data/                                      # archived RFPs replayed against the rebuild
├── README.md
├── AGENTS.md
├── package.json
├── tsconfig.json
└── pnpm-lock.yaml
```

## Decisions Locked

| Decision | Choice | Rationale |
|---|---|---|
| Provider | Anthropic Claude (`claude-opus-4-7`) | Preserves ~12 SPECs of estimation-quality calibration |
| Provider routing | Vercel AI Gateway (`"anthropic/claude-opus-4-7"` string-form model) | Caching for the large stable system prompt + retries + observability |
| Repo strategy | New repo `Blazity/estimation-agent-ash`, parallel run | Zero risk to legacy production |
| Pipeline structure | Hybrid: skills for Analysis / Clarification / Value Discovery; subagent for Offer | Tightens tool isolation around the high-stakes Offer step (the source of every quality regression) |
| User surface | Slack only (no web UI, no Chat SDK) | Confirmed — Slack is the team's working surface |
| Compaction threshold | 0.85 (override of Ash default 0.9) | More headroom for long offer-doc generation |
| Sandbox backend | `defaultBackend()` (auto-resolves Vercel in prod, local in dev) | Standard Ash deployment pattern |
| Sandbox network policy | `allow-all` initially | Six provider hosts (Anthropic, Pinecone, Voyage, Google, Slack, Brave) — tightening can wait until cutover |
| MCP `connections/` | Not used | Our legacy "MCP servers" are internal — they become in-process tools, not external connections |
| Admin panel | Skipped | `ash dev` REPL + Vercel Logs + OTel traces cover ops needs |
| Telemetry | `@vercel/otel` → Vercel Logs default; Braintrust exporter optional | Free baseline, easy to add Braintrust later |
| Evals | In scope, mandatory before cutover | Catches the regression class that produced SPEC-021, SPEC-029, SPEC-031, SPEC-039, SPEC-042 |

## Risks Tracked

1. **`experimental-ash` is alpha** (`0.3.0-alpha.26` at scaffold time) — pin the version; review the changelog before each `pnpm update`; expect API churn.
2. **Long-running tool calls** — Pinecone + Voyage + Google APIs + web search inside one turn step. Vercel Sandbox per-turn time limits must be validated in Phase 0 with a real run.
3. **AI Gateway availability** — `"anthropic/..."` string model routes through the gateway; without `AI_GATEWAY_API_KEY` set, runtime fails. Alternative: revert to `@ai-sdk/anthropic` provider instance (already in `package.json`).
4. **Sandbox network policy** — every external host the agent talks to must be reachable from the sandbox. Validate in Phase 0; tighten only at cutover.
5. **Slack 3-second ack** — Vercel cold starts can violate Slack's 3s ack window. The Ash Slack adapter pattern is "ack-then-process" (matching Bolt today). Verify in Phase 2.
6. **Dual-stack period** — Two bots running against the same Pinecone index, same Google Drive folders, same Slack workspace. Drive folder split + distinct Slack bot identity prevent collisions. Operational details in Phase 5.
7. **Lessons replication** — every entry in `.ai/lessons.md` is a guardrail earned with pain. Each must have a forward path: deleted by framework, encoded in `system/`, encoded as test, or encoded as eval. Tracked as a Phase 1 checklist.
8. **Codex review setup** — new repo's `AGENTS.md` differs from legacy. Codex Cloud must be configured against the new repo before Phase 5.
9. **Node version** — Ash docs say Node 24.x; local dev machines may be on 25.x. Ash dev currently runs on 25.x (validated during scaffold). CI should pin 24.

---

## Phases

Each phase produces a single PR (or several small ones) and ends at a clear go/no-go gate. Phase tasks use `- [ ]` markers for resumable execution.

### Phase 0 — Spike (1–2 days)

Validate the riskiest assumptions before committing to the full rebuild.

- [x] Create new repo `Blazity/estimation-agent-ash` (private)
- [x] Scaffold via `pnpm dlx experimental-ash@latest init`
- [x] Configure Anthropic Claude provider (string-form `"anthropic/claude-opus-4-7"` for AI Gateway routing)
- [x] Initial commit + push to `main`
- [ ] Get an `AI_GATEWAY_API_KEY` provisioned for Blazity Vercel team; deploy a stub agent that successfully completes one turn against Claude
- [ ] Build a single tool that searches Pinecone (port `search_past_estimations` from legacy MCP); confirm it returns real KB data when called via the agent
- [ ] Deploy stub agent to Vercel; confirm `vercelBackend()` sandbox boots; verify Pinecone + Anthropic both reachable from a deployed Sandbox turn
- [ ] Confirm `ash dev` REPL + remote URL workflow works for development against the deployed stub

**Go/no-go gate:** Can Ash run Claude + Pinecone + Vercel Sandbox end-to-end? If yes → Phase 1. If any "no", abort and reassess.

### Phase 1 — Tools port (1–2 weeks)

Port all four legacy MCP servers to in-process `agent/tools/`. Pure mechanical work; no UX or pipeline changes yet.

- [ ] Port `knowledge-base.ts` MCP → `agent/tools/search_past_estimations.ts`, `search_past_proposals.ts`, `search_case_studies.ts`. Share Pinecone client + Voyage embedding via `agent/lib/pinecone.ts`.
- [ ] Port `web-research.ts` MCP → `agent/tools/fetch_web_page.ts` (wraps Ash's framework `web_fetch` with our truncation rules) and `web_search.ts` (Brave-backed; or use framework `web_search` default if it covers our needs).
- [ ] Port `google-workspace.ts` MCP → `agent/subagents/offer/tools/docs_copy_template.ts`, `docs_write_sections.ts`, `docs_find_and_replace.ts`, `sheets_create_estimation.ts`. Share Google auth via `agent/subagents/offer/lib/google-workspace.ts`.
- [ ] Port figma MCP tools (currently optional, gated on `FIGMA_API_KEY`) → `agent/tools/get_figma_data.ts`, `download_figma_images.ts`. Decide: in-process port vs. `connections/figma.ts` MCP client. Recommend in-process for auth-token simplicity.
- [ ] Move shared helpers to `agent/lib/`: `pdf-extract.ts`, `docx-extract.ts`, `sheet-parser.ts`, `google-auth.ts`. These are import-only; not workspace-mounted.
- [ ] Replicate every `*.test.ts` from legacy MCP servers as Node `node:test` files; tests target the new in-process tools, not stdio harnesses. Run via `pnpm test`.
- [ ] Audit `.ai/lessons.md` and assign each entry a disposition (deleted-by-framework, encoded-in-system, encoded-as-test, encoded-as-eval). Track in `agent/lib/shared-prompts/lessons-disposition.md`.

**Gate:** All ported tools have green `node:test` parity tests against legacy outputs (where deterministic) or stub fixtures (where not).

### Phase 2 — Slack channel (1 week)

Replace Express + Bolt + `slack-interaction` MCP with the Ash Slack adapter.

- [ ] Author `agent/channels/slack.ts` with `defineSlackAdapter`. Use `slackUser()` auth for HMAC-verified Slack signing.
- [ ] Implement attachment resolver: `attachments.resolve(ref, ctx)` downloads Slack files using bot OAuth, materializes bytes into the sandbox, rewrites `FilePart.filename` to the sandbox path. Mirrors SPEC-035/SPEC-041 ingestion symmetry but provided by the framework.
- [ ] Wire lifecycle event handlers (`"step.started"`, `"subagent.called"`, `"subagent.completed"`, `"message.completed"`, `"session.failed"`) to `ctx.slack.editMessage(ts, renderable)` to preserve current "Step N — <name>" progress UX.
- [ ] Replace `wait_for_reply` flow entirely: clarification step uses framework `ask_question` tool. Slack adapter renders questions as Block Kit (buttons / select / freeform per `display` hint).
- [ ] Validate Slack 3-second ack on Vercel cold start. If violated, add ack-then-process pattern explicitly.
- [ ] Create new Slack app for the rebuild — distinct bot identity. **Operational TBD:** bot name, slash command (suggest `@estimation-v2` / `/estimate-v2`).
- [ ] End-to-end smoke: send a real RFP to the new Slack bot in a private channel; agent responds via the new Slack adapter; verify message-edit progress UX matches legacy.

**Gate:** Round-trip a real Slack message through the new adapter to a final agent response.

### Phase 3 — Pipeline restructure + system prompt port (2–3 weeks)

Move the 1000-line legacy system prompt into Ash's authored layout and split off the Offer subagent.

- [ ] Author `agent/system.md` — concise core identity + sequencing rule (Analysis → Clarification → Value Discovery → Offer).
- [ ] Author `agent/system/10-security-input-boundary.md` — boundary tags (`<user-rfp>`, `<user-message>`, `<user-clarification>`, `<user-file-manifest>`), never-reveal rules.
- [ ] Author `agent/system/20-brand-voice.md` — Blazity tone, page budgets, formatting.
- [ ] Author `agent/system/30-estimation-rules.md` — rate card (EUR/h), AI productivity factor (30–40% reduction), complexity tiers, team sizing, output discipline. **This is the load-bearing calibration content.** Port verbatim from legacy `orchestrator.ts`.
- [ ] Author `agent/system/40-output-discipline.md` — anti-hallucination, scope-boundary, never-guess-pricing.
- [ ] Author `agent/skills/analysis.md` — KB search procedure + figma + web research.
- [ ] Author `agent/skills/clarification.md` — when to ask, how to phrase, max rounds, `ask_question` patterns, assumption-cap rule (SPEC-033).
- [ ] Author `agent/skills/value-discovery.md` — client research procedure, conditional on complexity.
- [ ] Build `agent/subagents/offer/` — narrow input schema (brief + clarification answers + complexity tier + folder IDs), own `system.md` (imports shared estimation-rules markdown from `agent/lib/shared-prompts/`), own tools (Docs + Sheets), own sandbox. Cannot see KB / web / Slack tools.
- [ ] Author `agent/lib/shared-prompts/estimation-rules.md` and `agent/lib/shared-prompts/output-discipline.md` — single source of truth for rules referenced by both root `system/` layers and offer subagent's `system.md`. Imported via `parseMarkdownDocument()` at build time.
- [ ] Verify root agent's tool surface excludes Google Workspace tools (those are subagent-only). Verify Offer subagent's tool surface excludes KB / web / Slack tools.

**Gate:** Run a full estimation end-to-end through the new pipeline. Output Google Doc has all required sections. Estimation Sheet uses the 9-column format (SPEC-040). Eval suite (next phase) is the rigorous gate.

### Phase 4 — Schedules, telemetry, and evals (1 week)

Land the framework-native operational facilities.

- [ ] Author `agent/schedules/seed-knowledge-base.md` — weekly cron that re-indexes Drive folders into Pinecone. Replaces manual `npm run seed`.
- [ ] Author `agent/instrumentation.ts` — `@vercel/otel` + Vercel Logs by default; gated `Braintrust` exporter when `BRAINTRUST_API_KEY` is set.
- [ ] Author `evals/smoke.eval.ts` — one archived RFP, scorers `Run.didNotFail()` + `Run.usedTool("docs_write_sections")` + a custom scorer asserting the offer doc has all 7 required sections.
- [ ] Author `evals/estimation-quality.eval.ts` — pricing-bounds checks (final estimate falls within ±25% of the historical estimate for the same RFP), per-area MD bounds, AI-factor application check.
- [ ] Populate `evals/data/` with 5–10 archived RFPs from `past-estimates/` (already gitignored in legacy repo) and the curated estimation/proposal Drive folders. Convert to fixtures consumable by `loadYaml`.
- [ ] Run `ash eval --all` locally and on the deployed app; commit baseline thresholds to `evals/`.
- [ ] If Braintrust is adopted, add the reporter and configure project name `estimation-agent-ash`.

**Gate:** Full eval suite passes against the deployed Vercel app. Baseline thresholds locked.

### Phase 5 — Parallel deploy + cutover prep (1–2 weeks)

Run both bots side-by-side. Validate against real production traffic before flipping the switch.

- [ ] Deploy `Blazity/estimation-agent-ash` to a new Vercel project (suggest project name `estimation-agent-ash`).
- [ ] Provision env vars on Vercel: `AI_GATEWAY_API_KEY`, `PINECONE_API_KEY`, `VOYAGE_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GDRIVE_TEMPLATE_ID`, `GSHEETS_TEMPLATE_ID`, `GDRIVE_INPUT_FOLDER_ID` (or per-job equivalent), `SLACK_BOT_TOKEN` (new app), `SLACK_SIGNING_SECRET` (new app), `BRAVE_API_KEY` (optional), `FIGMA_API_KEY` (optional), `BRAINTRUST_API_KEY` (optional).
- [ ] **Operational TBD:** Drive folder split for parallel run. Decide: separate Output folder per bot for clean A/B, or shared folder.
- [ ] Install new Slack app to Blazity workspace; invite to a test channel; validate end-to-end in that channel only.
- [ ] Replay 5+ archived RFPs from `past-estimates/` through the new bot. Compare offers section-by-section against legacy outputs. Record diffs in a parallel-run log.
- [ ] Open up new bot to a small set of internal channels alongside the legacy bot. Monitor for 1 week.
- [ ] Resolve any Phase-1 lessons-disposition items that turned out to be wrong (move from `encoded-in-system` to `encoded-as-eval`, etc.).

**Gate:** New bot has produced offers indistinguishable in quality from the legacy bot on the eval set AND on parallel-run traffic for at least 1 week.

### Phase 6 — Cutover + decommission (2 days)

- [ ] Switch the primary `/estimate` Slack command to the new bot. Legacy bot's command renamed to `/estimate-legacy` (or removed entirely).
- [ ] Stop the legacy Railway service. Keep the codebase available for 30 days for any incident rollback.
- [ ] In legacy repo: archive notice in README pointing to the new repo.
- [ ] Remove BullMQ, Redis, Express, Bolt deps from legacy if anyone needs to maintain it; otherwise leave the codebase frozen.
- [ ] Update `.ai/lessons.md` in the new repo with any cutover lessons.

**Done.** New bot owns production.

---

## Operational Items (Resolved at Deploy, Not Designed Here)

| Item | Default proposal | Owner |
|---|---|---|
| New Slack app name | `@estimation-v2` | TBD |
| New Slack slash command | `/estimate-v2` | TBD |
| Drive Output folder during parallel run | Separate per-bot folder for clean A/B | TBD |
| Vercel project name | `estimation-agent-ash` | TBD |
| Vercel team | Blazity (existing) | TBD |
| Codex Cloud configuration on new repo | Mirror legacy setup, point at `AGENTS.md` | TBD |
| Braintrust project (if adopted) | `estimation-agent-ash` | TBD |

These are tracked as TBDs in the phase checklists; they don't block design and are resolved before the relevant phase's deploy step.

---

## Out of Scope

- Web chat UI / Chat SDK adoption (decision recorded in this brainstorm).
- Provider migration to OpenAI or any other model family.
- Replacing Pinecone with a different vector DB.
- Replacing the legacy admin panel (skipped; not rebuilt).
- Migrating estimation-rule calibration — it ports verbatim and stays the gold reference.
