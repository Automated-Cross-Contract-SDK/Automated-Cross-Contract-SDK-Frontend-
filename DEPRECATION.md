# Deprecation Policy

This document describes how packages in this repository are deprecated, how
deprecations are communicated, and how consumers can pin to a safe version.

## Deprecating a package or version

1. Open an issue describing the reason for deprecation and the recommended
   replacement (if any).
2. Publish a deprecation notice with `npm deprecate <pkg>@<range> "<message>"`
   so the warning appears on install.
3. Update the package `README.md` with a deprecation banner and migration notes.
4. Announce the deprecation in the release notes for the next release.

## Migration notes

- Consumers should pin to the last supported version using an exact version or
  a caret range that excludes the deprecated release, e.g.
  `"<pkg>": "1.4.2"` or `"<pkg>": "^1.4.0"`.
- When a replacement package exists, document the mapping from old to new API
  in the deprecation message and README.
- Deprecations are not removals: deprecated versions remain installable, but
  emit a warning. Removal only happens in a major release.

## Interplay with rollbacks

If a release is broken and must be rolled back, follow the
[release rollback and incident-response runbook](./docs/guide/release-rollback-runbook.md).
That runbook covers how to direct consumers to a safe version, including
pinning guidance and deprecation of the broken release when appropriate.
