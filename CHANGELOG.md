# Changelog

All notable changes to `techne` are recorded here.

## Pre-1.0 baseline

This is the consolidated 0.x command and capability baseline. Tags and GitHub releases retain each exact preview snapshot.

### Command surface

- `techne diag [--full]`
- `techne doctor`
- `techne help [command]`
- `techne auth login`
- `techne controller status`
- `techne controller bootstrap`
- `techne completion <bash|zsh>`

### Capabilities

- Establish the standalone `tools-techne` repository and flat Bun/TypeScript CLI layout.
- Provide share-safe offline diagnostics by default, with explicit `--full` local detail, local health checks, controller status and interactive controller bootstrap.
- Align diagnostics and doctor context across tools: tool/version, checkout-verified local/release/unknown installation mode, executing platform/architecture, runtime/version, and configuration presence. Copied or unidentified source is unknown rather than guessed local. Doctor reports read-only scope, actionable findings, verdict, and pass/warn/fail/skipped counts; unavailable AWS identity checks are explicit and numeric identities stay private.
- Add exact-version and latest-release installation, local-link installation, a physical manual and macOS/Linux release archives.
- Print Bash and Zsh command and option completions without modifying shell startup files.

The first release was `v0.1.0`; this baseline is current for `v0.1.1` and remains consolidated until 1.0.
