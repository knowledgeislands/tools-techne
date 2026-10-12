---
id: KI-TOOL-TECHNE-CLI-008
area: CLI
title: Host patching binding fields
project: agent-host
kind: deliver
status: draft
horizon: next
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-09T15:42:04Z
updated_at: 2026-10-12T07:08:49Z
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

## Current state

Adopted for local planning only. The existing binding whitelist excludes the recipe's two optional patching fields; the canonical implementation plan is not yet prepared or approved.

## Steps

- [ ] Prepare the bounded implementation plan from the current tools-techne and local Harness contracts and source, then return it for owner review. No source or tests are authorised by this adoption.

## Files touched

This record only during planning; implementation paths will be identified from source before plan review.

## Verify

Before publishing adoption, run the work-selector, roadmap and authoring audits, verify preserved identity, creation timestamp, dependencies and baseline, and run `git diff --check`.

## Dependencies / blocks

The recipe contract already exists. Keep the dependency arrays unchanged; this adoption does not release guarded-host work or remote operations.

## Documentation impact

### Decision Records

No new architectural decision is made by adoption.

### Specifications

No accepted behaviour contract changes during adoption; planning will inspect the existing versioned contracts.

### Guides

No operating guidance changes during adoption; planning will identify any required binding/status guidance.

### Roadmap

This existing record is selected as draft Next for local planning only; the guarded-host record remains held.

## Discussion

### Pairing

The CLI side of the harness recipe's patching model. The harness owns the recipe contract and this adapter follows it, as ADR-KI-PRINCIPAL-006 requires. Neither blocks the other: without this record the fields reach the harness scripts only through their environment variables (`AGENT_HOST_REBOOT_WINDOW` and `AGENT_HOST_LIVEPATCH`), and the `updates` member is additive to a document whose schema stays `techne/host-workspace/v1`. The parameter names are now settled in the recipe manifest, so this record can be planned.

### Adoption authority

On 12 October 2026, Kris approved the recommendation: "I approve your recommendation, I can review it further later" (tools-burndown Decision 11). Adopted as deliver/draft Next; Decision 11 explicitly releases local planning of this record only. Decision 12 preserves these dispositions and does not release other held work. Adoption grants no implementation, acceptance, release, remote-agent or remote-environment authority. Local planning does not resume all agent-host work.
