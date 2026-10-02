# tools-techne

`tools-techne` is the canonical source of the `techne` operator command-line interface for the Knowledge Islands Techne Harness.

Arcadia owns the architecture and decision criteria. The Techne Harness owns controller and fabric applications, infrastructure, runtime payloads and provider adapters. This repository owns command grammar, diagnostics, installation and release artifacts; it does not duplicate harness runtime payloads. The [implementation ownership decision (ADR-TECHNE-003)](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Admin/Governance/Decisions/ADR-TECHNE-003-techne-implementation-ownership.md) defines this boundary.

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

Remote-environment management remains on hold pending the principal's authorisation and a remote-delivery policy. Local implementation and candidate integration may proceed under ordinary repository approvals. Arcadia maintains canonical engineering knowledge in [Engineering Practice](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Pillars/Engineering%20Practice/Engineering%20Practice.md) and defines the remote boundary in its [Techné programme policy](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Admin/Governance/Policies/Techne%20Programme%20Hold.md).
