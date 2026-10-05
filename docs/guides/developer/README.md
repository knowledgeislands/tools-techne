# Develop tools-techne

`tools-techne` is a flat Bun/TypeScript CLI repository following the established `tools-ki` shape. Source and tests live under `src/`; `bin/techne` runs source locally, while release archives contain a compiled standalone executable and physical manual.

Use the repository's pinned Bun from its root and install its locked dependencies:

```sh
bun install --frozen-lockfile
```

- [Definition of done](definition-of-done.md) owns the canonical verification command list and Techne-specific review evidence; shared delivery requirements come from `ki-repo-tools`.
- [Release tools-techne](releasing.md) defines the first-release boundary and downstream Homebrew handoff.

Tests exercise `runCli(args, dependencies)` with injected subprocess responses. They must not contact AWS, Telegram or live infrastructure.

The definition of done installs the locked checker in `tooling/boundaries` with a supported TypeScript compiler. The boundary suite uses that checker rather than the product's TypeScript 7 and verifies both graph coverage and a real failing import; it performs no installation or network access itself.

Diagnostic tests inject executing host/runtime facts and prove provenance with isolated checkout, linked-entrypoint, worktree, and copied-source fixtures. Verify `diag` and `doctor` share the common context, default diagnostics redact local details, and every evaluated or skipped doctor check contributes once to its counts. Operational prerequisite failures must still produce a complete report without leaking raw provider output or implying package freshness.
