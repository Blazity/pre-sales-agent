# SPEC-008: Expertise Enrichment

**Status:** Implemented
**Date:** 2026-02-27

---

# Expertise Enrichment — Design

## Problem

The agent produces generic offers with no company identity, no relevant case studies, and no ecosystem expertise. It says "a software agency" instead of "Blazity." It can't cite past work or position the team as Next.js specialists. The output reads like any vendor — not like a Vercel partner with 9 case studies and a Deloitte Fast 50 recognition.

## Goal

Offers that:
- Speak as Blazity with a clear, confident voice
- Cite the 1-2 most relevant Blazity case studies with hard metrics
- Demonstrate Next.js ecosystem fluency using live Vercel/Next.js data
- Include a tailored "Why Blazity" section that connects past work to the current RFP
- Position Blazity as the expert partner, not a generic vendor

## Solution Overview

| Layer | Source | Storage | Retrieval |
|-------|--------|---------|-----------|
| Company identity | Hand-written | System prompt (static) | Always present |
| Past offers | Google Docs | Pinecone + Drive | Vector search → read full doc |
| Blazity case studies | blazity.com/case-studies | Pinecone (structured metadata) | `search_case_studies` with filters |
| Ecosystem knowledge | nextjs.org, vercel.com | Live fetch | `fetch_web_page` at runtime |

---

## 1. Blazity Identity in System Prompt

**File:** `src/agents/orchestrator.ts`

Add a static identity block to `systemPrompt`:

```
COMPANY IDENTITY — You are writing offers on behalf of Blazity.

Blazity is a group of Next.js architects that helps organizations build, optimize,
and deploy high-performance Next.js and React applications at scale.

Key credentials:
- Official Vercel partner
- Deloitte Technology Fast 50 Central Europe (2023 & 2024)
- Clients include Vercel, Tom Tailor, Solana, Contentful, CookUnity, Planday, Encoura
- Open source: next-enterprise (7.3K+ GitHub stars), enterprise-commerce, next-saas-starter

Core services: Next.js platform development, performance engineering, legacy-to-Next.js
migration, headless CMS migration, AI agent development, generative UI.

When writing offers, speak as Blazity — "we", "our team", "our experience." Never
say "the agency" or "the company." Position Blazity as the expert partner, not a
generic vendor. For non-Next.js projects, acknowledge the different stack while still
highlighting our broader frontend and full-stack expertise.
```

~150 tokens. Always present, never stale for core facts.

---

## 2. Case Study Seeding & Retrieval

### 2a. Scrape Script

**File:** `scripts/seed-case-studies.ts`

Scrapes each Blazity case study from blazity.com:

1. Fetch `https://blazity.com/case-studies` → extract list of case study URLs
2. For each URL, fetch the detail page → extract full text content
3. Categorize with structured metadata:

```typescript
interface CaseStudyMeta {
  title: string;              // "CookUnity"
  type: "case_study";
  source: "blazity.com";
  url: string;                // "https://blazity.com/case-studies/cookunity"
  industry: string;           // "food-tech" | "saas" | "media" | "real-estate" | "fintech" | "e-commerce" | "ai"
  problem_type: string;       // "migration" | "greenfield" | "performance" | "modernization"
  tech_stack: string;         // "Next.js, Shopify"
  key_metric: string;         // "70% LCP improvement, double-digit conversion gains"
}
```

4. Chunk the full text, embed with voyage-3, upsert to Pinecone with metadata

**Industry and problem_type classification:** use a simple mapping in the script based on known case studies. For new/unknown case studies found during refresh, fall back to parsing keywords from the page text.

**Known case studies and their metadata:**

| Client | Industry | Problem Type | Key Metric |
|--------|----------|-------------|------------|
| CookUnity | food-tech | migration | 70% LCP improvement, double-digit conversion gains |
| Iberion | media | migration | 30% perf boost, 150M+ monthly visits, zero downtime |
| Planday | saas | modernization | 4x faster development speed |
| Encoura | education | modernization | 10x faster page creation |
| ArthurAI | ai | modernization | 48x faster onboarding (8h → 10min) |
| Vibes | martech | greenfield | BFF architecture, autonomous development |
| Dropsy | e-commerce | greenfield | 250K users in month 1, 1M+ downloads |
| Unreal Estate | real-estate | greenfield | 3M listings, 800% SEO growth |
| Speechmatics | ai | performance | AI agent, voice commands, optimized performance |

### 2b. New Search Tool: `search_case_studies`

**File:** `src/mcp-servers/knowledge-base.ts`

```
search_case_studies(
  query: string,
  industry?: string,
  problem_type?: string,
  top_k?: number = 3
)
```

Searches Pinecone with vector similarity + metadata filter:
- `type: "case_study"` (always)
- `industry` filter (if provided)
- `problem_type` filter (if provided)

