# Develop tools-techne

`tools-techne` is a flat Bun/TypeScript CLI repository following the established `tools-ki` shape. Source and tests live under `src/`; `bin/techne` runs source locally, while release archives contain a compiled standalone executable and physical manual.

Use Bun `1.4.1` from the repository root:

```sh
bun install
bun run test
bun run test:coverage
bun run self:typecheck
bun run build
```

- [Definition of done](definition-of-done.md) defines required implementation and review evidence.
- [Release tools-techne](releasing.md) defines the first-release boundary and downstream Homebrew handoff.

Tests exercise `runCli(args, dependencies)` with injected subprocess responses. They must not contact AWS, Telegram or live infrastructure.
