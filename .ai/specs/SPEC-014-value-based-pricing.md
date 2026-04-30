# SPEC-014: Value-Based Pricing Alternative

**Status:** Planning
**Date:** 2026-03-01

---

## Design

### Problem

Generated offers only present T&M pricing (Role × Rate × Hours = Cost). This positions Blazity as a vendor selling hours rather than a strategic partner delivering outcomes. Sophisticated buyers think in terms of ROI, not day rates. Adding a value-based alternative demonstrates outcome-oriented thinking and can command higher project values with better incentive alignment.

### Goal

Every offer includes an additional section — "Alternative: Value-Based Partnership" — placed before "Next Steps." It presents a hybrid base fee + performance bonus model backed by data-driven business impact analysis with cited industry benchmarks and competitor/alternative cost analysis.

### Solution Overview

| Change | Purpose |
|--------|---------|
| New pipeline step (Step 3: Value Discovery) | Dedicated research phase for client business metrics, industry benchmarks, and competitor pricing |
| New offer section (H1: Alternative: Value-Based Partnership) | Present hybrid VBP model with value projection table, investment structure, KPIs, and ROI comparison |
| Orchestrator prompt changes | Instructions for value research, value modeling math, citation rules, and VBP section content |

---

## 1. Pipeline Change

The current 5-step pipeline becomes 6 steps. A new **Step 3: Value Discovery** is inserted between Clarification (Step 2) and Offer Writing (Step 4):

| Step | Name | Change |
|------|------|--------|
| 1 | Analyze the RFP | Unchanged |
| 2 | Ask Clarification Questions | Unchanged |
| **3** | **Value Discovery & Business Impact Analysis** | **NEW** |
| 4 | Create the Google Doc Offer | Was Step 3 — now includes VBP section |
| 5 | Create the Visual Presentation | Was Step 4 — unchanged |
| 6 | Post to Slack | Was Step 5 — unchanged |

Step 3 does NOT post to Slack. Findings remain in the agent's conversation context and feed directly into the offer's VBP section.

---

## 2. Step 3: Value Discovery — Prompt Instructions

The agent performs three research activities using existing `fetch_web_page` MCP tool:

### 2.1 Client Business Research

- Visit the client's website to identify business model, market position, scale indicators (revenue, traffic, employee count, market share)
- Search for annual reports, press releases, investor filings, or earnings data
- Cross-reference with RFP content for stated goals/pain points (e.g., "reduce hosting costs from €650K")
- Identify the client's industry vertical and relevant KPIs (e.g., CVR for e-commerce, lead gen for B2B, engagement for media)

### 2.2 Industry Benchmark Research

Search for published benchmarks relevant to the project type. Examples by project category:

| Project Type | Benchmark Searches |
|---|---|
| Headless/CMS migration | "headless commerce conversion rate improvement", "CMS migration performance gains" |
| E-commerce platform | "page speed impact on revenue ecommerce", "mobile optimization conversion uplift" |
| Platform modernization | "legacy modernization TCO savings", "cloud migration cost reduction enterprise" |
| New product build | "time to market competitive advantage software", "MVP launch revenue acceleration" |

**Citation rules:**
- Every benchmark number MUST cite a specific source (publication name, year, URL)
- Prefer recent data (2024-2026) from named research firms (Forrester, Gartner, McKinsey, Deloitte, Google)
- Prefer primary research over aggregator blog posts
- If no credible source exists for a claim, do NOT make that claim
- Use conservative estimates (low end of published ranges)

### 2.3 Competitor & Alternative Cost Analysis (EVC Framework)

Research what the client would pay for alternatives to establish a reference price:

- **Agency competitors:** What do comparable agencies/consultancies charge for similar scope? Search for published rate cards, case studies with pricing, or industry surveys (e.g., Clutch, GoodFirms rate benchmarks)
- **Internal build alternative:** Estimate cost of building an internal team for the same scope (salaries × duration + hiring overhead + ramp-up time)
- **"Do nothing" cost:** What does the client lose by not acting? (Continued current spend, missed revenue, competitive disadvantage)
- **Big consultancy benchmark:** What would a Big 4 / Accenture / large SI charge for comparable scope?

This establishes the EVC (Economic Value to Customer): Reference Price + Differentiation Value = maximum the client should pay.

---

## 3. Offer Document — VBP Section Structure

