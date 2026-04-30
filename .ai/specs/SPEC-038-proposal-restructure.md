# SPEC-038: Proposal Document Restructure

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix proposal bloat, hallucinated data, ignored client answers, and poor readability. Restructure the document around a client-friendly "Scope of Work" derived from estimation areas, add Figma MCP for design file reading, and tighten prompt rules.

**Architecture:** Rewrite the Step 4b prompt section structure, add new system prompt rules (anti-hallucination, scope boundaries, risk rules), integrate `figma-developer-mcp` as a new MCP server, scale VBP section to complexity.

**Tech Stack:** Orchestrator prompt, MCP server config, `figma-developer-mcp` npm package.

**Status:** Planning
**Date:** 2026-03-12
**Scope:** `src/agents/orchestrator.ts`

---

## Problems (from Endeavor estimation)

1. **Out-of-scope items estimated** — Phase 2 was explicitly out of scope but included in the estimation and offer.
2. **Hallucinated IDs** — Agent invented pixel IDs, ads tracking IDs. Never generate fake credentials/tags.
3. **Assumptions contradicting client answers** — e.g., Cal.com pricing assumed despite client saying otherwise.
4. **Figma not read** — Agent asked about Figma components in Slack instead of reading the provided Figma link.
5. **Risk section issues** — "First ever integration" (we're not beginners), "timeline aggressiveness" (signals incompetence).
6. **Team composition bloat** — Not needed in client-facing proposal.
7. **Project phases / timeline / budget unreadable** — Repetitive, not client-friendly. Needs scope-of-work format with milestones derived from estimation, grand total only.
8. **QA section one-size-fits-all** — Should scale to complexity (Endeavor barely needs QA).
9. **Continuous development** — Should list areas briefly, no price yet.
10. **Next Steps** — Should be empty for salesman to fill.
11. **VBP too long for simple projects** — Endeavor needs ~1/3 page, not a full section.

---

## Design

### A. New System Prompt Rules

Add these rules to the system prompt (before ESTIMATION RULES, after OFFER CONTENT RULES):

```
CONTENT INTEGRITY RULES:
- NEVER generate fake tracking tags, pixel IDs, ad IDs, API keys, webhook URLs, measurement IDs, or any credentials. If the RFP mentions analytics/tracking tools (GA, Meta Pixel, HubSpot, GTM), note them as integration requirements — do NOT invent configuration values.
- NEVER estimate out-of-scope work. If the client states something is out of scope (e.g., "Phase 2 is not part of this"), exclude it from the estimation and the offer. Only mention it briefly under "Future Considerations" if relevant.
- NEVER override client answers with your own assumptions. If the client denies a tool, rejects a pricing model, or gives explicit direction — follow it exactly. Do not rationalize alternatives.
- NEVER assume Blazity lacks experience with any tool or technology mentioned in the RFP. Blazity has done this 40+ times with diverse tech stacks.

RISK SECTION RULES:
- Risks must be project-specific technical or scope challenges.
- NEVER list "first time integrating with X" as a risk — we have experience with everything.
- NEVER list tight timelines, aggressive deadlines, or resource availability as risks — it signals incompetence. Handle timeline pressure via team sizing.
- Good risks: data migration complexity, third-party API instability, unclear requirements in a specific area, regulatory compliance gaps.
- Bad risks: "limited experience with X", "aggressive timeline", "resource allocation challenges", "scope creep".
```

### B. Figma MCP Integration

Add `figma-developer-mcp` as a new MCP server in the orchestrator config. This is an npx-based stdio server.

**Config:**
```typescript
"figma": {
  command: "npx",
  args: ["-y", "figma-developer-mcp", "--stdio"],
  env: {
    FIGMA_API_KEY: process.env.FIGMA_API_KEY ?? "",
  },
},
```

**Conditional:** Only include if `FIGMA_API_KEY` is set. Not all jobs have Figma files.

**Allowed tools:** Add the Figma tool(s) exposed by the package. The main one is typically `get_file` or similar — we'll discover the exact tool names at integration time.

**Prompt addition** (in Step 1 or Step 2):
```
If the RFP or file manifest includes Figma links (figma.com URLs), use the figma MCP tools to
read the design file structure. Count actual pages, frames, and components — do NOT guess.
Use this data for component counts in your estimation.
```

**TOOL_TO_STEP mapping:** Map Figma tools to step 1 (analysis).

### C. Redesigned Document Structure

**Remove entirely:**
- Team composition section (section b, line 628)
- "Project Phases" section (section c: Discovery/Design, Development, Milestones)
- "Development Timeline & Budget" section (section d: Timeline table, Investment Summary, QA & Testing strategy, Additional costs)
- "Post-launch support: Training" subsection

**Redesign:**

New document structure (sections a through g):

```
a. heading level 1: "About Us"
   (UNCHANGED — company overview, partners, clients, links)

b. heading level 1: "Project Approach"
   - h2: "Goals" (UNCHANGED — 5-7 items)
   - h2: "Assumptions" (CHANGED — only list items NOT already answered by client.
     If the client explicitly addressed a topic, it is NOT an assumption.)
   - h2: "Risks" (CHANGED — follow RISK SECTION RULES. No "first integration", no "timeline risk")
   - h2: "Delivery approach" (UNCHANGED)
   - h2: "Sprint-based development" (UNCHANGED)
   - h2: "Core tools and their roles" (UNCHANGED)
   (REMOVED: "Team composition")

c. heading level 1: "Scope of Work"

   For EACH Major Area from the estimation spreadsheet (in the same order as the sheet):

   - heading level 2: "[Area Name]"
   - paragraph: What will be delivered in this area. Client-friendly language.
     Include estimated duration for this area (e.g., "~2 weeks").
     Reference key milestones where applicable.
   - bullet_list: Action items from the estimation, described as deliverables
     (e.g., "Custom component library based on Figma design system" not
     "Component development — 3 MD"). NO effort numbers, NO costs per item.

   QA appears here as its own area IF it's in the estimation. Scale the description
   to complexity:
   - SIMPLE: "Developer QA — cross-browser testing and responsive verification"
   - MEDIUM: "QA phase — test plan execution, regression testing, accessibility audit"
   - COMPLEX: "Dedicated QA — comprehensive test suite, performance testing, security audit, UAT support"

   After all areas:

   - heading level 2: "Timeline Overview"
   - table: Phase | Duration | Key Milestone
     (derived from estimation areas, not invented separately)

   - heading level 2: "Investment"
   - paragraph: Grand total in EUR (fixed-price). Total man-days.
     AI productivity note. What's included (all phases through launch + stabilization).
     NO per-area costs, NO per-item costs, NO hourly rates.
     If there are notable additional costs (infrastructure, licensing), mention them inline.

d. heading level 2: "Continuous Development"
   - paragraph: 2-3 sentences about post-launch partnership opportunity.
   - bullet_list: Areas we could cover (feature iteration, performance optimization,
     content updates, infrastructure monitoring). Keep each bullet to 1 line.
     NO pricing. This is a conversation starter for the salesman.

e. heading level 1: "Alternative: Performance Partnership"

   SCALED TO COMPLEXITY:

   SIMPLE projects (< 30 MD):
   - paragraph: 3-4 sentences explaining the concept. Fixed fee + performance bonus.
     Reference 1-2 measurable outcomes relevant to the project.
     Total: ~1/3 page.

   MEDIUM projects (30-80 MD):
   - paragraph: value opportunity framing (2-3 sentences)
   - table: Approach Comparison (Fixed-Price vs Performance Partnership) — 3-4 rows
   - paragraph: Investment breakdown (base fee, bonus pool 20%, total)
   - Total: ~1/2 page.

   COMPLEX projects (> 80 MD):
   - Full section as currently designed (Business Impact Analysis, Investment Structure,
     Success Metrics & Bonus Structure, Why Performance Partnership)
   - Total: 1-1.5 pages.

f. page_break

g. heading level 1: "Next Steps"
   - paragraph: "[This section will be completed by your dedicated account manager
     with a tailored onboarding plan and kickoff timeline.]"
   - divider
```

### D. Updated SECTION DEPTH Rules

Replace the current section depth limits with:

```
SECTION DEPTH — HARD LIMIT: total document body must not exceed 3000 words.
- Company overview: 60-80 words
- Our clients: 3 past clients max, 1 sentence each
- Goals: 5-7 items, bold keyword + 1-line description
- Assumptions: Only genuine unknowns the client hasn't addressed. 3-8 items max.
- Risks table: 3-5 rows. Project-specific technical risks only.
- Scope of Work areas: 40-80 words per area + bullet deliverables. No effort numbers.
- Timeline Overview table: 1 row per area.
- Investment: 60-80 words. Grand total EUR, total man-days, AI note.
- Continuous Development: 30-50 words + 4-6 bullet areas.
- Performance Partnership: SIMPLE ~100 words, MEDIUM ~200 words, COMPLEX ~400 words.
- Next Steps: placeholder text only.
```

### E. Updated Review Checklist

Remove checks that no longer apply (team composition, detailed QA strategy section, per-section timeline math). Add:
- **Scope of Work matches estimation:** Every Major Area from the spreadsheet appears in Scope of Work.
- **No hallucinated IDs:** Search doc for pixel/tracking IDs, API keys, measurement IDs. If found, remove them.
- **No out-of-scope items:** Cross-check estimation areas against client's stated scope boundaries.
- **Assumptions don't contradict answers:** Every assumption must be about something the client hasn't addressed.

---

## Plan

### Task 1: Add new system prompt rules

**Files:**
- Modify: `src/agents/orchestrator.ts` (system prompt, after line ~148 OFFER CONTENT RULES)

**Step 1: Add CONTENT INTEGRITY RULES block**

After the OFFER CONTENT RULES section (line 148), add:

```
CONTENT INTEGRITY RULES:
- NEVER generate fake tracking tags, pixel IDs, ad IDs, API keys, webhook URLs, measurement IDs, or any credentials. If the RFP mentions analytics/tracking tools (GA, Meta Pixel, HubSpot, GTM), note them as integration requirements — do NOT invent configuration values.
- NEVER estimate out-of-scope work. If the client states something is out of scope, exclude it from the estimation AND the offer. Mention it briefly under a "Future Considerations" note only if relevant.
- NEVER override client answers with your own assumptions. If the client denies a tool, rejects a pricing model, or gives explicit direction — follow it exactly.
- NEVER assume Blazity lacks experience with any tool or technology mentioned in the RFP.

RISK SECTION RULES:
- Risks must be project-specific technical or scope challenges.
- NEVER list "first time integrating with X" — Blazity has experience with all tooling.
- NEVER list tight timelines or aggressive deadlines as risks — handle via team sizing.
- NEVER list "resource availability", "scope creep", or "dependency on client" as risks.
- Good risks: data migration complexity, third-party API rate limits, unclear regulatory requirements, legacy system constraints.
```

**Step 2: Update the risk note in ESTIMATION INDEPENDENCE (line 262)**

Change:
```
   "Timeline is aggressive — requires full team availability from kickoff."
```
To:
```
   "Team sized to meet timeline — parallel workstreams require coordinated kickoff."
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-restructure): add content integrity and risk section rules"
```

---

### Task 2: Update SECTION DEPTH rules

**Files:**
- Modify: `src/agents/orchestrator.ts` (lines 149-165)

**Step 1: Replace section depth rules**

Replace lines 149-165 with:

```
SECTION DEPTH — HARD LIMIT: total document body must not exceed 3000 words.
Count your words before submitting. If over 3000, cut the longest sections first.
- Company overview: 60-80 words. 1-2 paragraphs + key facts.
- Our clients: 3 past clients max, 1 sentence each.
- Goals: 5-7 numbered items, each with bold keyword + 1-line description.
- Assumptions: genuine unknowns only — things the client has NOT already addressed. 3-8 items max.
- Risks table: 3-5 rows. Project-specific technical risks only. Follow RISK SECTION RULES.
- Scope of Work areas: 40-80 words per area + bullet deliverables. No effort numbers or costs.
- Timeline Overview table: 1 row per estimation area.
- Investment: 60-80 words. Grand total EUR, total man-days, AI productivity note. No per-area costs.
- Continuous Development: 30-50 words + 4-6 bullet areas. No pricing.
- Performance Partnership: scale to tier — SIMPLE ~100 words, MEDIUM ~200 words, COMPLEX ~400 words.
- Next Steps: placeholder text only (salesman completes manually).
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-restructure): update section depth rules for new structure"
```

---

### Task 3: Add Figma MCP server

**Files:**
- Modify: `src/agents/orchestrator.ts` (MCP server config + allowedTools + TOOL_TO_STEP + prompt)

**Step 1: Add FIGMA_API_KEY to optional env handling**

Do NOT add it to `requiredEnv` — Figma is optional. Instead, check for it when building MCP config.

**Step 2: Add Figma MCP server config (after the web-research block, ~line 949)**

```typescript
          ...(process.env.FIGMA_API_KEY ? {
            "figma": {
              command: "npx",
              args: ["-y", "figma-developer-mcp", "--stdio"],
              env: {
                FIGMA_API_KEY: process.env.FIGMA_API_KEY,
              },
            },
          } : {}),
```

**Step 3: Add Figma tools to allowedTools**

After the web-research tools, conditionally add Figma tools. The `figma-developer-mcp` package exposes tools prefixed with `mcp__figma__`. The main tool is `get_figma_data` (reads file structure). Check the package docs for exact tool names — run `npx figma-developer-mcp --help` or inspect the tool list.

Add conditionally:
```typescript
          ...(process.env.FIGMA_API_KEY ? [
            "mcp__figma__get_figma_data",
          ] : []),
```

Note: Exact tool names may need adjustment after testing the package.

**Step 4: Add Figma tools to TOOL_TO_STEP**

```typescript
  get_figma_data: 1,
```

**Step 5: Add Figma reading instructions to Step 1 prompt (after KB search instructions, ~line 379)**

```
4. If the RFP, file manifest, or client messages contain Figma links (figma.com URLs),
   use the figma MCP tools to read the design file structure. Count actual pages, frames,
   and components — do NOT guess component counts. Use this data in your estimation.
   If no Figma link is provided, ask about design assets in Step 2 clarification.
```

**Step 6: Add FIGMA_API_KEY to .env.example**

**Step 7: Run type check**

Run: `npx tsc --noEmit`

**Step 8: Commit**

```bash
git add src/agents/orchestrator.ts .env.example
git commit -m "feat(proposal-restructure): add figma-developer-mcp for design file reading"
```

---

### Task 4: Rewrite Step 4b document structure

**Files:**
- Modify: `src/agents/orchestrator.ts` (lines ~593-760)

This is the biggest change. Replace the entire Step 4b document structure (sections a-h) with the new structure.

**Step 1: Replace section b (Project Approach) — remove Team composition**

In the current section b (lines 620-628), remove:
```
      - heading level 2: "Team composition" + paragraph (✅ bullet list of roles with allocation)
```

**Step 2: Replace sections c and d with new "Scope of Work" section**

Delete current sections c ("Project Phases": Discovery/Design, Development, Milestones) and d ("Development Timeline & Budget": Timeline table, Investment Summary, QA & Testing strategy, Additional costs).

Replace with:

```
   c. heading level 1: "Scope of Work"

      For EACH Major Area from the estimation spreadsheet (use the same areas and order):

      - heading level 2: "[Area Name]"
        + paragraph: What will be delivered in this area. Client-friendly, outcome-focused language.
          Include estimated duration (e.g., "~2 weeks") and key milestone if applicable.
        + bullet_list: Action items described as deliverables the client will receive.
          Use plain language, not technical task descriptions.
          Example: "Custom component library matching your Figma design system"
          NOT: "Component development (Senior Engineer, 3 MD, assuming 15 components)"
          NO effort numbers. NO man-days. NO costs per item.

      QA/Testing appears as one of the areas IF it is in the estimation spreadsheet.
      Scale the description to complexity tier:
      - SIMPLE: "Developer-led QA — cross-browser testing and responsive verification"
      - MEDIUM: "QA phase — structured test plan, regression testing, accessibility checks"
      - COMPLEX: "Dedicated QA — comprehensive test suite, performance testing, security audit, UAT support"

      After all areas:

      - heading level 2: "Timeline Overview"
        + table: Phase | Duration | Key Milestone
          One row per Major Area. Duration derived from estimation hours ÷ team capacity.
          The total duration must match the overall timeline (total MD ÷ team size + 15% buffer).
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"

      - heading level 2: "Investment"
        + paragraph (60-80 words):
          State the grand total fixed-price investment in EUR and total man-days.
          Include: "Estimate reflects AI-augmented development workflow."
          Mention that all phases (discovery through launch and post-launch stabilization) are included.
          If notable infrastructure or licensing costs exist, mention them inline.
          Do NOT list per-area costs, per-item costs, hourly rates, or rate card details.
          The detailed breakdown is in the estimation spreadsheet (internal use only).
```

**Step 3: Replace section e (Post-launch support) with Continuous Development**

Delete current section e (Training + Continuous development paragraphs).

Replace with:
```
   d. heading level 2: "Continuous Development"
      + paragraph: 2-3 sentences about post-launch partnership opportunity.
        Position as a natural continuation of the engagement.
      + bullet_list: Areas we could cover. Keep each bullet to 1 line. No pricing.
        Examples: feature iteration, performance optimization, content management support,
        infrastructure monitoring, analytics and conversion optimization.
```

**Step 4: Replace section f (Performance Partnership) with scaled version**

Replace the entire VBP section with:

```
   e. heading level 1: "Alternative: Performance Partnership"

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
        + heading level 2: "Investment Structure"
          Approach Comparison table (5 rows) + investment breakdown paragraph
        + heading level 2: "Success Metrics & Bonus Structure"
          KPI table (3-5 rows) + assessment paragraph
        + heading level 2: "Why Performance Partnership"
          3-4 sentences on incentive alignment, shared risk, quality focus
        Total: ~400 words, 1-1.5 pages.
```

**Step 5: Replace sections g and h (page break + Next Steps)**

Replace with:
```
   f. page_break

   g. heading level 1: "Next Steps"
      + paragraph: "This section will be completed by your dedicated account manager with a tailored onboarding plan and kickoff timeline."
      + divider
```

**Step 6: Run type check**

Run: `npx tsc --noEmit`

**Step 7: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-restructure): rewrite doc structure with scope-of-work format"
```

---

### Task 5: Update review checklist

**Files:**
- Modify: `src/agents/orchestrator.ts` (review checks, lines ~717-747)

**Step 1: Replace the review checklist**

Replace the entire REVIEW section with:

```
REVIEW:
Read back the document using docs_get_document. Check EVERY item below. If ANY check fails, fix it before proceeding.

