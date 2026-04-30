# Specifications

Numbered specs drive implementation. Each spec has a design (requirements/architecture) and an implementation plan (step-by-step tasks with `- [ ]` markers).

## Naming

- `SPEC-NNN-short-name.md` — OSS specs
- Design and plan live in the same file (this is a single-service project, not a monorepo)

## Spec Index

| # | Name | Status | Date |
|---|------|--------|------|
| SPEC-001 | Offer Styling & Content Quality | Implemented | 2026-02-27 |
| SPEC-002 | Google Slides Presentation | Implemented | 2026-02-28 |
| SPEC-003 | Offer Formatting Fixes | Planning | 2026-03-01 |
| SPEC-004 | Slack Formatting | Planning | 2026-03-01 |
| SPEC-005 | Drive File Ingestion | Implemented | 2026-02-26 |
| SPEC-006 | Offer Quality & Formatting | Implemented | 2026-02-27 |
| SPEC-007 | Docs Formatting Repair | Implemented | 2026-02-27 |
| SPEC-008 | Expertise Enrichment | Implemented | 2026-02-27 |
| SPEC-009 | PDF Fix & Reliability | Implemented | 2026-02-27 |
| SPEC-010 | Prompt Flow Fix | Implemented | 2026-02-27 |
| SPEC-011 | Table Population Fix | Implemented | 2026-02-27 |
| SPEC-012 | Admin Panel | Implemented | 2026-02-27 |
| SPEC-013 | AI Directory Setup | Implemented | 2026-02-28 |
| SPEC-014 | Value-Based Pricing Alternative | Implemented | 2026-03-01 |
| SPEC-015 | Performance & AI-Readiness | Implemented | 2026-03-01 |
| SPEC-016 | Security Hardening | Planning | 2026-03-01 |
| SPEC-017 | Admin Refresh Fix | Implemented | 2026-03-03 |
| SPEC-018 | Slides Duplicate Fix | Implemented | 2026-03-03 |
| SPEC-019 | Multi-Round Clarification Loop | Implemented | 2026-03-03 |
| SPEC-020 | Graceful Shutdown & Stall Recovery | Implemented | 2026-03-03 |
| SPEC-021 | Estimation Quality & Voice Overhaul | Implemented | 2026-03-03 |
| SPEC-022 | Google Drive Knowledge Base Migration | Implemented | 2026-03-04 |
| SPEC-023 | Codex PR Review Integration | Planning | 2026-03-05 |
| SPEC-024 | Drive Folder Link Ingestion | Implemented | 2026-03-06 |
| SPEC-025 | Estimation Sheet Separation | Implemented | 2026-03-06 |
| SPEC-026 | Man-Days Per Action Item | Implemented | 2026-03-11 |
| SPEC-027 | Estimation Independence & Sanity Check | Implemented | 2026-03-11 |
| SPEC-028 | Unmerge Template Cells After Copy | Implemented | 2026-03-11 |
| SPEC-029 | Complexity-Aware Estimation Tiers | Implemented | 2026-03-11 |
| SPEC-030 | Simplified Roles + Team Size & Calendar Days | Implemented | 2026-03-11 |
| SPEC-031 | Estimation Quality Rules from User Feedback | Implemented | 2026-03-11 |
| SPEC-032 | Fix Grid Limit, Add Web Search, Reduce Token Overflow | Implemented | 2026-03-11 |
| SPEC-033 | Assumption-Capped Clarification Loop | Implemented | 2026-03-11 |
| SPEC-034 | Per-Job Cost Tracking + Remove Auto-Refresh | Implemented | 2026-03-11 |
| SPEC-035 | Context Pressure Reduction — RFP via Drive + Disable Session Persistence | Implemented | 2026-03-11 |
| SPEC-036 | Remove Presentation Step + Fix Rounding | Implemented | 2026-03-12 |
| SPEC-037 | Token Optimization + Pinecone Data Quality | Planning | 2026-03-12 |
| SPEC-038 | Proposal Document Restructure | Planning | 2026-03-12 |
| SPEC-039 | Proposal Quality Fixes — Content, Pricing & Calibration | Implemented | 2026-03-16 |
| SPEC-040 | Estimation Sheet Format — 9-Column Layout with Module Subtotals | Implemented | 2026-03-16 |
| SPEC-041 | Slack PDF/DOCX OCR Conversion + File Manifest | Implemented | 2026-03-16 |
| SPEC-042 | Estimation Quality Fixes v2 — Calibration, Team Sizing, Types, Sheet Format | Implemented | 2026-03-17 |
| SPEC-043 | Vercel Ash Rebuild — New Repository, Parallel Cutover | Planning | 2026-04-29 |

## Workflow

1. **Before coding** — write or read the spec
2. **During coding** — update `- [ ]` / `- [x]` markers as tasks complete
3. **After coding** — update spec status in this index
