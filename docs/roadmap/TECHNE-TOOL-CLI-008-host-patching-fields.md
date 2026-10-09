---
id: TECHNE-TOOL-CLI-008
area: CLI
title: Host patching binding fields
status: triage
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-09T15:42:04Z
updated_at: 2026-10-09T16:04:33Z
---

# Host Patching Binding Fields

## Goal

A `agent-host` binding can set the optional `reboot_window` and `livepatch` fields that the harness recipe's patching model reads, and `techne host status` shows the optional `updates` member of the `techne/host-workspace/v1` status document.

## Context

[TECHNE-TOOLS-OPS-022](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/roadmap/TECHNE-TOOLS-OPS-022-agent-host-os-patching.md) in `ki-techne-harness` makes OS patching part of the `agent-host` recipe. The binding owner answered its six decisions on 2026-10-09 (Decision 26 in the Techne decisions log, with the window form amended by Decision 27): no automatic reboot by default, with an optional binding window of a daily host-local time, `HH:MM` such as `04:00`; Livepatch as an opt-in binding field; and pending updates and reboot-required reported without ever changing the status outcome. The harness record hands the CLI side to this repository.

`src/bindings.ts` accepts only the fixed `NEUTRAL_FIELDS` list plus each provider's binding fields, so the two new recipe parameters cannot be written in a binding until this repository accepts them.

## Boundary

- In scope: accepting `reboot_window` and `livepatch` as optional binding fields, validating the window's form (a 24-hour `HH:MM` with no weekday) and Livepatch's boolean value; passing them to the harness scripts as their recipe parameters; rendering the optional `updates` member (pending and security counts, reboot required and since when, Livepatch state) in `techne host status` text and JSON output without changing the exit status; stubbed tests.
- Out of scope: the recipe, boot script, status script and banner, which TECHNE-TOOLS-OPS-022 owns; Ubuntu Pro attachment and any token handling, which the binding owner does; and any remote action.

## Discussion

### Pairing

Handed off from [TECHNE-TOOLS-OPS-022](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/roadmap/TECHNE-TOOLS-OPS-022-agent-host-os-patching.md) in `ki-techne-harness`, which owns the recipe contract; this adapter follows it, as ADR-KI-ARCADIA-006 requires. Neither blocks the other: without this record the fields reach the harness scripts only through their environment variables, and the `updates` member is additive to a document whose schema stays `techne/host-workspace/v1`. Plan this record once TECHNE-TOOLS-OPS-022 settles the parameter names in `recipe.toml`.
