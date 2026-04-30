# Security Policy

Please do not report security vulnerabilities in public issues.

For now, report security concerns privately to the repository maintainer. The public contact channel will be finalized before the first public release.

## Supported Versions

The project is pre-1.0. Security fixes target the latest `main` branch.

## Baseline Checks

Before release, maintainers run:

```bash
npm run typecheck
npm test
npm audit --audit-level=high
npm run check:mcp-isolation
```
