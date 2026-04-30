# Phase 0 Notes

Phase 0 created a clean repository baseline from the internal estimator.

## Verification

- Typecheck: PASS, `npm run typecheck` exited 0 after rerun outside the sandbox.
- Tests: PASS, `npm test` reported 195 passing tests, 0 failures.
- MCP isolation: PASS, `npm run check:mcp-isolation` exited 0.
- Dependency audit: FAIL, `npm audit --audit-level=high` reported 9 vulnerabilities: 5 high and 4 moderate.

## Sanitization Scan Results

- Obvious secrets scan: REVIEW NEEDED. Matches were placeholder/test strings only: `xoxb-...`, `sk-ant-test`, and `xoxb-test`.
- Private/local config scan: PASS, no `.env`, `.claude`, `.vercel`, or `workspace` paths found.
- Company-specific scan: FAIL. The copied source still contained internal agency prompt, script, user-agent, and case-study references at the end of Phase 0.

## Known Follow-Up Work

- Remove or externalize company-specific prompt content.
- Replace Express/BullMQ runtime with Vercel-first runtime.
- Fix dependency audit findings or document accepted exceptions.
- Complete agency profile loading.
- Complete public README and setup flow.
- Add secret scanning to CI.
