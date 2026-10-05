# Develop tools-techne

`tools-techne` is a flat Bun/TypeScript CLI repository following the established `tools-ki` shape. Source and tests live under `src/`; `bin/techne` runs source locally, while release archives contain a compiled standalone executable and physical manual.

Use the repository's pinned Bun from its root and install its locked dependencies:

```sh
bun install --frozen-lockfile
```

- [Definition of done](definition-of-done.md) owns the canonical verification command list and Techne-specific review evidence; shared delivery requirements come from `ki-repo-tools`.
- [Release tools-techne](releasing.md) defines the first-release boundary and downstream Homebrew handoff.

Tests exercise `runCli(args, dependencies)` with injected subprocess responses. They must not contact AWS, Telegram or live infrastructure.

Diagnostic tests inject executing host/runtime facts and local, release, or unknown provenance. Verify `diag` and `doctor` share the common context, default diagnostics redact local details, and every evaluated or skipped doctor check contributes once to its counts. Operational prerequisite failures must still produce a complete report without leaking raw provider output or implying package freshness.
