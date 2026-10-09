---
id: TECHNE-TOOL-CLI-007
area: CLI
title: Owned-host adapter
project: agent-host
status: cancelled
resolution: rejected
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-08T13:03:25Z
updated_at: 2026-10-09T21:40:00Z
---

# Owned-Host Adapter

## Goal

`techne host` drives a `agent-host` binding on a machine the owner already runs and reaches over the tailnet, through an owned-host provider adapter beside `src/providers/aws/`, with no provisioning.

## Context

[ADR-KI-ARCADIA-003](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Admin/Governance/Decisions/ADR-KI-ARCADIA-003-the-agent-host-workstation-model.md) in `ki-arcadia-principal` records the agent-host model for any target, cloud or owned, and [ODR-KI-ARCADIA-001](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Admin/Governance/Decisions/ODR-KI-ARCADIA-001-keeping-work-safe-on-the-agent-host.md) states rebuild and withdraw by intent, with AWS details only for the AWS provider. `tools-techne` has only the AWS provider. A generic review on 2026-10-08 proposed a paired owned-host provider (proposal P11); Kris approved capturing it the same day (Decision 12 in the Techne decisions log).

Running an owned host needs a governance decision on the [Techne Programme Hold](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Admin/Governance/Policies/Techne%20Programme%20Hold.md) first; that decision is raised in the `state-of-play` thread and is not decided here. Plan this record only if an owned host becomes real and that decision is made.

## Boundary

- In scope: an owned-host provider adapter under `src/providers/`; `host` commands for status, stop, rebuild and withdraw on that provider, following the harness's status contract and manifest; binding validation for the provider; stubbed tests.
- Out of scope: the harness recipe, scripts and contract ([TECHNE-TOOLS-OPS-021](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/roadmap/TECHNE-TOOLS-OPS-021-owned-host-provider.md) in `ki-techne-harness`); the Techne Programme Hold decision; and any remote action.

## Cancelled

Cancelled 2026-10-09 as rejected, approved by Kris Brown (state-of-play decisions log, Decision 31): no owned host is planned, so Kris chose not to keep this as a work record. It is kept, with its `ki-techne-harness` pair TECHNE-TOOLS-OPS-021 (`docs/roadmap/TECHNE-TOOLS-OPS-021-owned-host-provider.md`, cancelled with it), as one owned-host provider idea in Arcadia's agent-host Project note (`ki-arcadia-principal`, `Streams/Projects/agent-host/agent-host.md`). It leaves no outstanding change.

## Discussion

### Pairing

Paired with [TECHNE-TOOLS-OPS-021](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/roadmap/TECHNE-TOOLS-OPS-021-owned-host-provider.md) in `ki-techne-harness`, which owns the provider's recipe section and scripts; this adapter follows the harness contract, as ADR-KI-ARCADIA-006 requires. Neither blocks the other at capture.
