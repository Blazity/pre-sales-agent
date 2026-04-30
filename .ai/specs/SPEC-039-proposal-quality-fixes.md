# SPEC-039: Proposal Quality Fixes — Content, Pricing & Calibration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 9 proposal document issues: partner/client confusion, link formatting, section relevance, integration verbosity, investment clarity, performance partnership readability, missing RFP coverage, and pricing overshoot from inflated per-item effort.

**Architecture:** Targeted edits to the orchestrator system prompt + new effort calibration benchmarks. All changes are in the template literal string inside `runEstimation()`. No logic changes, no new files.

**Tech Stack:** `src/agents/orchestrator.ts` (system prompt text only).

**Status:** Implemented
**Date:** 2026-03-16
**Scope:** `src/agents/orchestrator.ts`

---

## Issues Addressed

1. Vercel listed as client — it's a partner, never a client
2. Link formatting (`[text](url)`) looks wrong in Google Docs — use plain URLs
3. "Our clients" should be "Similar projects" showing only relevant work
4. "Our partners" should only show partners relevant to the offer, or skip
5. Integrations section too detailed — needs executive summary + concise bullets
6. Investment section: remove AI percentages, remove hallucinated post-launch support, exclude external tooling unless client confirmed it's on Blazity
7. Performance partnership too academic — plain conversational language
8. Agent ignores RFP requirements not in its template — must ask during clarification
9. Pricing overshoot (~32%) from inflated per-item effort and ungrouped items

---

## Plan

All edits target: `src/agents/orchestrator.ts`

### Task 1: Fix Company Identity — separate partners from clients

**Files:**
- Modify: `src/agents/orchestrator.ts` (lines 196-200)

**Step 1: Replace the Key credentials block**

Find (lines 196-200):
```
Key credentials:
- Official Vercel partner
- Deloitte Technology Fast 50 Central Europe (2023 & 2024)
- Clients include Vercel, Tom Tailor, Solana, Contentful, CookUnity, Planday, Encoura
- Open source: next-enterprise (7.3K+ GitHub stars), enterprise-commerce, next-saas-starter
```

Replace with:
```
Key credentials:
- Deloitte Technology Fast 50 Central Europe (2023 & 2024)
- Open source: next-enterprise (7.3K+ GitHub stars), enterprise-commerce, next-saas-starter

Partners: Vercel, Contentful
Clients: Tom Tailor, Solana, CookUnity, Planday, Encoura

Partners are NOT clients. NEVER list a partner in the similar projects section.
NEVER use a partner name as a client reference or case study subject.
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit (0)

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-quality): separate partners from clients in company identity"
```

---

### Task 2: Fix About Us section — partners, similar projects, links

**Files:**
- Modify: `src/agents/orchestrator.ts` (lines 635-639)

**Step 1: Replace the About Us section instructions**

Find (lines 635-639):
```
   a. heading level 1: "About Us"
      - heading level 2: "Company overview" + paragraph (1-2 paragraphs: intro, key facts with ✅ bullets)
      - heading level 2: "Our partners" + paragraph (Vercel, Contentful, etc. — 1-2 sentences)
      - heading level 2: "Our clients" + numbered_list (3 past clients, 1 sentence each + case study link)
      - heading level 2: "Relevant links" + numbered_list (website, Clutch, GitHub)
```

Replace with:
```
   a. heading level 1: "About Us"
      - heading level 2: "Company overview" + paragraph (1-2 paragraphs: intro, key facts with ✅ bullets)
      - heading level 2: "Our partners" + paragraph
        List ONLY partners relevant to the offer's tech stack
        (e.g., Vercel for Next.js projects, Contentful for CMS/headless projects).
        One sentence per partner explaining the relevance.
        If no partner is relevant to THIS project's stack, skip this subsection entirely.
      - heading level 2: "Similar projects" + numbered_list
        Search past case studies and proposals for 2-3 projects similar to THIS RFP
        (by industry, tech stack, or scope type). For each: project name, one sentence
        on what we delivered and the measurable result.
        NEVER list partners (Vercel, Contentful) as projects.
        If no similar projects found, list 2-3 strongest client references instead.
      - heading level 2: "Relevant links" + numbered_list
        Format as plain URLs: "Website - https://blazity.com"
        NOT as markdown links: "[blazity.com](https://blazity.com)"
        Include: Website, Clutch, GitHub
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit (0)

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-quality): rename clients to similar projects, fix link format"
```