New HEADING 1 section inserted after "Post-launch support" (section e) and before the page break + "Next Steps" (sections f-g). The page break moves to after the VBP section.

### Document order (updated):

```
a. About Us
b. Project Approach
c. Project Phases
d. Development Timeline & Budget (T&M pricing — unchanged)
e. Post-launch support

NEW → f. Alternative: Value-Based Partnership
       f1. Business Impact Analysis
       f2. Investment Structure
       f3. Success Metrics & Bonus Structure
       f4. Why Value-Based Pricing

g. page_break
h. Next Steps (closing + contact)
```

### Section content:

#### f. HEADING 1: "Alternative: Value-Based Partnership"

#### f1. HEADING 2: "Business Impact Analysis"

**Paragraph:** 2-3 sentences framing the value opportunity. Reference specific client pain points from the RFP and the value levers identified in Step 3.

**TABLE: Value Projection**

| Column | Content |
|--------|---------|
| Value Driver | Specific lever (e.g., "Conversion rate improvement", "Infrastructure cost reduction") |
| Current State | Client's current metric (from research or RFP) |
| Expected Improvement | Conservative improvement estimate with range |
| Annual Impact | Calculated € value |
| Source | Publication name, year (e.g., "Forrester, 2025") |

- 3-5 rows of specific, project-relevant value drivers
- Final row: **Total Projected Annual Value** (sum of Annual Impact column)
- Orange header + total row styling (matches budget table)

**Paragraph:** Brief note on competitor/alternative costs from EVC analysis. Frame as: "A comparable engagement with [alternative] would cost €X. Our value-based model delivers [Y]× that investment in projected annual returns."

#### f2. HEADING 2: "Investment Structure"

**TABLE: Approach Comparison**

| Column | Content |
|--------|---------|
| Dimension | Comparison criterion |
| T&M Approach | How the T&M estimate (from section d) handles this |
| Value-Based Partnership | How the VBP model handles this |

Rows:
1. Investment — T&M total vs. VBP base + max bonus
2. Risk Allocation — "Client bears scope/timeline risk" vs. "Shared — vendor has skin in the game"
3. Incentive Alignment — "Vendor benefits from more hours" vs. "Both parties benefit from outcomes"
4. Scope Flexibility — "Flexible scope, variable cost" vs. "Fixed scope, performance-linked upside"
5. Expected ROI — "N/A — priced on effort" vs. "[X]× projected annual return on investment"

Orange header styling, no total row.

**Paragraph:** Pricing breakdown:
- "Base delivery fee: €X — covers full project delivery including all phases, QA, and launch support"
- "Performance bonus pool: €Y (Z% of base fee) — earned upon achievement of the success metrics below"
- "Total maximum investment: €X+Y — projected ROI of [N]× based on first-year value"

**Pricing math:**
- Base fee = T&M total from budget table (same scope, same delivery)
- Performance bonus pool = 20% of base fee
- ROI multiplier = Total Projected Annual Value ÷ Total Maximum Investment

#### f3. HEADING 2: "Success Metrics & Bonus Structure"

**TABLE: KPI → Bonus Mapping**

| Column | Content |
|--------|---------|
| KPI | Specific measurable outcome |
| Target | Concrete threshold |
| Measurement Method | How it will be verified |
| Bonus Amount | € amount tied to this KPI |

3-5 rows of project-specific KPIs. Examples by project type:

| Project Type | Example KPIs |
|---|---|
| E-commerce | CVR improvement ≥ X%, page load < 2s, Core Web Vitals pass |
| Platform migration | Go-live within agreed timeline, zero critical post-launch incidents for 30 days, infrastructure cost reduction ≥ X% |
| New product | MVP launch by target date, user adoption ≥ X users in 90 days, system uptime ≥ 99.9% |
| Content platform | Publishing workflow time reduction ≥ X%, SEO traffic improvement ≥ X% in 6 months |

Orange header styling, no total row.

**Paragraph:** "Bonus assessment occurs at [3/6] months post-launch. Measurement uses [client analytics platform / independent audit / agreed third-party tool]. KPIs are assessed independently — partial achievement is possible."

#### f4. HEADING 2: "Why Value-Based Pricing"

**Paragraph:** 3-4 sentences:
- "We succeed when you succeed" — incentive alignment
- Risk is shared — Blazity puts a meaningful portion of compensation at stake
- This model rewards efficiency and quality, not hours logged
- Used by Blazity with clients who prioritize outcomes over effort tracking

