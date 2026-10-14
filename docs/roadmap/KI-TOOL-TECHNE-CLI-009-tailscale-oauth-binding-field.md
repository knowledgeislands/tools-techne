---
id: KI-TOOL-TECHNE-CLI-009
area: CLI
title: Tailscale OAuth binding field
status: draft
kind: deliver
horizon: next
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-14T21:30:44Z
updated_at: 2026-10-14T23:23:00Z
transferred_from: ki-techne-harness
---

# Tailscale OAuth Binding Field

## Goal

An operator can record, in a host binding, the 1Password reference for the agent host's Tailscale OAuth client, so provisioning and rebuilding the host no longer depend on exporting an environment variable by hand.

## Context

`techne` bindings carry a fixed list of fields, so a binding cannot hold this reference. Today the operator exports `AGENT_HOST_TAILSCALE_OAUTH_ITEM` by hand before `provision` and `destroy rebuild`. The Techne Harness operator guide describes the item in [Key minting](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/guides/operator/agent-host.md#key-minting). This need originates in `ki-techne-harness`, which will add the matching optional recipe parameter once this tool delivers.

## Boundary

- In scope: an optional binding field `tailscale_oauth_item` holding a 1Password item reference such as `op://<vault>/ki-techne-agent-host-tailscale-oauth`; passing its value to the recipe's `provision` and `destroy` operations as the environment variable `AGENT_HOST_TAILSCALE_OAUTH_ITEM`; validation, help, the user guide and the changelog for the new field.
- Out of scope: reading the item with `op` or resolving the reference anywhere in this repository; storing or logging any secret; harness recipe changes; and any live provision, rebuild or other remote action.
- The value is a reference, never a secret.

## Current state

Adopted 2026-10-14 in the techne coordination thread, on Kris's word, as received: "Adopt KI-TOOL-TECHNE-CLI-009 in tools-techne as kind deliver at horizon next, planned after the current burn-down work". The work is ready for planning.

## Steps

- [ ] Reserved for planning phase

## Files touched

Reserved for planning phase.

## Verify

Reserved for planning phase.

## Dependencies / blocks

Not blocking: the hand export works today. The Techne Harness adds its optional recipe parameter after this tool delivers; the receiving repository owns its own priority and plan. The remote-environment hold does not apply to local implementation of this field, and Kris decided on 14 October 2026 to hand this over now.

## Documentation impact

### Decision Records

None.

### Specifications

Update [the Techne Binding reference](../references/techne-binding-schema.md) (or the canonical reference) to document the new optional `tailscale_oauth_item` field.

### Guides

Update the operator guide's binding configuration section to describe the new field.

### Roadmap

None.

## Discussion

### Open questions

- Whether the field is passed only to `provision` and `destroy`, as requested, or is simply recorded on the binding and exposed to every operation.
- How an unset field behaves: the requested behaviour leaves the environment untouched, so an operator's own export keeps working.
