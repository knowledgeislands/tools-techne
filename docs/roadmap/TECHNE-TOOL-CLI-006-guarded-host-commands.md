---
id: TECHNE-TOOL-CLI-006
area: CLI
title: Guarded host commands
status: triage
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-07T20:51:00Z
updated_at: 2026-10-07T20:51:00Z
---

# Guarded Host Commands

## Goal

The `techne host` commands give the operator the same safe, at-risk or unknown verdict as the harness scripts, warn before a stop, and replace the bare teardown with guarded rebuild and withdraw commands, so work on the agent host cannot be lost from either entry point.

## Context

This is the first wave-2 record of the agent-host durability rollout, after the harness pilot. Kris Brown approved the design on 2026-10-07; [ODR-KI-ARCADIA-001](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Admin/Governance/Decisions/ODR-KI-ARCADIA-001-keeping-work-safe-on-the-agent-host.md) in `ki-arcadia-principal` records it, with the merged report and decisions in that collection's `references/agent-host-durability-*` files. Decisions 2, 4 and 8 apply: stop warns and never refuses; teardown fails closed with two overrides; rebuild and withdraw are two named operations through the recipe's destroy path under the binding's administrator profile, replacing `techne host teardown`; and the CLI follows the harness pilot.

Today `techne host teardown` terminates the instance after a typed confirmation and reports the remaining footprint, outside the recipe's destroy path; the operator role may terminate the tagged instance but cannot delete the stack. `techne host status` reports a stopped host's workspace as `skipped` and reads the harness's text output. Under ADR-TECHNE-003 the recipe manifest and its variables are the only contract between this CLI and `ki-techne-harness`, so this record consumes the structured status report and operations that `TECHNE-TOOLS-OPS-013` adds there.

## Boundary

- In scope: `techne host status` embedding the structured report in its `--json` output under a new schema version and passing the outcome through as its exit status; `techne host stop` warning with `--now`; `techne host rebuild` and `techne host withdraw` with the harness guard and overrides, replacing `techne host teardown`; equivalence tests against the harness stubs; help, completion, manual and changelog.
- Out of scope: the harness scripts, manifest and status contract (`TECHNE-TOOLS-OPS-013`); pins and expiries (`TECHNE-TOOLS-OPS-014`), beyond surfacing a warning the harness supplies; and any live rebuild, withdrawal or other remote action, which is the binding owner's alone.

## Discussion

### Sequencing

Starts only after `TECHNE-TOOLS-OPS-013` is delivered in `ki-techne-harness` and its lessons are written into this brief. The report asks that the pilot and this record land before a withdrawal could need them.

### Open points

- Whether `host teardown` is removed outright or kept briefly as an error pointing to the two new commands.
- How the expiry warning within 14 days reaches `techne host status` once `TECHNE-TOOLS-OPS-014` lands.
