---
id: KI-TOOL-TECHNE-CLI-009
area: CLI
title: Tailscale OAuth binding field
status: done
kind: deliver
size: s
blocks: []
blocked_by: []
baseline_ref: 52871249e4dbc2c73346212866d87d7139441749
created_at: 2026-10-14T21:30:44Z
updated_at: 2026-10-20T05:34:40Z
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

- [x] Add `tailscale_oauth_item` to `NEUTRAL_FIELDS`. Accept only a TOML string in 1Password reference form, `op://<vault>/<item>` with optional further segments, each segment non-empty and free of whitespace; refuse any other value before a provider table or subprocess is read, with a message that never echoes the value. Check a resolved recipe default against the same form.
- [x] Keep routing generic: hard-code no environment variable name and no script list. The recipe parameter's `env` and `scripts` decide where the value goes, so it reaches `provision` and `destroy` once the Harness declares them and `techne` runs those scripts. An unset field adds nothing to any script environment.
- [x] Document the field in the agent-host user guide's binding section, the manual's binding file entry and the changelog, saying that it holds a reference, never a secret, that `techne` never reads it with `op`, and that it reaches only the scripts the recipe declares.

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

## Review

### Delivered

Delivered against baseline `52871249e4dbc2c73346212866d87d7139441749` through the record-only Ready commit `e4db3b8` and implementation commit `4e43224`: a binding may set the optional top-level `tailscale_oauth_item`, holding a 1Password reference; it reaches only the scripts the recipe parameter declares, and an unset field sets nothing. Excluded as planned: Harness recipe changes, reading the reference with `op`, provisioning grammar, and every remote, provider or host operation.

### Change Summary

- [src/bindings.ts](../../src/bindings.ts): adds the field to `NEUTRAL_FIELDS`; refuses a non-string or anything but `op://<vault>/<item>` with optional further non-empty, whitespace-free segments, before any provider table or subprocess, with a message that never repeats the value; checks a resolved recipe default the same way. Environment derivation is unchanged and hard-codes no variable or script.
- [src/tests/cli.test.ts](../../src/tests/cli.test.ts): four public-seam cases. The vendored recipe fixture is unchanged; tests declare the Harness's future parameter in-test.
- [Agent-host user guide](../guides/user/agent-host.md), [man/techne.1](../../man/techne.1) and [CHANGELOG.md](../../CHANGELOG.md): the field, its form, that it is never the secret and never read, its routing, and the hand export still needed for a build run by hand.

No approved deviation. The record's Specifications line named a binding reference file that does not exist; as planned, the guide and manual carry the field instead.

### Verification

Run from the worktree root with the pinned Bun:

- `bun run test`: 105 passed, 0 failed. `bun run test:coverage`: 100% statements, branches, functions and lines.
- `bun install --frozen-lockfile` (root and `tooling/boundaries`), `bun run self:typecheck`, `bun run build`, `bun run self:release:test`, `bun run ki:tools:lint-man`, `bunx biome check .`, `bunx rumdl check .` and `git diff --check`: all exit 0. The edited manual renders through `mandoc` and passes `mandoc -Tlint`.
- `ki repo audit --repo .`: no new finding. The primary checkout's existing findings are unchanged (five warnings, including `.rumdl.toml` drift, lint-staged fan-out and inline CI `KI_VERSION`); the worktree adds only RUNTIMES-2 runtime-activation failures, which follow the checkout path rather than any file and do not appear in the primary checkout.
- Tests use a fake runner and stub provider only; no AWS, SSH, Tailscale, 1Password or Harness script ran.

### Outstanding concerns

- The field changes nothing operationally until the Harness declares the matching recipe parameter, and `techne` runs `destroy` only once KI-TOOL-TECHNE-CLI-006 delivers; `provision` still runs by hand with the variable exported. The guide says so.
- A set field overrides an operator's own export for the declared scripts; this is the generic binding precedence.

### Post-change review

The goal is met within this tool's boundary: the reference can be recorded once on the binding, is refused in any non-reference form, and reaches exactly the scripts the recipe lists. Regression risk is low: existing tests pass unchanged and the binding schema stays `techne/host-binding/v1`. The Harness handoff, adding the optional `tailscale_oauth_item` parameter for `provision` and `destroy`, goes to the receiving work as a message.

### Mini recap

Optional `tailscale_oauth_item` binding field delivered in tools-techne with stubbed tests; every declared gate passed at full coverage with no new audit finding. It takes effect once the Harness declares the parameter and `techne` runs the declaring scripts. No learning to promote.

## Done

Accepted 2026-10-20 by the independent Codex reviewer under Kris Brown's overnight grant on the review packet above.

## Discussion

### Independent acceptance

Kris Brown granted overnight acceptance on 20 October 2026: "if you can quickly now accept ... accepting new things that are waiting with you and pruning those ... getting the roadmaps down to zero". Source: the accept2-tools-techne independent acceptance brief, explicitly authorising acceptance under its prune tier. This grant is applied to KI-TOOL-TECHNE-CLI-009 only. The reviewer did not deliver the implementation.

Independent review of the baseline, implementation and six-part packet passed. All definition-of-done gates were rerun with network access denied: both frozen installs (offline), 105 tests, 100% statements/branches/functions/lines coverage, type checking, build, release/installer fixtures, manual lint and rendered reading, Biome, rumdl, full repository audit and diff checks. The full audit reported zero failures and six existing warnings: authoring configuration drift, Claude binding drift, lint-staged fan-out, inline CI tool pin and two hook-template differences. HOOK-GUARD remains in force; no conformance or environment change was made. No check requires an attended action, publication or Kris's own eyes. The recipe-parameter follow-up is already carried by TS-OAUTH-PARAM in the receiving agent-host work's message queue.

Pruning is deferred: cross-repository reference preflight found live links in Principal's ways-of-working roadmap sweep and agent-host state and work files. The local guarded-host plan also links here. The selected repository and its accessible Principal, Harness, agentic-harness, tools-ki, specifications and website peers were searched; no completion-observation trade was found in those roots. The archived former Techne Principal is unavailable locally and was not fetched under this run's remote-call restrictions. Peer links cannot be repaired under this run's messages-only authority, so the committed Done record is retained and the supervisor is asked to arrange repairs before pruning.

### Open questions, resolved in planning

- Which operations receive the field: only the scripts the recipe parameter lists, as every binding value reaches scripts today. The Harness lists `provision` and `destroy`, as requested; `techne` hard-codes neither.
- An unset field adds nothing to any script environment, so an operator's own export keeps working. A set field overrides an inherited export only for the scripts the recipe lists.

### Planning authority

Planned and made Ready on 20 October 2026 in the overnight roadmap burn-down, on Kris's instruction of the same day to get the roadmaps down to zero, "committing and pushing as you go". The plan stays within the adopted boundary and grants no acceptance, release or live operation.
