# SPEC-017: Admin Panel — Replace Auto-Refresh with Toggle + Date Indicator

## Problem

The admin dashboard's 3-second `<meta http-equiv="refresh">` triggers 429 rate limit errors despite the global rate limiter's `skip` function for `/admin` routes. The aggressive auto-refresh makes the panel unusable.

## Design

### 1. Auto-refresh toggle with 5-minute timeout

Replace `<meta http-equiv="refresh" content="3">` in both `dashboardHtml` and `logViewerHtml` with client-side JS:

- Toggle button in the header area (on by default)
- When on: `setInterval(() => location.reload(), 3000)`
- Auto-disables after 5 minutes (prevents stale tabs from hammering the server)
- Toggle state persisted via URL query param (`?refresh=0` to disable, default on)
- On auto-disable: button updates to show "paused" state

### 2. Increase global rate limit 10x

In `src/index.ts`, bump `limit` from `100` to `1000` per 15-minute window. Keep the admin skip as belt-and-suspenders.

### 3. Add "Started" date column

Both Active and Recent job tables get a "Started" column displaying `startedAt` as a short datetime (e.g., `Mar 3, 14:22`).

## Files

- `src/admin/routes.ts` — toggle UI + JS, date column, remove meta refresh
- `src/index.ts` — bump rate limit to 1000

## Plan

- [x] Remove `<meta http-equiv="refresh" content="3">` from `dashboardHtml` and `logViewerHtml`
- [x] Add inline `<script>` with auto-refresh toggle logic (3s interval, 5min timeout, query param persistence)
- [x] Add toggle button UI to dashboard header and log viewer header
- [x] Add `formatDate` helper function for short datetime format
- [x] Add "Started" column to Active jobs table (header + row)
- [x] Add "Started" column to Recent jobs table (header + row)
- [x] Bump global rate limit from 100 to 1000 in `src/index.ts`
- [x] Verify: `npx tsc --noEmit`
- [x] Verify: `npm test`