---

### Task 3: Add Integrations subsection to Project Approach

**Files:**
- Modify: `src/agents/orchestrator.ts` (line 650)

**Step 1: Add Integrations after Core tools**

Find (line 650):
```
      - heading level 2: "Core tools and their roles" + bullet_list (Slack, Google Drive, Jira, GitHub, Figma)
```

Replace with:
```
      - heading level 2: "Core tools and their roles" + bullet_list (Slack, Google Drive, Jira, GitHub, Figma)
      - heading level 2: "Integrations" (ONLY if project has 3rd party integrations)
        + paragraph: 1-2 sentence executive summary of the project's integration landscape.
        + bullet_list: one bullet per integration tool.
          Format: **Tool name** — one sentence on why it fits and how we use it.
          Keep concise. Do NOT explain implementation details (iframe vs JS component,
          API versions, authentication flows, embed methods).
          Only list integrations specific to THIS project — not generic dev tools.
          If the project has no meaningful 3rd party integrations, skip this subsection entirely.
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit (0)

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-quality): add concise integrations subsection"
```

---

### Task 4: Fix Investment section

**Files:**
- Modify: `src/agents/orchestrator.ts` (lines 679-686)

**Step 1: Replace Investment paragraph instruction**

Find (lines 679-686):
```
      - heading level 2: "Investment"
        + paragraph (60-80 words):
          State the grand total fixed-price investment in EUR and total man-days.
          Include: "Estimate reflects AI-augmented development workflow."
          Mention that all phases (discovery through launch and post-launch stabilization) are included.
          If notable infrastructure or licensing costs exist, mention them inline.
          Do NOT list per-area costs, per-item costs, hourly rates, or rate card details.
          The detailed breakdown is in the estimation spreadsheet (internal use only).
```

Replace with:
```
      - heading level 2: "Investment"
        + paragraph (60-80 words):
          State the grand total fixed-price investment in EUR and total man-days.
          Include: "Our development workflow is AI-native, which is reflected in the efficiency of this estimate."
          Mention that all phases from discovery through launch and stabilization are included.
          Do NOT mention exact AI productivity percentages or reduction factors.
          Do NOT mention post-launch support windows (e.g., "30-day support window", "post-launch support period") — we do not offer that as part of the project price.
          Do NOT include external tooling, hosting, or 3rd party service costs in the price unless the client explicitly confirmed during clarification that those costs are on Blazity.
          No per-area costs, per-item costs, hourly rates, or rate card details.
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit (0)

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-quality): fix investment section — remove AI %, add tooling guard"
```

---

### Task 5: Add third-party costs to clarification knowledge areas

**Files:**
- Modify: `src/agents/orchestrator.ts` (line 435)

**Step 1: Add knowledge area J after I**

Find (line 435):
```
  I. Team & process — client team involvement, review/approval cadence, stakeholders
```

Replace with:
```
  I. Team & process — client team involvement, review/approval cadence, stakeholders
  J. Third-party costs — who pays for hosting, external tooling, and 3rd party services
     (e.g., CMS licenses, analytics tools, monitoring, domain)? Always ask if unclear.
     If on the client, exclude from investment.
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit (0)

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-quality): add 3rd party cost question to clarification"
```

---

### Task 6: Add RFP Coverage Rule to clarification

**Files:**
- Modify: `src/agents/orchestrator.ts` (after line 440, after SCOPE BOUNDARY RULE)

**Step 1: Add RFP COVERAGE RULE**

Find (lines 437-441):
```
SCOPE BOUNDARY RULE: If the client states something is out of scope, mark it as OUT OF SCOPE
in your notes. Do NOT include it in estimation or offer. If the client explicitly addresses a
topic (e.g., "we use Cal.com, pricing is $X"), that topic is NOT an assumption — record the
client's answer as a fact.

ROUND LOOP — repeat for round = 1..5:
```

