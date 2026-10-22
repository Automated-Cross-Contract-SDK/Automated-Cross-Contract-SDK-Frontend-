# SDK API Reference

This page documents the public SDK surface and the compatibility guarantees that
apply across releases. For upgrade instructions between major versions, see the
[Migration Guide](#migration-guide) section below.

## Stability and versioning

The SDK follows [Semantic Versioning](https://semver.org/):

- **Patch** (`x.y.Z`) — bug fixes only; no API changes.
- **Minor** (`x.Y.z`) — backwards-compatible additions (new methods, optional
  parameters, new exports). Existing code keeps working.
- **Major** (`X.y.z`) — may include breaking changes. Read the
  [Migration Guide](#migration-guide) before upgrading.

Anything not documented on this page (internal modules, `_`-prefixed helpers,
undocumented fields on returned objects) is **not** part of the public API and
may change in any release.

## Migration policy

When a major version is released:

1. **Deprecation first.** A public API is deprecated for at least one minor
   release before it is removed in a major release. Deprecated APIs emit a
   runtime warning and are annotated `@deprecated` in the type definitions.
2. **Documented replacements.** Every deprecation names its replacement in the
   warning message and in the migration notes for the release.
3. **Support window.** The previous major version receives critical bug and
   security fixes for **6 months** after the next major is published.
4. **No silent breakage.** Breaking changes are listed in the release notes and
   in the migration guide for that major version.

## Migration guide

### Upgrading to the next major version

1. **Read the release notes** for the target major version and note every item
   marked *breaking*.
2. **Update the dependency** in your manifest:

   ```bash
   npm install @your-scope/sdk@latest
   ```

3. **Resolve deprecation warnings.** Run your test suite and fix any warnings
   emitted by deprecated APIs using the documented replacements.
4. **Update type errors.** Breaking type changes surface as compile errors;
   follow the inline `@deprecated` notes and the migration notes below.
5. **Verify behavior.** Run your integration tests against the new version,
   paying attention to the boundary cases called out in the release notes.

### API changes between major versions

| Area | Change | Replacement |
| --- | --- | --- |
| Client construction | Options object is now required | Pass a config object to the client factory |
| Error handling | Errors are typed subclasses | Match on the error `code` field |
| Async APIs | Callback parameters removed | Use the returned `Promise` |

> The table above is updated with each major release. If your version is not
> listed, consult the release notes for that version.

### Deprecations and replacements

Deprecated APIs remain available for at least one minor release. Each entry
below lists the deprecated API and the replacement to migrate to:

| Deprecated | Replacement | Removal |
| --- | --- | --- |
| Callback-style async methods | `Promise`-returning methods | Next major |
| Untyped error strings | Typed error `code` values | Next major |
| Positional constructor arguments | Options object | Next major |

## Compatibility notes

- **Runtime:** the SDK targets the Node.js LTS releases and modern evergreen
  browsers. Check the release notes for the minimum supported runtime of each
  major version.
- **Peer dependencies:** major versions may bump peer dependency ranges; align
  them when upgrading.
- **Serialized data:** persisted data written by an older major version is
  readable by the next major version unless the release notes state otherwise.
  Downgrading across a major version is not supported.
