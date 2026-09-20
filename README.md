# tools-techne

`tools-techne` is the canonical source of the `techne` operator command-line interface for the Knowledge Islands Techne Harness.

Techne Principal owns the architecture and decision criteria. The Techne Harness owns controller and fabric applications, infrastructure, runtime payloads and provider adapters. This repository owns command grammar, diagnostics, installation and release artifacts; it does not duplicate harness runtime payloads.

## Current commands

```text
techne diag
techne doctor
techne auth login
techne controller status
techne controller bootstrap
```

Use `techne --help` for options. `diag` is offline and reports only non-secret effective configuration. `doctor` checks local tooling and the expected AWS identity. `auth login` reconciles every authentication surface declared by the effective Techne configuration with supported provider clients installed locally. The current configuration declares AWS only: a valid session is left unchanged, while a recognised expired IAM Identity Center session opens `aws sso login` and then revalidates the expected account. Missing clients, unsupported profiles and non-authentication provider failures stop without attempting login. Interactive bootstrap reads credential values on the remote controller and never sends them as command parameters.

Authentication is explicit and interactive. `doctor` and controller commands may direct an expired session to `techne auth login`, but they never open a browser themselves. `auth login` rejects `--json` and non-interactive terminals.

## Local development installation

Use the explicit local-link mode:

```sh
./install.sh --link
techne --version
techne diag
```

The launcher runs this checkout's `src/main.ts` through Bun. Override destinations with `TECHNE_INSTALL_DIR` and `TECHNE_MAN_INSTALL_DIR`.

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
- `docs/guides/` — contributor and user guidance.
- `docs/roadmap/` — forward work queue.