Replace with:
```
SCOPE BOUNDARY RULE: If the client states something is out of scope, mark it as OUT OF SCOPE
in your notes. Do NOT include it in estimation or offer. If the client explicitly addresses a
topic (e.g., "we use Cal.com, pricing is $X"), that topic is NOT an assumption — record the
client's answer as a fact.

RFP COVERAGE RULE: After analyzing the RFP in Step 1, identify ALL topics the client
specifically asks to be addressed in proposals (e.g., team structure, meeting cadence,
reporting format, performance benchmarks, SLAs, compliance certifications).
If your standard offer template does not have a dedicated section for a topic the RFP
explicitly requests:
- ASK about it during clarification: "Your RFP asks about [topic]. How would you like
  us to address this — should we include it in our proposal, or is it informational only?"
- NEVER silently ignore an explicit RFP requirement.
- If the client confirms they want it addressed, add it as a subsection in the most
  relevant part of the offer (usually Project Approach).

ROUND LOOP — repeat for round = 1..5:
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit (0)

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-quality): add RFP coverage rule to clarification step"
```

---

### Task 7: Rewrite Performance Partnership section

**Files:**
- Modify: `src/agents/orchestrator.ts` (lines 697-728)

**Step 1: Replace the three complexity tiers**

Find (lines 697-728):
```
      Scale this section to the project's complexity tier:

      IF SIMPLE project (< 30 MD total):
        + paragraph: 3-4 sentences explaining the concept:
          - Fixed delivery fee (€X) + performance bonus pool (€Y = 20% of base fee)
          - Blazity puts meaningful compensation at stake on measurable outcomes
          - Reference 1-2 specific, measurable outcomes relevant to THIS project
          - State the ROI multiplier if Value Projection data is available
          Total: ~100 words, ~1/3 page.

      IF MEDIUM project (30-80 MD total):
        + paragraph: Value opportunity framing (2-3 sentences referencing client pain points)
        + table: Approach Comparison (Fixed-Price vs Performance Partnership)
          3 rows: Investment, Risk Allocation, Expected ROI
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
        + paragraph: Investment breakdown — base fee €X, bonus pool €Y (20%), total €Z, ROI [N]×
        Total: ~200 words, ~1/2 page.

      IF COMPLEX project (> 80 MD total):
        + heading level 2: "Business Impact Analysis"
          paragraph + Value Projection table (3-5 rows with cited sources) + competitor analysis paragraph
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB",
          totalRowBackground "#FD6027", totalRowTextColor "#FFFFFF"
        + heading level 2: "Investment Structure"
          Approach Comparison table (5 rows) + investment breakdown paragraph
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
        + heading level 2: "Success Metrics & Bonus Structure"
          KPI table (3-5 rows) + assessment paragraph
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
        + heading level 2: "Why Performance Partnership"
          3-4 sentences on incentive alignment, shared risk, quality focus
        Total: ~400 words, 1-1.5 pages.
```

Replace with:
```
      Scale this section to the project's complexity tier.
      Use plain, conversational language — NOT academic or formal.
      Keep the bonus calculation logic internal. The client sees the numbers, not the formula.

      IF SIMPLE project (< 30 MD total):
        + paragraph (3-4 sentences, conversational):
          State the fixed price. Then: "We'll put money where our mouth is —
          if [1-2 specific measurable outcomes for this project], you pay us
          a bonus of €Y on top. If we miss, you keep the bonus."
          No ROI formulas, no percentage-of-base-fee math, no multipliers in the text.
          Total: ~80 words.

      IF MEDIUM project (30-80 MD total):
        + paragraph: Conversational framing. "Here's the deal:" tone.
          State what's at stake in plain terms.
        + table: Approach Comparison (Fixed-Price vs Performance Partnership)
          3 rows: Investment, Risk Allocation, Expected ROI
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
        + paragraph: "Bottom line: €X for the project. Up to €Y extra if we
          nail [specific targets]. You decide if the results justify it."
        Total: ~150 words.

      IF COMPLEX project (> 80 MD total):
        + paragraph: Plain-language TL;DR (3-4 sentences, same conversational tone as SIMPLE).
          Summarize the proposition before the detailed analysis.
        + heading level 2: "Business Impact Analysis"
          paragraph + Value Projection table (3-5 rows with cited sources) + competitor analysis paragraph
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB",
          totalRowBackground "#FD6027", totalRowTextColor "#FFFFFF"
        + heading level 2: "Investment Structure"
          Approach Comparison table (5 rows) + investment breakdown paragraph
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
        + heading level 2: "Success Metrics & Bonus Structure"
          KPI table (3-5 rows) + assessment paragraph
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
        + heading level 2: "Why Performance Partnership"
          3-4 sentences on incentive alignment, shared risk, quality focus
        Total: ~350-400 words, 1-1.5 pages.
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit (0)

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-quality): rewrite performance partnership in plain language"
```

