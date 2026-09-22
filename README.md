# tools-techne

`tools-techne` is the canonical source of the `techne` operator command-line interface for the Knowledge Islands Techne Harness.

Techne Principal owns the architecture and decision criteria. The Techne Harness owns controller and fabric applications, infrastructure, runtime payloads and provider adapters. This repository owns command grammar, diagnostics, installation and release artifacts; it does not duplicate harness runtime payloads.

The [user guides](docs/guides/user/README.md) explain how to install, authenticate, diagnose, and operate `techne`. The [developer guides](docs/guides/developer/README.md) cover changing and releasing it.

## Current commands

```text
techne diag
techne doctor
techne auth login
techne controller status
techne controller bootstrap
```

Use `techne --help` for command and option reference. The [user guides](docs/guides/user/README.md) connect installation, authentication, diagnostics, and controller commands into safe operator workflows. `diag` remains offline, and authentication or bootstrap is explicit and interactive.

## Installation

No public release is available yet. Follow [Install techne from a checkout](docs/guides/user/installing.md) for the supported local-link installation and recovery procedure.

## Development

Use the repository-pinned toolchain:

```sh
bun install
bun run test
bun run test:coverage
bun run self:typecheck
bun run build
```

The repository is not yet a published release. The [developer guides](docs/guides/developer/README.md) define review and first-release gates; Homebrew distribution begins only after an immutable accepted release exists.

## Repository map

- `src/` — CLI grammar, configuration, diagnostics and AWS adapter.
- `bin/techne` — local source launcher.
- `man/techne.1` — physical command manual.
- `release/` — deterministic platform archive builder and smoke test.
- `docs/guides/` — operator and developer guidance.
- `docs/roadmap/` — forward work queue.
