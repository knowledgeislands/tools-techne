---
id: KI-TOOL-TECHNE-CLI-009
area: CLI
title: Tailscale OAuth binding field
status: ready
kind: deliver
horizon: next
size: s
blocks: []
blocked_by: []
baseline_ref: 52871249e4dbc2c73346212866d87d7139441749
created_at: 2026-10-14T21:30:44Z
updated_at: 2026-10-20T05:02:00Z
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

Adopted 2026-10-14 in the techne coordination thread, on Kris's word, as received: "Adopt KI-TOOL-TECHNE-CLI-009 in tools-techne as kind deliver at horizon next, planned after the current burn-down work".

Planned on 20 October 2026 in the overnight roadmap burn-down against tools-techne `52871249e4dbc2c73346212866d87d7139441749` and ki-techne-harness `32f1b1e`:

- [Binding loading](../../src/bindings.ts) accepts only the fixed `NEUTRAL_FIELDS` list at the top level and refuses anything else, so a binding cannot hold the reference today. Field-specific forms are checked on the written TOML value and again on the resolved value, as `reboot_window` and `livepatch` are.
- A binding value reaches a script only through `scriptEnvironment`, which sets the environment variable a recipe parameter declares for each script that parameter lists. The runner adds that environment to the inherited one, so an unset field sets nothing and an operator's own export still reaches the script.
- The Harness [agent-host recipe](https://github.com/knowledgeislands/ki-techne-harness/blob/main/recipes/agent-host/recipe.toml) declares no `tailscale_oauth_item` parameter yet; `provision.sh`, `destroy.sh` and `mint-tailscale-key.sh` read `AGENT_HOST_TAILSCALE_OAUTH_ITEM` and require an `op://` reference.
- `techne` runs only the recipe's `status` and `setup` scripts today. It has no provision command, and `destroy` is reached only once the guarded rebuild and withdraw commands of [KI-TOOL-TECHNE-CLI-006](KI-TOOL-TECHNE-CLI-006-guarded-host-commands.md) land. As with the patching fields, this work must not add provisioning grammar.

## Steps

- [ ] Add `tailscale_oauth_item` to `NEUTRAL_FIELDS`. Accept only a TOML string in 1Password reference form, `op://<vault>/<item>` with optional further segments, each segment non-empty and free of whitespace; refuse any other value before a provider table or subprocess is read, with a message that never echoes the value. Check a resolved recipe default against the same form.
- [ ] Keep routing generic: hard-code no environment variable name and no script list. The recipe parameter's `env` and `scripts` decide where the value goes, so it reaches `provision` and `destroy` once the Harness declares them and `techne` runs those scripts. An unset field adds nothing to any script environment.
- [ ] Document the field in the agent-host user guide's binding section, the manual's binding file entry and the changelog, saying that it holds a reference, never a secret, that `techne` never reads it with `op`, and that it reaches only the scripts the recipe declares.

## Files touched

- [src/bindings.ts](../../src/bindings.ts): the new neutral field and its form check.
- [src/tests/cli.test.ts](../../src/tests/cli.test.ts): public-seam cases.
- [Agent-host user guide](../guides/user/agent-host.md), [man/techne.1](../../man/techne.1) and [CHANGELOG.md](../../CHANGELOG.md).
- This record.

The vendored recipe fixture stays a faithful Harness subset; tests add the parameter in-test. No Harness or Principal write.

## Verify

Tests enter through `runCli(args, dependencies)` with temporary local files and a fake runner; no AWS, SSH, Tailscale, 1Password or Harness script runs.

- Accept an absent field and well-formed references, and pass none of them to `setup` or `status` under the vendored recipe.
- With an in-test recipe parameter declaring `AGENT_HOST_TAILSCALE_OAUTH_ITEM` for `status`, the reference reaches the status script exactly; for `provision` and `destroy` only, it reaches neither `status` nor `setup`; with the field unset, the variable is absent from the added environment.
- Refuse empty, non-`op://`, segment-less, empty-segment, whitespace-bearing, non-string, list and table values before any subprocess, without echoing the value; refuse a malformed recipe default.
- Run the [definition of done](../guides/developer/definition-of-done.md) commands and the repository audit.

## Dependencies / blocks

Not blocking: the hand export works today. The Techne Harness adds its optional recipe parameter after this tool delivers; the receiving repository owns its own priority and plan. The remote-environment hold does not apply to local implementation of this field, and Kris decided on 14 October 2026 to hand this over now. The field reaches `destroy` through `techne` only once KI-TOOL-TECHNE-CLI-006 delivers rebuild and withdraw, and reaches `provision` only by hand until a provision command exists; neither is a dependency of this record.

## Documentation impact

### Decision Records

None.

### Specifications

Keep `techne/host-binding/v1`: the field is optional and additive. No separate binding reference exists in this repository; the agent-host user guide and the manual are the canonical binding documentation, so they carry the field.

### Guides

Update the operator guide's binding configuration section to describe the new field.

### Roadmap

None.

## Discussion

### Open questions, resolved in planning

- Which operations receive the field: only the scripts the recipe parameter lists, as every binding value reaches scripts today. The Harness lists `provision` and `destroy`, as requested; `techne` hard-codes neither.
- An unset field adds nothing to any script environment, so an operator's own export keeps working. A set field overrides an inherited export only for the scripts the recipe lists.

### Planning authority

Planned and made Ready on 20 October 2026 in the overnight roadmap burn-down, on Kris's instruction of the same day to get the roadmaps down to zero, "committing and pushing as you go". The plan stays within the adopted boundary and grants no acceptance, release or live operation.
