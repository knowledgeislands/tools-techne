# AGENTS.md — tools-techne

`tools-techne` is the independently released operator command-line interface for the Techne Harness. [README.md](README.md) is the user-facing entry point; this file contains only standing contribution context.

## Authority

Techne Principal owns architectural roles, invariants and decision criteria. `tools-techne` owns the public `techne` command grammar, diagnostics, installation and release artifacts. The Techne Harness owns controller and fabric applications, infrastructure, runtime payloads and provider adapters.

## Working contract

- Preserve unrelated work and treat the checkout as potentially shared. Re-check `HEAD`, status and staged paths before every commit; stage only explicitly owned paths.
- Keep command modules responsible for grammar, validation and rendering. Keep provider clients responsible for typed external operations and safety checks.
- Exercise behaviour through the in-process `runCli(args, dependencies)` seam. Tests must inject subprocess responses and must not contact AWS, Telegram or live infrastructure.
- Keep credentials, numeric operator identifiers, provider sessions and raw updates out of Git, tests, logs and command arguments.
- Use Bun `1.4.1` from the repository root. Do not create package-local lockfiles or dependency directories.
- Do not push, tag, publish, release or update Homebrew without explicit authority.
