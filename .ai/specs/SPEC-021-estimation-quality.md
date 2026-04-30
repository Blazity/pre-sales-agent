# SPEC-021: Estimation Quality & Voice Overhaul

**Status:** Done
**Date:** 2026-03-03

## Problem

Assessio estimation feedback revealed 6 systemic issues, all rooted in missing prompt guardrails:

1. **Price 3x too high** (€251k vs €89k target) — no rate card, no team size rules, no AI productivity factor
2. **Document too long** (19 pages) — generous word counts, no page budget
3. **Old tech recommended** (Next 13) — no instruction to verify latest stable versions
4. **Wrong vendor pricing** (Vercel) — no rule against guessing third-party costs
5. **Generic technical estimation** — role-level budget table, not feature-level breakdown
6. **Timeline too long** (10 weeks) — no hours÷capacity math, no AI factor

## Design

### Approach: Prompt surgery + self-validation

All changes are in `src/agents/orchestrator.ts` (the system prompt string). Two parts:

**Part A — Estimation Rules block** (add near top, after identity section):

#### Rate Card

| Role | Rate (EUR/h) |
|------|-------------|
| Architect | 120 |
| Senior Developer | 85 |
| Mid Developer | 75 |
| Designer | 80 |
| QA (manual) | 40 |

+10% PM overhead baked into total (not a separate line item).

#### Team Sizing (AI-augmented)

- Simple (<100k EUR): 1 senior/architect + AI agent. Add 1 mid only if scope demands parallel workstreams.
- Medium (100-200k EUR): 1 architect (part-time) + 1-2 seniors + 1 mid + designer.
- Complex (>200k EUR): 1 architect + 2-3 seniors + 1-2 mids + designer + QA.
- Never 2+ architects. Never staff "just in case."

#### Feature-Level Estimation

Replace role-level budget table with feature/module breakdown:

| Feature | Role | Hours | Cost (EUR) |
|---------|------|-------|-----------|
| CMS migration (content modeling + import) | Senior | 40 | 3,400 |
| i18n setup (5 locales) | Mid | 24 | 1,800 |
| ... | ... | ... | ... |
| **Subtotal** | | **X** | **€Y** |
| **PM overhead (10%)** | | | **€Z** |
| **Total** | | | **€Y+Z** |

Discovery team must be able to challenge individual line items.

#### AI Productivity Factor

After estimating hours conservatively, apply 30-40% reduction to development tasks (not discovery, design, or QA). State explicitly: "Hours reflect AI-augmented development workflow (est. 35% productivity gain)."

#### Page Budget

- Simple: 5-7 pages
- Medium: 8-10 pages
- Complex: 10-12 pages (never exceed 12)

Reduced section word counts:
- Company overview: 80-120 words (was 150-200)
- Discovery/Design: 100-200 words (was 200-300)
- Development: 150-250 words (was 200-400)
- Next Steps: 50-80 words (was 80-120)

#### Technology Versions

Always verify latest stable release via web search before recommending. Never use version numbers from training data.

#### Third-Party Pricing

Never guess vendor pricing.
1. Search for current pricing via web. If found, cite source URL.
2. If not found, ask clarifying questions in Step 2 about expected usage.
3. Last resort: leave `{{PRICE — verify at [vendor URL]}}` placeholder.

---

**Part B — Voice & Tone overhaul** (replace current one-liner):

Based on [Blazity brand guidelines](https://github.com/Blazity/marketing-team/blob/main/marketing/.ai/brand/guidelines.md) + Challenger Sale methodology.

Core voice: Senior Blazity engineer who's done this 40+ times — explaining a diagnosis to a VP of Engineering over coffee. Direct, confident, problem-aware, business-aware, anti-hype.

Challenger Sale approach:
- **Teach:** lead with an insight the client hasn't considered
- **Tailor:** every claim references THEIR specific situation from the RFP
- **Take control:** be prescriptive — "We recommend X because Y"

Anti-patterns (AI tells to avoid):
- Stacked parallel constructions
- Balanced rhetorical pivots in every section
- Triplet lists that escalate
- Em dash overuse (max 1 per paragraph)
- Every section ending with a business reframe

---

**Part C — Validation checklist extension** (add to existing 13-point review):

8 additional checks after writing the offer:
14. Rate card compliance
15. Team size matches complexity tier
16. Feature-level breakdown (not phase-level)
17. AI factor applied and stated
18. Page count within budget
19. Tech versions verified via web search
20. No guessed third-party pricing
21. Timeline matches hours÷capacity math

## Implementation Plan

- [x] **Task 1:** Add `ESTIMATION RULES` block to system prompt — rate card, team sizing, feature breakdown format, AI factor, page budget, tech versions, pricing rules
- [x] **Task 2:** Replace voice/tone section with Blazity brand voice + Challenger Sale approach + anti-patterns
- [x] **Task 3:** Replace role-level budget table instructions with feature-level format throughout the offer section
- [x] **Task 4:** Reduce section word counts to match page budget
- [x] **Task 5:** Add 8 validation checks (#14-21) to the review checklist
- [x] **Task 6:** Update Step 5 (presentation) slide content instructions to match new estimation format
- [x] **Task 7:** `npx tsc --noEmit` and `npm test`
- [x] **Task 8:** Add lesson to `.ai/lessons.md` about estimation calibration rules

## Files

- `src/agents/orchestrator.ts` — system prompt (all changes)
- `.ai/lessons.md` — new lesson entry