---

## 4. Orchestrator Prompt Changes

### File: `src/agents/orchestrator.ts`

**Change 1: Renumber steps**

Current Steps 3-5 become Steps 4-6. References to step numbers in the prompt must be updated.

**Change 2: Add Step 3 prompt block**

Insert between Step 2 and the current Step 3 (now Step 4):

```
## Step 3: Value Discovery & Business Impact Analysis

Research the client's business and industry to build a data-driven value model
for the value-based pricing section of the offer.

1. RESEARCH THE CLIENT'S BUSINESS
   Use fetch_web_page to visit the client's website and search for:
   - Business model, revenue indicators, market position, traffic/scale
   - Annual reports, press releases, investor data, earnings
   - Industry vertical and key business metrics (CVR, ARPU, churn, etc.)
   Cross-reference with the RFP for stated goals and pain points.

2. RESEARCH INDUSTRY BENCHMARKS
   Search for published data on typical improvements for this project type.
   Use fetch_web_page on credible sources (Forrester, Gartner, McKinsey, Deloitte,
   Google, Baymard Institute, platform vendor case studies).
   Find 3-5 relevant benchmarks with specific numbers.
   EVERY benchmark MUST have a cited source (publication, year, URL).
   Use conservative estimates (low end of published ranges).
   If no credible source exists, do NOT fabricate a benchmark.

3. RESEARCH COMPETITOR & ALTERNATIVE COSTS
   Estimate what the client would pay for alternatives:
   - Comparable agency/consultancy rates for similar scope
   - Internal build cost (team salaries × duration + overhead)
   - Cost of inaction (continued current spend, missed opportunities)
   - Big consultancy benchmark (Big 4, large SI pricing)
   Use industry rate surveys, published case studies, or salary data.

4. MODEL THE VALUE
   For each value driver, calculate: Current State × Improvement % = Annual Impact.
   Sum all drivers to get Total Projected Annual Value.
   The base fee for the VBP offer = the T&M total from the budget.
   Performance bonus pool = 20% of the base fee.
   ROI multiplier = Total Annual Value ÷ (Base + Max Bonus).

Do NOT post findings to Slack. Proceed directly to Step 4.
```

**Change 3: Add VBP section to Step 4 (was Step 3) offer structure**

In the `docs_write_sections` instruction block, after section `e` (Post-launch support) and before section `f` (page_break), insert:

```
f. heading level 1: "Alternative: Value-Based Partnership"

   - heading level 2: "Business Impact Analysis"
     + paragraph (2-3 sentences framing the value opportunity, reference client pain points)
     + table: Value Projection
       columns: Value Driver | Current State | Expected Improvement | Annual Impact | Source
       3-5 rows of project-specific value drivers from Step 3 research
       last row: Total Projected Annual Value
       headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
       totalRowBackground "#FD6027", totalRowTextColor "#FFFFFF"
     + paragraph (competitor/alternative cost comparison from EVC analysis, 2-3 sentences)

   - heading level 2: "Investment Structure"
     + table: Approach Comparison
       columns: Dimension | T&M Approach | Value-Based Partnership
       rows: Investment, Risk Allocation, Incentive Alignment, Scope Flexibility, Expected ROI
       headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
     + paragraph (base fee + performance bonus breakdown with € amounts and ROI multiplier)

   - heading level 2: "Success Metrics & Bonus Structure"
     + table: KPI → Bonus
       columns: KPI | Target | Measurement Method | Bonus Amount
       3-5 measurable project-specific KPIs from Step 3 analysis
       headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
     + paragraph (assessment timeline, measurement method, partial achievement note)

   - heading level 2: "Why Value-Based Pricing"
     + paragraph (3-4 sentences: aligned incentives, shared risk, outcome focus)
```

Then continue with the existing page_break + Next Steps sections (now sections g-h).

**Change 4: Update review checklist**

Add to the existing content checks:

```
10. Value-Based section: Does every row in the Value Projection table cite a specific source?
    Are the Annual Impact calculations mathematically correct?
    Does the base fee match the T&M budget total? Is the bonus pool 20% of base?
    Are KPIs measurable and project-specific (not generic)?
```

**Change 5: Update `skipSteps` handling**

