# SDK Support Policy

## Overview

This document defines which release lines receive bug fixes, security patches, and how long they are supported.

## Release Naming

- **Major.Minor.Patch** (e.g., `2.1.3`)
- **Latest** = current stable release
- **Previous** = one major version back
- **Active LTS** = long-term support line (if declared)

## Support Timeline

| Release Line | Release Date | Bug Fixes | Security | Support Ends |
|---|---|---|---|---|
| 2.x (Current) | Oct 2024 | ✅ Active | ✅ Active | Oct 2025 |
| 1.x (Previous) | Oct 2023 | ⚠️ Critical Only | ✅ Active | Oct 2024 |
| 0.x (Legacy) | 2023 | ❌ No | ❌ No | EOL |

## What Gets Fixed

### Bug Fixes (Current Release)
- Crashes, memory leaks, data loss
- Incorrect behavior vs. documented API
- Performance regressions
- Compatibility issues with dependencies

### Security Patches (All Active Lines)
- Authentication/authorization bypass
- Data exposure or injection vulnerabilities
- Dependency CVEs affecting the SDK

### Critical Fixes (Previous Release)
- Security vulnerabilities only
- Crashes in core functionality
- Data loss issues

### Not Fixed
- Deprecated APIs (use migration guide)
- Features missing from current version
- Changes to undocumented behavior
- Performance improvements (backport to latest instead)

## How to Report Issues

### Security Issues
- **DO NOT** open public GitHub issues
- Email: security@example.com
- Include: SDK version, reproduction steps, impact assessment
- Response time: 24-48 hours

### Bug Reports
- Open issue on GitHub with:
  - SDK version (`npm list @sdk/core`)
  - Reproduction case (preferably minimal)
  - Error logs/stack trace
  - Environment (Node/browser version, OS)
  - Expected vs. actual behavior

### Support Questions
- Check [docs/](./docs/) first
- Ask on GitHub Discussions (not Issues)
- Review [MIGRATION.md](./MIGRATION.md) for version upgrades

## Version Security Advisories

### Current Security Status

- **2.1.x**: No known vulnerabilities
- **2.0.x**: 1 low-severity CVE (fixed in 2.1.x)
- **1.x**: No new vulnerabilities (EOL 2024-10)

Subscribe to security updates:
- GitHub: Watch releases → filter "security"
- Email: Subscribe via https://example.com/security-alerts

## Migration & Upgrading

### From 1.x to 2.x
- See [MIGRATION.md](./MIGRATION.md)
- Breaking changes in: Event types, API surface
- Deprecation warnings added in 1.10+

### Staying Current
- Minor versions are backward compatible (within major)
- Patch versions are always safe upgrades
- Test in CI/CD before deploying to production

## Support Tiers

| Tier | Response Time | Includes |
|---|---|---|
| Community | Best effort | Bug reports, discussions |
| Business | 24 hours | Bug reports, security patches, private support |
| Enterprise | 4 hours | Everything above + custom SLA, priority fixes |

For Business/Enterprise support: enterprise@example.com

## Deprecation Process

1. **Warning** - Feature marked deprecated in release notes (1 minor version notice)
2. **Grace Period** - Still works, but with console warnings (2 minor versions)
3. **Removal** - Removed in next major version

Example:
- 1.5: Feature X deprecated
- 1.6-1.7: Works with warnings
- 2.0: Feature X removed

All deprecations documented in [DEPRECATION.md](./DEPRECATION.md).

## Long-Term Support (LTS)

No LTS line currently declared. If you need extended support:
- Email: lts@example.com with business case
- Available for security patches only
- Requires Enterprise support agreement

## End of Life (EOL)

- **1.x EOL**: October 31, 2024
- **0.x EOL**: December 31, 2023

After EOL: no bug fixes, security patches, or support.

## Questions?

- Check [SUPPORTING_POLICY.md](#) (this file)
- Email: support@example.com
- GitHub Discussions: github.com/Kingsman-99/Automated-Cross-Contract-SDK-Frontend-/discussions
