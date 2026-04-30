# Security Policy

Please do not report security vulnerabilities in public issues.

Report security concerns through GitHub private vulnerability reporting for this repository. If private vulnerability reporting is unavailable, contact the maintainers through the Blazity organization profile and do not disclose details publicly until a maintainer confirms the report path.

## Supported Versions

The project is pre-1.0. Security fixes target the latest `main` branch.

## Baseline Checks

Before release, maintainers run:

```bash
npm run typecheck
npm test
npm run audit:high
npm run scan:secrets
npm run check:mcp-isolation
```
