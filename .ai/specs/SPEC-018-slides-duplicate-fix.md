# SPEC-018: Fix Slides — Duplicate Template Slides Instead of Layout Instantiation

## Problem

`add_slide` calls `getLayouts()` which reads `presentation.layouts[].layoutProperties.displayName` looking for custom names (COVER, SECTION_DIVIDER, etc.). These are master-level layouts — the template only has regular slides (`tmpl_cover`, `tmpl_section_divider`, etc.) created by `build-slides-template.ts`. The layout map comes back empty, every `add_slide` fails silently, and the presentation ends up blank.

Secondary issue: orchestrator only logs `tool_use` blocks, not `tool_result`, so MCP errors are invisible in job logs.

## Design

### Core fix: duplicate template slides

`create_presentation` copies the template, so the 6 template slides (`tmpl_cover`, `tmpl_section_divider`, `tmpl_dark_content`, `tmpl_light_content`, `tmpl_pricing`, `tmpl_timeline`) already exist in the copied presentation.

`add_slide` will:
1. Map layout name → known template slide ID (static map, no API call)
2. `duplicateObject` the template slide → new slide with new ID
3. Move the new slide to the end with `updateSlidesPosition`
4. Clear `{{PLACEHOLDER}}` tokens and fill with actual content (existing fill logic)

After all slides are added, `cleanup_template_slides` deletes the 6 `tmpl_*` originals.

### Tool-result logging

Log `tool_result` messages in the orchestrator event loop so MCP errors appear in job logs.

## Files

- `src/mcp-servers/google-slides.ts` — replace `getLayouts` + `createSlide` with `duplicateObject`, add `cleanup_template_slides` tool
- `src/agents/orchestrator.ts` — add `cleanup_template_slides` to allowlist + TOOL_TO_STEP, prompt instruction, tool-result logging

## Plan

- [x] Replace `getLayouts()` with static `TEMPLATE_SLIDE_IDS` map in `google-slides.ts`
- [x] Rewrite `add_slide` to use `duplicateObject` + `updateSlidesPosition` instead of `createSlide` with `slideLayoutReference`
- [x] In `add_slide`, clear placeholder text in duplicated slide before filling (delete existing text, then insert)
- [x] Add `cleanup_template_slides` tool that deletes the 6 `tmpl_*` slides from a presentation
- [x] Add `cleanup_template_slides` to orchestrator: TOOL_TO_STEP (step 5), allowed tools list
- [x] Add prompt instruction: "After adding all slides, call cleanup_template_slides to remove the template placeholder slides"
- [x] Add `tool_result` logging in orchestrator event loop (alongside existing `tool_use` logging)
- [x] Verify: `npx tsc --noEmit`
- [x] Verify: `npm test`