CONTENT CHECKS:
1. About Us: Names specific credentials (Deloitte Fast 50, Vercel partner)? Lists real clients? No "extensive experience" or "proven track record"?
2. Goals: 5-7 concrete goals with bold key phrases? Specific to this project?
3. Assumptions: Only genuine unknowns the client hasn't addressed? No assumptions contradicting client answers?
4. Risks: Project-specific technical risks only? No "first integration with X", no "tight timeline", no "resource availability"? 3-5 rows?
5. Scope of Work: Every Major Area from estimation spreadsheet appears? No per-item costs or effort numbers? Deliverables described in client-friendly language?
6. Timeline Overview: Matches estimation areas? Duration = MD ÷ team size + 15% buffer?
7. Investment: Single grand total EUR + total man-days + AI note? No per-area breakdown? No hourly rates?
8. Continuous Development: Lists areas briefly? No pricing?
9. Next Steps: Placeholder text only (not filled in by agent)?
10. Performance Partnership: Scaled to complexity? SIMPLE ~1/3 page, MEDIUM ~1/2 page, COMPLEX 1-1.5 pages?

FORMATTING CHECKS:
11. Cover page: No {{PLACEHOLDER}} tokens remaining?
12. Tables: Orange headers (#FD6027), white text, #E6E8EB borders?
13. Estimation Sheet: sheets_create_estimation called successfully?

INTEGRITY CHECKS:
14. No hallucinated IDs: Search document text for pixel IDs, tracking tags, API keys, measurement IDs. If ANY fake credentials found, remove them immediately.
15. No out-of-scope items: Cross-check Scope of Work against client's stated scope boundaries. If any area was explicitly excluded by the client, remove it.
16. Rate card compliance: Fixed price calculated using ESTIMATION RULES rate card?
17. AI factor applied: Development hours reduced 30-40% with AI productivity note?
18. Word count: Document body under 3000 words?
19. Tech versions verified: Framework/library versions match web search results?
20. No guessed pricing: All vendor prices cited with source URLs or flagged with placeholders?
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-restructure): update review checklist for new doc structure"
```

---

### Task 6: Update assumptions handling in Step 2

**Files:**
- Modify: `src/agents/orchestrator.ts` (Step 2 prompt, lines ~411-480)

**Step 1: Add explicit scope boundary rule to Step 2**

After the KNOWLEDGE AREAS section (after line ~420), add:

```
SCOPE BOUNDARY RULE: If the client states something is out of scope, mark it as OUT OF SCOPE
in your notes. Do NOT include it in estimation or offer. If the client explicitly addresses a
topic (e.g., "we use Cal.com, pricing is $X"), that topic is NOT an assumption — record the
client's answer as a fact.
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(proposal-restructure): add scope boundary rule to clarification step"
```

---

### Task 7: Final verification

**Step 1: Run full type check**

Run: `npx tsc --noEmit`

**Step 2: Run all tests**

Run: `npm test`

**Step 3: Verify changes**

- `grep -r "Team composition" src/agents/orchestrator.ts` — should find nothing (removed)
- `grep -r "Project Phases" src/agents/orchestrator.ts` — should find nothing (replaced)
- `grep -r "QA & Testing strategy" src/agents/orchestrator.ts` — should find nothing (merged into scope)
- `grep -r "CONTENT INTEGRITY" src/agents/orchestrator.ts` — should find the new rules
- `grep -r "RISK SECTION RULES" src/agents/orchestrator.ts` — should find the new rules
- `grep -r "figma-developer-mcp\|FIGMA_API_KEY" src/agents/orchestrator.ts` — should find MCP config
- `grep -r "Scope of Work" src/agents/orchestrator.ts` — should find the new section

**Step 4: Self-review checklist**

- Error propagation: Figma MCP is optional (conditional config), won't break jobs without FIGMA_API_KEY
- Prompt safety: No new user data interpolation
- Accounting: All estimation areas map to Scope of Work sections
- Section depth: New rules match new structure

**Step 5: Update architecture and MCP docs**

- `.ai/architecture.md`: Add figma MCP server row
- `.ai/mcp-tools.md`: Add figma tools section

**Step 6: Push and create PR**

```bash
git push -u origin feat/proposal-restructure
gh pr create --title "feat: proposal restructure — scope of work format, anti-hallucination rules, Figma MCP" --body "..."
```
