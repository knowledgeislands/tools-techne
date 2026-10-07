---
id: TECHNE-TOOL-CLI-004
area: CLI
title: Add host command group
theme: cli
horizon: triage
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-07T06:35:19Z
updated_at: 2026-10-07T06:35:19Z
---

# Add host command group

## Goal

Operators manage the single Techne agent host through the `techne` command-line interface, with the same safety guards they rely on today, rather than through a personal chezmoi helper script.

## Context

ADR-TECHNE-003 assigns the public `techne` command grammar to `tools-techne`, the agent-host stack and host payloads to `ki-techne-harness`, and leaves chezmoi with only the principal's personal configuration. The agent-host operator surface currently sits on the wrong side of that boundary: the chezmoi helper `techne-agent-host` (DOTFILES-UE-068) provides connect, stop and teardown, while the harness is settling setup and status under TECHNE-TOOLS-OPS-011, with OPS-009 as related harness context.

The proposed grammar sits alongside the existing `techne controller status|bootstrap` group:

```text
techne host connect
techne host start
techne host stop
techne host status
techne host setup
techne host teardown
```

The helper's behaviour to absorb includes:

- the `ki-agent-host-id=agent-host` tag guard that selects the host;
- refusal unless exactly one matching instance exists;
- teardown confirmation by typing the instance identifier;
- the operator-role credential guard.

## Boundary

This record is unadopted intake: it carries no plan and authorises no implementation. The CLI must wrap the harness's setup and status interfaces from TECHNE-TOOLS-OPS-011, not copy their payloads or stack definitions into this repository. It does not cover the controller or execution fabric, other hosts, or any change to the running agent host. Retiring the chezmoi helper belongs to the chezmoi repository once this group exists.

## Discussion

### Sequencing

Shaping should wait until TECHNE-TOOLS-OPS-011 lands in `ki-techne-harness`, so the setup and status interfaces being wrapped are settled. That is a sequencing preference rather than a recorded `blocked_by` dependency, because the blocker lives in another repository.

### Helper retirement

Once `techne host` exists, `techne-agent-host` in chezmoi can shrink to a thin alias and then be retired. DOTFILES-UE-068 owns that change on the chezmoi side.

### Remote-environment authority

Remote action is limited to the single agent host under the Techne Programme Hold's KI-ARCADIA-GOV-020 exemption. A separate Arcadia record is widening that exemption to cover setting up and operating the agent host properly; KI-ARCADIA-GOV-021 is related governance context. Adopting or delivering this record does not by itself authorise any remote operation, and live verification must stay within whatever exemption is current at that time.

### Open questions

- Should `connect` keep the helper's session mechanism, or use whatever access path the harness standardises?
- Should `start` and `stop` live here alone, or also be exposed through harness tooling?
- What does `status --json` render, and how far should it reuse the harness's status output?
