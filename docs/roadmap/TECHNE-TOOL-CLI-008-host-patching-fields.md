---
id: TECHNE-TOOL-CLI-008
area: CLI
title: Host patching binding fields
project: agent-host
status: triage
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-09T15:42:04Z
updated_at: 2026-10-09T21:38:50Z
---

# Host Patching Binding Fields

## Goal

A `agent-host` binding can set the optional `reboot_window` and `livepatch` fields that the harness recipe's patching model reads, and `techne host status` shows the optional `updates` member of the `techne/host-workspace/v1` status document.

## Context

The `agent-host` recipe in `ki-techne-harness` now makes OS patching part of the host: security updates install unattended, a reboot happens only at an optional daily host-local window (`HH:MM`, such as `04:00`) when one is required and nobody is logged in, Livepatch is opt-in, and pending updates and reboot-required are reported in the status document's optional `updates` member without ever changing the outcome. With no window the host never restarts itself. The [recipe manifest](https://github.com/knowledgeislands/ki-techne-harness/blob/main/recipes/agent-host/recipe.toml) declares the two optional parameters, `reboot_window` and `livepatch`, and the [operator guide's patching section](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/guides/operator/agent-host.md#patching-and-restart) describes the behaviour. The binding owner settled these choices on 2026-10-09 (Decisions 26 and 27 in the Techne decisions log).

`src/bindings.ts` accepts only the fixed `NEUTRAL_FIELDS` list plus each provider's binding fields, so the two new recipe parameters cannot be written in a binding until this repository accepts them.

## Boundary

- In scope: accepting `reboot_window` and `livepatch` as optional binding fields, validating the window's form (a 24-hour `HH:MM` with no weekday) and Livepatch's boolean value; passing them to the harness scripts as their recipe parameters; rendering the optional `updates` member (pending and security counts, reboot required and since when, Livepatch state) in `techne host status` text and JSON output without changing the exit status; stubbed tests.
- Out of scope: the recipe, boot script, status script and banner, which the harness owns; Ubuntu Pro attachment and any token handling, which the binding owner does; and any remote action.

## Discussion

### Pairing

The CLI side of the harness recipe's patching model. The harness owns the recipe contract and this adapter follows it, as ADR-KI-ARCADIA-006 requires. Neither blocks the other: without this record the fields reach the harness scripts only through their environment variables (`AGENT_HOST_REBOOT_WINDOW` and `AGENT_HOST_LIVEPATCH`), and the `updates` member is additive to a document whose schema stays `techne/host-workspace/v1`. The parameter names are now settled in the recipe manifest, so this record can be planned.