Returns structured results with full metadata including `key_metric` and `url`.

### 2c. Refresh Script

**File:** `scripts/refresh-case-studies.ts`

Same logic as `seed-case-studies.ts` but designed for periodic re-runs:
- Deletes existing `case_study` vectors in Pinecone before re-inserting (clean refresh)
- Can be wired to a cron job or run manually after adding new case studies to the website

For simplicity, `refresh-case-studies.ts` can just re-export and call the same core function from `seed-case-studies.ts` with a `deleteExisting: true` flag.

---

## 3. Web Fetch MCP Tool

**File:** `src/mcp-servers/web-research.ts`

New MCP server with one tool: `fetch_web_page`.

### Tool Signature

```
fetch_web_page(
  url: string,
  extract_prompt?: string
)
```

### Behavior

1. Validate URL against allowlist:
   - `blazity.com`
   - `nextjs.org`
   - `vercel.com`
   - `github.com/blazity`
   - Reject all other domains with clear error message

2. Fetch the URL with a standard User-Agent header

3. Convert HTML to text:
   - Strip `<script>`, `<style>`, `<nav>`, `<footer>` tags
   - Preserve heading structure (H1-H3 → markdown headings)
   - Preserve list items (→ markdown bullets)
   - Preserve table structure (→ markdown tables)
   - Strip all other tags, keep text content

4. If `extract_prompt` is provided:
   - Send the page text to Claude Haiku with the prompt
   - Return the extracted/summarized content (keeps token usage low for the main agent)
   - Model: `claude-haiku-4-5-20251001`, max_tokens: 2000

5. If no `extract_prompt`:
   - Return raw text, truncated to 10,000 characters with notice

### Environment

- `ANTHROPIC_API_KEY` — only needed if `extract_prompt` is used (for Haiku call)
- No other credentials needed

### MCP Server Config

```typescript
"web-research": {
  command: "node",
  args: [path.join(ROOT, "dist/mcp-servers/web-research.js")],
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
  },
}
```

---

## 4. New Offer Sections

### 4a. "Why Blazity" Section

**Placement:** After Scope, before Team.

**Content structure:**
1. **Tailored expertise paragraph** (2-3 sentences) — connects Blazity's specific experience to this RFP's domain, tech stack, and challenge. References a specific past client/metric.
2. **Relevant credentials** (1-2 sentences) — picks the most relevant from: Vercel partnership, Deloitte Fast 50, open-source work, client list.
3. **Ecosystem context** (1 sentence) — cites Next.js/Vercel ecosystem adoption in the RFP's industry, sourced from live web fetch. Frames the tech choice as industry-validated.

**Example output:**
> Blazity has delivered Next.js solutions for 9 companies across e-commerce, SaaS, and media — including a migration for CookUnity's subscription funnel that improved Largest Contentful Paint by 70% and drove double-digit conversion gains. As an official Vercel partner and Deloitte Fast 50 company, we bring framework-level expertise combined with a proven delivery track record. Next.js has become the standard for high-performance e-commerce platforms, powering brands like Nike, PAIGE, and Shopify storefronts globally.

### 4b. "Relevant Case Study" Section

**Placement:** Immediately after "Why Blazity".

**Content structure:**
1. **Client + problem** — one sentence
2. **What we did** — 2-3 sentences on approach
3. **Results** — hard metrics from the case study
4. **Relevance** — one sentence connecting this case study to the current RFP

**Example output:**
> **Case Study: CookUnity — Next.js Migration for Revenue-Critical Funnel**
>
> CookUnity needed to migrate their subscription funnel from a legacy stack to Next.js without disrupting their revenue stream. We executed the migration over 3 months, implementing server-side rendering for the checkout flow and optimizing Core Web Vitals across the entire funnel.
>
> **Results:** 70% improvement in Largest Contentful Paint, double-digit conversion rate increase.
>
> This project mirrors your requirement for a high-performance e-commerce migration with strict uptime requirements during the transition period.

---

## 5. Orchestrator Prompt Changes

**File:** `src/agents/orchestrator.ts`

### 5a. System Prompt

Add the Blazity identity block from Section 1 to the end of `systemPrompt`.

### 5b. Step 1 Enhancement

Add to existing Step 1 (after RAG search):

```
4. Search for relevant Blazity case studies using search_case_studies. Use the
   RFP's industry and problem type as filters (e.g., industry="e-commerce",
   problem_type="migration"). Note the most relevant case study for later use.
```

### 5c. New Sub-Step in Step 3

Insert between Scope and Team in the offer creation flow:

```
EXPERTISE POSITIONING (after writing Scope, before Team):
1. Retrieve the most relevant Blazity case study from Step 1 results.
   If no good match was found, search again with broader terms.
2. Fetch 1-2 relevant pages from vercel.com/customers or nextjs.org/showcase
   using fetch_web_page to find ecosystem adoption data relevant to the RFP's
   industry. Use extract_prompt to focus on key metrics and company names.
3. Write a "Why Blazity" section using docs_write_sections:
   - heading level 2: "Why Blazity"
   - paragraph: tailored expertise (cite specific past client + metric) +
     credentials (Vercel partner, Deloitte, open source) +
     ecosystem context (1 sentence citing industry adoption from web fetch).
   - Be SPECIFIC. Never write "we have extensive experience." Instead write
     "we delivered X for Y, achieving Z."
4. Write a "Relevant Case Study" section:
   - heading level 2: "Relevant Case Study: [Client Name]"
   - paragraph: client + problem (1 sentence)
   - paragraph: approach (2-3 sentences)
   - paragraph with bold metrics: results
   - paragraph: why this is relevant to the current RFP (1 sentence)
```

### 5d. Updated Section Order in Offer

The complete offer section order becomes:
1. Executive Summary
2. Scope
3. Tech Stack
4. **Why Blazity** (new)
5. **Relevant Case Study** (new)
6. Team
7. Timeline
8. Pricing
9. Terms

### 5e. Updated Offer Writing Standards

Add to the existing OFFER WRITING STANDARDS block:

```
- Why Blazity: 3-5 sentences. MUST reference a specific past client with a real metric.
  MUST include ecosystem context. Never generic.
- Relevant Case Study: Executive summary format — client, problem, approach, results,
  relevance to current RFP. Use real metrics from search_case_studies results.
```

### 5f. New MCP Server + Allowed Tools

Add `web-research` to mcpServers config. Add these to allowedTools:
- `mcp__knowledge-base__search_case_studies`
- `mcp__web-research__fetch_web_page`

---

## 6. Offer Section Self-Review Update

Update the self-review checklist in Step 3 to include the new sections:

```
- [ ] Why Blazity references a specific past client with a real metric
- [ ] Why Blazity includes ecosystem context (not just Blazity credentials)
- [ ] Relevant Case Study has client, problem, approach, results, and relevance
- [ ] Case study metrics are real (from search_case_studies, not fabricated)
```

---

## Implementation Order

- [x] **Task 1:** Add Blazity identity block to orchestrator system prompt
- [x] **Task 2:** Create `scripts/seed-case-studies.ts` — scrape blazity.com/case-studies, parse, categorize, chunk, embed, upsert to Pinecone
- [x] **Task 3:** Add `search_case_studies` tool to knowledge-base MCP server with industry/problem_type filters
- [x] **Task 4:** Create `src/mcp-servers/web-research.ts` — fetch_web_page with allowlist + optional Haiku extraction
- [x] **Task 5:** Create `scripts/refresh-case-studies.ts` — re-scrape + upsert (re-use seed logic with delete-first)
- [x] **Task 6:** Update orchestrator Step 1 — add case study search after RAG search
- [x] **Task 7:** Update orchestrator Step 3 — add expertise positioning sub-step (Why Blazity + Case Study sections)
- [x] **Task 8:** Update offer writing standards with new section depth requirements
- [x] **Task 9:** Update self-review checklist with new section checks
- [x] **Task 10:** Add web-research MCP server config + new allowed tools to orchestrator
- [x] **Task 11:** Write tests for web-research MCP (allowlist enforcement, HTML-to-text conversion)
- [x] **Task 12:** Write tests for search_case_studies (metadata filtering, result formatting)
- [x] **Task 13:** Full build verification (npx tsc --noEmit + node --test)

## Files Modified / Created

| File | Changes |
|------|---------|
| `src/agents/orchestrator.ts` | Identity block, Step 1 enhancement, Step 3 expertise sub-step, new MCP config, updated allowedTools, updated writing standards, updated self-review |
| `src/mcp-servers/knowledge-base.ts` | New `search_case_studies` tool |
| `src/mcp-servers/web-research.ts` | **New:** fetch_web_page with allowlist + Haiku extraction |
| `scripts/seed-case-studies.ts` | **New:** scrape blazity.com → Pinecone |
| `scripts/refresh-case-studies.ts` | **New:** re-scrape wrapper with delete-first |
| `src/mcp-servers/web-research.test.ts` | **New:** tests for allowlist, HTML parsing |
| `src/mcp-servers/knowledge-base.test.ts` | New tests for search_case_studies |

## Dependencies

- No new npm packages — uses native `fetch` for web scraping
- `ANTHROPIC_API_KEY` passed to web-research MCP server for optional Haiku extraction
- Pinecone index must support metadata filtering (already does — serverless indexes support this)
- Case studies must be scraped at least once before first estimation run