---

### Task 8: Add Effort Calibration Benchmarks

**Files:**
- Modify: `src/agents/orchestrator.ts` (after line 265, after AI Productivity Factor)

**Step 1: Add calibration section**

Find (lines 264-266):
```
AI Productivity Factor:
After estimating hours conservatively, apply 30-40% reduction to development tasks (not discovery, design, or QA). State explicitly: "Hours reflect AI-augmented development workflow (est. 35% productivity gain)."

Estimation Independence:
```

Replace with:
```
AI Productivity Factor:
After estimating hours conservatively, apply 30-40% reduction to development tasks (not discovery, design, or QA). The reduction is applied internally — do not quote the exact percentage in the client-facing document.

EFFORT CALIBRATION — Reference ranges for common item types. Use as sanity checks, not hard caps.
If your estimate differs significantly from these ranges, justify in the sheet's Assumptions column.

Infrastructure & Config:
- Hosting config (Vercel/AWS — staging + prod): 0.25-0.5 MD
- CI/CD pipeline setup: 0.5-1 MD
- Environment variables & secrets: included in hosting config, not a separate item

Embed Widgets & 3rd Party Scripts:
- Chat widget (Intercom, Dialpad, Zendesk) with provided embed code: 0.125-0.25 MD
- Analytics setup (GA4 + GTM + Meta Pixel + tracking pixels): combine into ONE item, 0.5-1 MD total.
  Only exceed 1 MD if complex datalayer events or custom dimensions are required.
- Cookie consent banner: 0.25-0.5 MD

Discovery & Audit:
- SIMPLE projects: 0.5-1 MD total
- MEDIUM projects: 1-3 MD total
- COMPLEX projects: 3-8 MD total

Forms:
- Simple contact form: 0.5-1 MD
- Multi-step form with validation: 1.5-2.5 MD
- Form with 3rd party CRM integration: 2-3 MD

API Integrations:
- Standard REST API with documented endpoints: 1-2 MD per integration
- Complex API with auth, webhooks, error handling: 2-4 MD per integration
- CRM integration (read + write): 2-3 MD

QA & Testing:
- SIMPLE: Developer QA (cross-browser + responsive) — 1 combined item, 1-2 MD
- MEDIUM: QA phase (test plan + regression + accessibility) — 1 combined item, 2-4 MD
- COMPLEX: Dedicated QA (test suite + perf + security + UAT) — 1-2 items, 5-10 MD
- NEVER split functional QA and cross-browser testing into separate items

Grouping Rules (MANDATORY):
- All tracking/analytics pixels → ONE item
- All deployment/hosting config → ONE item
- Functional QA + cross-browser testing → ONE item
- SEO meta tags + sitemap + robots.txt → ONE item

Estimation Independence:
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit (0)

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-quality): add effort calibration benchmarks"
```

---

### Task 9: Update existing estimation minimums

**Files:**
- Modify: `src/agents/orchestrator.ts` (lines 290-295)

**Step 1: Update webhook/cache minimum**

Find (lines 290-291):
```
4. WEBHOOK / CACHE INVALIDATION: CMS webhook + cache invalidation is not trivial.
   Minimum 2 MD for simple sites, 3-5 MD for complex setups.
```

Replace with:
```
4. WEBHOOK / CACHE INVALIDATION: CMS webhook + cache invalidation is not trivial.
   1-2 MD for simple sites, 2-4 MD for complex setups.
```

**Step 2: Update forms minimum**

Find (lines 293-295):
```
5. FORMS WITH INTEGRATIONS: Multi-step forms with 3rd party integrations, real-time validation,
   and conditional rendering carry integration risk. Minimum 3-4 MD even for simple projects.
   If field count and types are unknown, add a risk note in assumptions.
```

