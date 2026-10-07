# tools-techne

`tools-techne` is the canonical source of the `techne` operator command-line interface for the Knowledge Islands Techne Harness.

Arcadia owns the architecture and decision criteria. The Techne Harness owns controller and fabric applications, infrastructure, runtime payloads and provider adapters. This repository owns command grammar, diagnostics, installation and release artifacts; it does not duplicate harness runtime payloads. The [implementation ownership decision (ADR-TECHNE-003)](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Admin/Governance/Decisions/ADR-TECHNE-003-techne-implementation-ownership.md) defines this boundary.

The [user guides](docs/guides/user/README.md) explain how to install, authenticate, diagnose, and operate `techne`. The [developer guides](docs/guides/developer/README.md) cover changing and releasing it.

## Current commands

```text
techne diag
techne help doctor
techne doctor
techne auth login
techne controller status
techne controller bootstrap
techne recipe list
techne recipe show [recipe]
techne host list
techne host add <name> --recipe <recipe> [--provider <provider>]
techne host status [--host <name> | --all]
techne host setup --host <name> [--pull]
techne host start --host <name>
techne host stop --host <name>
techne host connect [--host <name>] [path]
techne host teardown --host <name>
techne completion bash
techne completion zsh
```

Use `techne help [command]`, `techne --help` or `--help` after any command or command group, such as `techne host --help`, for command and option reference. The [user guides](docs/guides/user/README.md) connect installation, authentication, diagnostics, and controller commands into safe operator workflows. `diag` reports offline, share-safe tool/version, installation mode, executing host platform/architecture, runtime, and configuration presence; `diag --full` deliberately reveals local paths and identifiers. `doctor` adds its read-only scope, actionable checks, healthy/unhealthy verdict, and pass/warn/fail/skipped counts; it may contact AWS for identity, but does not check package freshness. Authentication or bootstrap is explicit and interactive. Hosts and the controller are configured, not built in: each host is a binding file, `~/.config/techne/hosts/<name>.toml`, naming a recipe from a local Techne Harness checkout (`--harness-dir` or `TECHNE_HARNESS_DIR`) and exactly one provider table, and the controller is the `[controller.aws]` table in `~/.config/techne/config.toml`. Read-only host commands select a host by `--host`, `TECHNE_HOST`, `default_host` or the only binding; `host setup`, `start`, `stop` and `teardown` always require `--host`. Provider options such as `--aws-profile` override the binding or controller values. AWS host commands act only on the one instance matching the recipe's selectors, under its operator role; `--dry-run` previews a change and teardown asks you to type the instance ID. Recipe scripts run from the harness checkout rather than being copied.

`techne completion bash` and `techne completion zsh` print shell completion definitions without changing shell configuration.

## Installation

Install the current release from its exact tag:

```sh
curl --fail --location --proto '=https' --proto-redir '=https' --output install.sh \
  https://raw.githubusercontent.com/knowledgeislands/tools-techne/v0.2.0/install.sh
bash ./install.sh v0.2.0
```

The [installation guide](docs/guides/user/installing.md) covers Homebrew, destination overrides, verification and local development links.

## Development

Use the repository-pinned toolchain and the canonical commands in the [definition of done](docs/guides/developer/definition-of-done.md), including the isolated, locked boundary checker. Tests never download tooling or contact providers.

## Repository map

- `src/` — CLI grammar, bindings, recipes, diagnostics and the provider adapters under `src/providers/`.
- `bin/techne` — local source launcher.
- `man/techne.1` — physical command manual.
- `release/` — platform archive builder and installer smoke test.
- `docs/guides/` — operator and developer guidance.
- `docs/roadmap/` — forward work queue.

Remote-environment management remains on hold pending the principal's authorisation and a remote-delivery policy. Local implementation and candidate integration may proceed under ordinary repository approvals. Arcadia maintains canonical engineering knowledge in [Engineering Practice](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Pillars/Engineering%20Practice/Engineering%20Practice.md) and defines the remote boundary in its [Techné programme policy](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Admin/Governance/Policies/Techne%20Programme%20Hold.md).
