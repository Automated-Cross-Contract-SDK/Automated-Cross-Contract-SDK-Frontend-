## Summary

- Add property-based coverage for ledger-key XDR parsing, canonicalization, and malformed keys.
- Cover wallet rejection during restore and original signing, ensuring unsigned transactions are never submitted.
- Verify the successful restore, confirmation, rebuild, signing, and original submission flow.
- Align Svelte reset and batch-result behavior with the framework bindings' failure semantics.

## Validation

- `git diff --check` passed.
- Automated tests were not run because workspace dependencies are not installed.
- GitHub Actions checks need to run on the pull request.

Closes #546
Closes #545
Closes #544
Closes #543
