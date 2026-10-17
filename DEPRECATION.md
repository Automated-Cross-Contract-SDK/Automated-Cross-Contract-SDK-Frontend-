# Deprecation policy

This policy applies to public APIs exported from the documented package entry
points. Internal modules and unexported implementation details are not covered;
see [SUPPORT.md](./SUPPORT.md) for the package support and compatibility policy.

## Procedure

1. **Announce the change.** Open or update a public issue and identify the
   affected package/API. Add a deprecation notice to the API documentation and
   release notes, with the replacement and migration instructions.
2. **Mark and warn.** Mark the declaration `@deprecated` with the planned
   removal and replacement. When the deprecated API is used, emit a warning
   through the configured SDK `logger.warn` and include the replacement. The
   default logger is a no-op, so applications that need runtime notices should
   inject a logger.
3. **Keep it through the next major.** Leave the deprecated API available for
   the remainder of its current major line. Remove it in the next major
   release, update migration documentation, and call out the removal in that
   release's changelog.

In the `0.x` pre-1.0 phase, minor releases may contain breaking changes as
described in [SUPPORT.md](./SUPPORT.md). The project will still announce
planned removals and provide migration notes where practical, but a deprecation
period is not a guarantee that every pre-1.0 breaking change will have existed
for a full minor release. From `1.0.0` onward, removal of a public API follows
the major-release procedure above.