Replace with:
```
5. FORMS WITH INTEGRATIONS: Multi-step forms with 3rd party integrations, real-time validation,
   and conditional rendering carry integration risk. 2-3 MD for forms with CRM/API integration.
   If field count and types are unknown, add a risk note in assumptions.
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit (0)

**Step 4: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-quality): adjust estimation minimums for forms and webhooks"
```

---

### Task 10: Update SECTION DEPTH rules and review checklist

**Files:**
- Modify: `src/agents/orchestrator.ts` (lines 165-177, lines 742-766)

**Step 1: Update SECTION DEPTH**

Find (lines 167-168):
```
- Company overview: 60-80 words. 1-2 paragraphs + key facts.
- Our clients: 3 past clients max, 1 sentence each.
```

Replace with:
```
- Company overview: 60-80 words. 1-2 paragraphs + key facts.
- Our partners: only if relevant to tech stack. 1-2 sentences. Skip if none relevant.
- Similar projects: 2-3 projects similar to this RFP, 1 sentence each.
- Integrations: 1-2 sentence summary + 1 bullet per integration tool. Skip if none.
```

**Step 2: Update Investment line in SECTION DEPTH**

Find (line 174):
```
- Investment: 60-80 words. Grand total EUR, total man-days, AI productivity note. No per-area costs.
```

Replace with:
```
- Investment: 60-80 words. Grand total EUR, total man-days, subtle AI-native mention. No per-area costs. No AI percentages. No external tooling costs unless confirmed by client.
```

**Step 3: Update review checklist**

Find (lines 743):
```
1. About Us: Names specific credentials (Deloitte Fast 50, Vercel partner)? Lists real clients? No "extensive experience" or "proven track record"?
```

Replace with:
```
1. About Us: Names specific credentials (Deloitte Fast 50, Vercel partner)? Similar projects relevant to this RFP? Partners only if relevant to tech stack? No partners listed as clients? Links in plain URL format (not markdown)? No "extensive experience" or "proven track record"?
```

Find (line 749):
```
7. Investment: Single grand total EUR + total man-days + AI note? No per-area breakdown? No hourly rates?
```

Replace with:
```
7. Investment: Single grand total EUR + total man-days + subtle AI-native mention (no exact percentages)? No per-area breakdown? No hourly rates? No post-launch support windows? No external tooling costs unless client confirmed?
```

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit (0)

**Step 5: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-quality): update section depth rules and review checklist"
```

---

### Task 11: Final verification

**Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: clean exit (0)

**Step 2: Run all tests**

Run: `npm test`
Expected: all tests pass

**Step 3: Self-review — verify old references removed and new rules present**

Run these greps to confirm:
```bash
# Should NOT find "Clients include Vercel" (old wording)
grep -c "Clients include Vercel" src/agents/orchestrator.ts
# Expected: 0

# Should find partner/client separation
grep -c "Partners are NOT clients" src/agents/orchestrator.ts
# Expected: 1

# Should find calibration section
grep -c "EFFORT CALIBRATION" src/agents/orchestrator.ts
# Expected: 1

# Should find RFP coverage rule
grep -c "RFP COVERAGE RULE" src/agents/orchestrator.ts
# Expected: 1

# Should find similar projects (not "Our clients" in doc structure)
grep -c "Similar projects" src/agents/orchestrator.ts
# Expected: at least 2 (section depth + doc structure)

# Should find plain URL format instruction
grep -c "NOT as markdown links" src/agents/orchestrator.ts
# Expected: 1

# Should find integrations subsection
grep -c '"Integrations"' src/agents/orchestrator.ts
# Expected: 1

# Should NOT find old AI percentage wording in doc instruction
grep -c "est. 35% productivity gain" src/agents/orchestrator.ts
# Expected: 0

# Should find conversational VBP tone
grep -c "money where our mouth is" src/agents/orchestrator.ts
# Expected: 1
```

**Step 4: Update SPEC-039 status**

Change `**Status:** Planning` to `**Status:** Implemented` in this file.

**Step 5: Update `.ai/specs/README.md`**

Change SPEC-039 status from `Planning` to `Implemented`.

**Step 6: Push and create PR**

```bash
git push -u origin feat/proposal-quality-fixes
gh pr create --title "feat: proposal quality fixes — content, pricing & calibration" --body "..."
```
