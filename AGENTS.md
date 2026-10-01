# AGENTS.md — tools-techne

`tools-techne` is the independently released operator command-line interface for the Techne Harness. [README.md](README.md) is the user-facing entry point; this file contains only standing contribution context.

## Authority

Arcadia owns architectural roles, invariants and decision criteria. `tools-techne` owns the public `techne` command grammar, diagnostics, installation and release artifacts. The Techne Harness owns controller and fabric applications, infrastructure, runtime payloads and provider adapters. The [implementation ownership decision (ADR-TECHNE-003)](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Admin/Governance/Decisions/ADR-TECHNE-003-techne-implementation-ownership.md) defines this boundary.

## Working contract

- Preserve unrelated work and treat the checkout as potentially shared. Re-check `HEAD`, status and staged paths before every commit; stage only explicitly owned paths.
- Keep command modules responsible for grammar, validation and rendering. Keep provider clients responsible for typed external operations and safety checks.
- Exercise behaviour through the in-process `runCli(args, dependencies)` seam. Tests must inject subprocess responses and must not contact AWS, Telegram or live infrastructure.
- Keep credentials, numeric operator identifiers, provider sessions and raw updates out of Git, tests, logs and command arguments.
- Use Bun `1.4.1` from the repository root. Do not create package-local lockfiles or dependency directories.
- Do not push, tag, publish, release or update Homebrew without explicit authority.

## Techne execution hold

New Techné implementation, substantive architecture changes, branch integration and remote rollout are on hold. The programme hold and restart criteria are owned by Arcadia in [Techne Programme Hold](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Admin/Governance/Policies/Techne%20Programme%20Hold.md). Existing Ready records and task approvals do not override the hold. Preserve branches, worktrees, work records and existing services; read-only inspection and explicitly scoped preservation or hold administration may continue. Resume only on the principal's explicit direction after the local Paperclip learning review and remote-delivery policy.
