# Changelog

All notable changes to `techne` are recorded here.

## Unreleased

### Breaking

- Hosts and the controller are now configured rather than built in. Each host is a binding, `~/.config/techne/hosts/<name>.toml`, with a recipe from the harness checkout and exactly one provider table; the controller is the `[controller.aws]` table in `~/.config/techne/config.toml`. Commands refuse until the target they need exists.
- `host setup`, `start`, `stop` and `teardown` require `--host`.
- `--profile`, `--region`, `--account`, `--controller-stack` and `--host-profile` are removed in favour of `--aws-profile`, `--aws-region`, `--aws-account`, `--aws-controller-stack` and `--aws-operator-profile`, which apply only to a target using the AWS provider.
- `EXPECTED_AWS_ACCOUNT`, `CONTROLLER_STACK_NAME` and `TECHNE_HOST_PROFILE` are no longer read. `host status --json` reports the schema `techne/host-status/v2`.

### Added

- `techne recipe list|show`, `techne host list|add` and `techne host status --all`.
- Host selection by `--host`, `TECHNE_HOST`, `default_host` or the only binding.
- Recipe-driven AWS selectors, script environment and teardown footprint, through a provider adapter contract.

### Fixed

- The Tailscale reachability check accepts a host that answers only through a DERP relay, so `host setup` and `host connect` no longer refuse a freshly rebuilt host before a direct path exists.

## Pre-1.0 baseline

This is the consolidated 0.x command and capability baseline. Tags and GitHub releases retain each exact preview snapshot.

### Command surface

- `techne diag [--full]`
- `techne doctor`
- `techne help [command]`
- `techne auth login`
- `techne controller status`
- `techne controller bootstrap`
- `techne host status|start|stop|teardown` and `techne host connect [path]`
- `techne host setup [--pull]`
- `techne completion <bash|zsh>`

### Capabilities

- Establish the standalone `tools-techne` repository and flat Bun/TypeScript CLI layout.
- Provide share-safe offline diagnostics by default, with explicit `--full` local detail, local health checks, controller status and interactive controller bootstrap.
- Align diagnostics and doctor context across tools: tool/version, checkout-verified local/release/unknown installation mode, executing platform/architecture, runtime/version, and configuration presence. Copied or unidentified source is unknown rather than guessed local. Doctor reports read-only scope, actionable findings, verdict, and pass/warn/fail/skipped counts; unavailable AWS identity checks are explicit and numeric identities stay private.
- Add exact-version and latest-release installation, local-link installation, a physical manual and macOS/Linux release archives.
- Derive the executable version from the package version, keeping source and compiled releases on one version authority.
- Operate the single agent host with the guards of the chezmoi `techne-agent-host` helper: the `ki-agent-host-id=agent-host` tag selector, refusal unless exactly one instance matches, the operator-role credential check, typed-ID teardown confirmation and `--dry-run` previews.
- Converge the agent host workspace with `host setup`, and add the harness workspace report to `host status` as an additive `workspace` section, both by running the Techne Harness agent-host scripts from a local checkout selected with `--harness-dir` or `TECHNE_HARNESS_DIR`.
- Show help as the other KI CLIs do: `--help` or `-h` after any command or command group and `help [command]` print the same help on stdout with status 0; a command group lists its commands; a bare command group or unknown command exits 2 with a namespaced error and the relevant usage on stderr.
- Print Bash and Zsh command and option completions without modifying shell startup files.
- Mechanically enforce provider-to-CLI and runtime-to-fixture boundaries with a supported isolated parser, resolved-graph checks, and deliberately violating type-only fixtures.

This baseline remains consolidated until 1.0.