The existing `skipSteps` array should accept `"value_discovery"` to allow skipping this step if needed (e.g., for quick estimates where VBP isn't appropriate).

---

## 5. Files Modified

| File | Changes |
|------|---------|
| `src/agents/orchestrator.ts` | Add Step 3 prompt, add VBP section to Step 4, renumber steps 3→4, 4→5, 5→6, update review checklist, update skipSteps handling |

No new files. No new MCP tools. No new dependencies. Prompt-only changes to the orchestrator.

---

## 6. Implementation Order

- [ ] Task 1: Add Step 3 (Value Discovery) prompt block to orchestrator
- [ ] Task 2: Renumber existing Steps 3→4, 4→5, 5→6 in the orchestrator prompt and all internal references
- [ ] Task 3: Add VBP section structure to Step 4 offer writing instructions (section f)
- [ ] Task 4: Update Step 4 review checklist with VBP validation rules
- [ ] Task 5: Add "value_discovery" to skipSteps handling
- [ ] Task 6: Verify `npx tsc --noEmit` passes
- [ ] Task 7: Test run — generate an offer and verify VBP section appears with cited benchmarks

---

## Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a data-driven value-based pricing alternative section to every generated offer, backed by a dedicated value discovery research step in the pipeline.

**Architecture:** Prompt-only changes to `src/agents/orchestrator.ts`. New Step 3 (Value Discovery) instructs the agent to research client business metrics, industry benchmarks, and competitor costs. New offer section (H1: "Alternative: Value-Based Partnership") presents a hybrid base + performance bonus model with cited ROI projections. Step numbering and progress tracking constants are updated accordingly.

**Tech Stack:** TypeScript (orchestrator prompt modifications only). No new dependencies.

---

### Task 1: Update STEP_NAMES and TOOL_TO_STEP constants

**Files:**
- Modify: `src/agents/orchestrator.ts:15-30`

**Step 1: Update STEP_NAMES**

Replace line 15:
```typescript
const STEP_NAMES = ["Starting", "Analysis", "Clarification", "Offer", "Presentation", "Knowledge Base"] as const;
```

With:
```typescript
const STEP_NAMES = ["Starting", "Analysis", "Clarification", "Value Discovery", "Offer", "Presentation", "Knowledge Base"] as const;
```

**Step 2: Update TOOL_TO_STEP**

Replace lines 17-30:
```typescript
const TOOL_TO_STEP: Record<string, number> = {
  search_similar_projects: 1,
  search_case_studies: 1,
  wait_for_reply: 2,
  docs_create_document: 3,
  docs_find_and_replace: 3,
  docs_write_sections: 3,
  create_presentation: 4,
  add_slide: 4,
  set_client_logo: 4,
  add_timeline_data: 4,
  add_pricing_block: 4,
  store_estimation: 5,
};
```

With:
```typescript
const TOOL_TO_STEP: Record<string, number> = {
  search_similar_projects: 1,
  search_case_studies: 1,
  wait_for_reply: 2,
  docs_create_document: 4,
  docs_find_and_replace: 4,
  docs_write_sections: 4,
  create_presentation: 5,
  add_slide: 5,
  set_client_logo: 5,
  add_timeline_data: 5,
  add_pricing_block: 5,
  store_estimation: 6,
};
```

Note: Step 3 (Value Discovery) uses `fetch_web_page` which is also used in Steps 1 and 5. We intentionally do NOT map `fetch_web_page` here — step detection will jump from Clarification to Offer, which is acceptable for the admin panel.

**Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: Pass

**Step 4: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(value-based-pricing): update step constants for new Value Discovery step"
```

- [ ] Done

---

### Task 2: Update skipSteps type and skip instructions

**Files:**
- Modify: `src/agents/orchestrator.ts:58,168-176`

**Step 1: Add value_discovery to skipSteps type**

Replace line 58:
```typescript
  skipSteps?: ("presentation" | "knowledge_base" | "slack")[];
```

With:
```typescript
  skipSteps?: ("presentation" | "knowledge_base" | "slack" | "value_discovery")[];
```

**Step 2: Update skip instructions with new step numbers and add value_discovery**

Replace lines 167-176:
```typescript
  const skipInstructions: string[] = [];
  if (job.skipSteps?.includes("slack")) {
    skipInstructions.push("Do NOT post anything to Slack. Do not use post_message or wait_for_reply. Focus only on generating the Google Doc offer.");
  }
  if (job.skipSteps?.includes("presentation")) {
    skipInstructions.push("SKIP Step 4 entirely — do not create a Google Slides presentation.");
  }
  if (job.skipSteps?.includes("knowledge_base")) {
    skipInstructions.push("SKIP Step 5 entirely — do not call store_estimation.");
  }
```

With:
```typescript
  const skipInstructions: string[] = [];
  if (job.skipSteps?.includes("slack")) {
    skipInstructions.push("Do NOT post anything to Slack. Do not use post_message or wait_for_reply. Focus only on generating the Google Doc offer.");
  }
  if (job.skipSteps?.includes("value_discovery")) {
    skipInstructions.push("SKIP Step 3 entirely — do not perform value discovery research. Do NOT include the 'Alternative: Value-Based Partnership' section in the offer.");
  }
  if (job.skipSteps?.includes("presentation")) {
    skipInstructions.push("SKIP Step 5 entirely — do not create a Google Slides presentation.");
  }
  if (job.skipSteps?.includes("knowledge_base")) {
    skipInstructions.push("SKIP Step 6 entirely — do not call store_estimation.");
  }
```

**Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: Pass

**Step 4: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(value-based-pricing): add value_discovery to skipSteps and update step numbers"
```

- [ ] Done

---

### Task 3: Insert Step 3 (Value Discovery) prompt block

**Files:**
- Modify: `src/agents/orchestrator.ts:239` (insert BEFORE current Step 3 line)

**Step 1: Insert the new Step 3 block**

Find this line (currently line 239):
```
## Step 3: Create the Google Doc Offer
```

Insert the following BEFORE it (the current Step 3 will be renumbered to Step 4 in the next task):

```
## Step 3: Value Discovery & Business Impact Analysis

Research the client's business and industry to build a data-driven value model.
This data will be used in the offer's value-based pricing alternative section.

1. RESEARCH THE CLIENT'S BUSINESS
   Use fetch_web_page to visit the client's website and search for:
   - Business model, revenue indicators, market position, scale (traffic, employees, market share)
   - Annual reports, press releases, investor data, earnings — any public financial data
   - Industry vertical and key business metrics (CVR, ARPU, churn, NPS, CAC, LTV as applicable)
   Cross-reference with the RFP for stated goals, pain points, and cost/budget references.

2. RESEARCH INDUSTRY BENCHMARKS
   Search for published data on typical improvements for this project type.
   Use fetch_web_page on credible sources: Forrester, Gartner, McKinsey, Deloitte,
   Google, Baymard Institute, Statista, platform vendor case studies (Vercel, Shopify, Contentful).

   Find 3-5 relevant benchmarks with specific numbers. Examples by project type:
   - Headless/CMS migration: "headless commerce conversion rate improvement study"
   - E-commerce: "page speed impact on revenue ecommerce", "mobile optimization conversion uplift"
   - Platform modernization: "legacy modernization TCO savings", "cloud migration cost reduction"
   - New product: "time to market competitive advantage software"

   CITATION RULES:
   - EVERY benchmark MUST cite: publication name, year, URL
   - Use conservative estimates (low end of published ranges)
   - Prefer data from 2024-2026 and named research firms
   - If no credible source exists for a claim, do NOT fabricate a benchmark

3. RESEARCH COMPETITOR & ALTERNATIVE COSTS
   Estimate what the client would pay for alternatives (EVC framework):
   - Comparable agency/consultancy rates for similar scope (use Clutch, GoodFirms, industry surveys)
   - Internal build cost estimate (team salaries × duration + hiring overhead + ramp-up time)
   - Cost of inaction (continued current spend, missed revenue opportunities, competitive disadvantage)
   - Big consultancy benchmark (Big 4 / Accenture / large SI typical pricing for comparable scope)
   Cite sources for rate data and salary benchmarks.

4. MODEL THE VALUE
   For each value driver, calculate: Current State × Improvement % = Annual Impact.
   Sum all drivers to get Total Projected Annual Value.
   Note: The base fee for the VBP offer will equal the T&M total from the budget table.
   Performance bonus pool = 20% of the base fee.
   ROI multiplier = Total Annual Value ÷ (Base + Max Bonus).
   Keep these numbers ready for Step 4.

Do NOT post findings to Slack. Proceed directly to Step 4.

```

**Step 2: Verify the file is syntactically valid**

```bash
npx tsc --noEmit
```

Expected: Pass (it's just a string change inside a template literal)

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(value-based-pricing): add Step 3 Value Discovery prompt block"
```

- [ ] Done

---

### Task 4: Renumber Step 3 → Step 4 and add VBP section to offer

**Files:**
- Modify: `src/agents/orchestrator.ts` (the "Step 3: Create the Google Doc Offer" section)

**Step 1: Renumber the heading**

Replace:
```
## Step 3: Create the Google Doc Offer
```

With:
```
## Step 4: Create the Google Doc Offer
```

**Step 2: Add VBP section to the docs_write_sections instruction**

Find these lines in the offer structure (section e through section g):
```
   e. heading level 2: "Post-launch support"
      - heading level 3: "Training" + paragraph
      - heading level 3: "Continuous development" + paragraph + bullet_list

   f. page_break

   g. heading level 1: "Next Steps"
      - paragraph (closing — 2 paragraphs: process to start, thank you)
      - divider
      - paragraph (contact: name, email, phone — alignment "END")
```

Replace with:
```
   e. heading level 2: "Post-launch support"
      - heading level 3: "Training" + paragraph
      - heading level 3: "Continuous development" + paragraph + bullet_list

   f. heading level 1: "Alternative: Value-Based Partnership"

      - heading level 2: "Business Impact Analysis"
        + paragraph: 2-3 sentences framing the value opportunity. Reference specific client
          pain points from the RFP and the value levers identified in Step 3.
        + table: Value Projection
          columns: Value Driver | Current State | Expected Improvement | Annual Impact | Source
          3-5 rows of project-specific value drivers from Step 3 research.
          Each "Source" cell must contain the publication name and year (e.g., "Forrester, 2025").
          Last row: "Total Projected Annual Value" with sum of Annual Impact column.
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB",
          totalRowBackground "#FD6027", totalRowTextColor "#FFFFFF"
        + paragraph: 2-3 sentences on competitor/alternative costs from EVC analysis.
          Frame as: "A comparable engagement with [alternative] would cost €X. Our value-based
          model delivers [Y]× that investment in projected annual returns."

      - heading level 2: "Investment Structure"
        + table: Approach Comparison
          columns: Dimension | T&M Approach | Value-Based Partnership
          rows:
            1. "Investment" | T&M total from budget table | VBP base fee + max bonus
            2. "Risk Allocation" | "Client bears scope and timeline risk" | "Shared — Blazity puts bonus at stake on outcomes"
            3. "Incentive Alignment" | "Vendor compensated for time spent" | "Both parties benefit from measurable outcomes"
            4. "Scope Flexibility" | "Flexible scope, variable cost" | "Fixed scope, performance-linked upside"
            5. "Expected ROI" | "N/A — priced on effort" | "[X]× projected return on first-year value"
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
        + paragraph: Investment breakdown:
          "**Base delivery fee: €X** — covers full project delivery including all phases, QA, and launch support."
          "**Performance bonus pool: €Y (20% of base)** — earned upon achievement of the success metrics below."
          "**Total maximum investment: €Z** — projected ROI of **[N]×** based on first-year value."
          Where X = T&M budget total, Y = X × 0.20, Z = X + Y, N = Total Annual Value ÷ Z.

      - heading level 2: "Success Metrics & Bonus Structure"
        + table: KPI → Bonus
          columns: KPI | Target | Measurement Method | Bonus Amount
          3-5 rows of project-specific, measurable KPIs. Choose KPIs relevant to the project type:
          - E-commerce: CVR improvement, page load time, Core Web Vitals, revenue per session
          - Platform migration: on-time delivery, zero critical incidents post-launch, infrastructure cost reduction
          - New product: MVP launch by target date, user adoption target, system uptime
          - Content platform: publishing workflow time reduction, SEO traffic improvement
          The bonus amounts must sum to the performance bonus pool (€Y).
          headerBackground "#FD6027", headerTextColor "#FFFFFF", borderColor "#E6E8EB"
        + paragraph: "Bonus assessment occurs at [3 or 6] months post-launch using [client analytics
          platform / independent audit / agreed measurement tool]. KPIs are assessed independently —
          partial achievement is possible."

      - heading level 2: "Why Value-Based Pricing"
        + paragraph: 3-4 sentences covering:
          1. Incentive alignment — "We succeed when you succeed"
          2. Shared risk — Blazity puts meaningful compensation at stake on outcomes
          3. Quality focus — rewards efficiency and results, not hours logged
          4. Partnership model — designed for clients who prioritize measurable business impact

   g. page_break

   h. heading level 1: "Next Steps"
      - paragraph (closing — 2 paragraphs: process to start, thank you)
      - divider
      - paragraph (contact: name, email, phone — alignment "END")
```

**Step 3: Update the review checklist**

Find the FORMATTING CHECKS section in the review block. After check 9 (Budget table total row), add:

```
VALUE-BASED PRICING CHECKS:
10. Value Projection table: Does every row have a cited source (publication + year) in the Source column? If any source is missing or says "estimated" — research and add a real source or remove that row.
11. Value math: Is the Annual Impact calculation correct for each row (Current State × Improvement %)? Does the Total row sum correctly?
12. Investment Structure: Does the base fee match the T&M budget total exactly? Is the bonus pool exactly 20% of the base fee? Is the ROI multiplier calculated correctly (Total Annual Value ÷ Total Maximum Investment)?
13. KPIs: Are all KPIs measurable with specific numeric targets? Do the bonus amounts sum to the performance bonus pool? Are KPIs specific to this project (not generic)?
```

**Step 4: Verify**

```bash
npx tsc --noEmit
```

Expected: Pass

**Step 5: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(value-based-pricing): add VBP section to offer and update review checklist"
```

- [ ] Done

---

### Task 5: Renumber Step 4 → Step 5 and Step 5 → Step 6

**Files:**
- Modify: `src/agents/orchestrator.ts` (Steps 4 and 5 headings)

**Step 1: Renumber the presentation step**

Replace:
```
## Step 4: Create the Visual Presentation
```

With:
```
## Step 5: Create the Visual Presentation
```

**Step 2: Renumber the knowledge base step**

Replace:
```
## Step 5: Store in Knowledge Base
```

With:
```
## Step 6: Store in Knowledge Base
```

**Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: Pass

**Step 4: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(value-based-pricing): renumber Steps 4→5, 5→6"
```

- [ ] Done

---

### Task 6: Add VBP section depth to SECTION DEPTH block

**Files:**
- Modify: `src/agents/orchestrator.ts:98-107` (SECTION DEPTH block)

**Step 1: Add VBP section depth guidelines**

Find the end of the SECTION DEPTH block (line 107):
```
- Next Steps: 80-120 words. Concrete process to kick off.
```

Add after it:
```
- Value-Based Partnership intro paragraph: 40-60 words. Reference specific client pain points.
- Value Projection table: 3-5 rows. Each row must cite a published source.
- Investment Structure paragraph: 60-80 words. Include exact € amounts and ROI multiplier.
- Success Metrics table: 3-5 KPIs. Each must be measurable with a specific numeric target.
- Why Value-Based Pricing: 60-80 words. Focus on aligned incentives and shared risk.
```

**Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: Pass

**Step 3: Commit**

```bash
git add src/agents/orchestrator.ts
git commit -m "feat(value-based-pricing): add VBP section depth guidelines"
```

- [ ] Done

---

### Task 7: Full verification

**Step 1: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: Pass with no errors.

**Step 2: Run tests**

```bash
npm test
```

Expected: All tests pass (no test changes needed — this is prompt-only).

**Step 3: Verify prompt structure**

Read through the full orchestrator file and verify:
- Steps are numbered 1 through 6 with no gaps or duplicates
- All `skipSteps` references use correct step numbers
- The VBP section is between "Post-launch support" (section e) and "Next Steps" (section h)
- Section letters run a through h without gaps
- The review checklist includes checks 10-13 for VBP

- [ ] Done

---

## Verification Checklist

After all tasks complete:

1. `npx tsc --noEmit` passes
2. `npm test` passes
3. `STEP_NAMES` has 7 entries: Starting, Analysis, Clarification, Value Discovery, Offer, Presentation, Knowledge Base
4. `TOOL_TO_STEP` maps Offer tools to 4, Presentation to 5, KB to 6
5. `skipSteps` type includes `"value_discovery"`
6. Prompt has 6 steps (Step 1 through Step 6) in order
7. Offer section has VBP content (section f) with 4 subsections
8. Review checklist has VBP checks (10-13)
9. Section depth block has VBP guidelines
