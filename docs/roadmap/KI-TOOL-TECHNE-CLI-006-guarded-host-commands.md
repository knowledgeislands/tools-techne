---
id: KI-TOOL-TECHNE-CLI-006
area: CLI
title: Guarded host commands
project: agent-host
kind: deliver
status: draft
horizon: next
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-07T20:51:00Z
updated_at: 2026-10-12T17:09:04Z
---

# Guarded Host Commands

## Goal

The `techne host` commands give the operator the same safe, at-risk or unknown verdict as the harness scripts, warn before a stop, and replace the bare teardown with guarded rebuild and withdraw commands, so work on the agent host cannot be lost from either entry point.

## Context

This is the first wave-2 record of the agent-host durability rollout, after the harness pilot. Kris Brown approved the design on 2026-10-07; [ODR-KI-PRINCIPAL-001](https://github.com/knowledgeislands/ki-principal/blob/main/Admin/Governance/Decisions/ODR-KI-PRINCIPAL-001-keeping-work-safe-on-the-agent-host.md) in `ki-principal` records it, with the merged report and decisions in that collection's `references/agent-host-durability-*` files. Decisions 2, 4 and 8 apply: stop warns and never refuses; teardown fails closed with two overrides; rebuild and withdraw are two named operations through the recipe's destroy path under the binding's administrator profile, replacing `techne host teardown`; and the CLI follows the harness pilot.

Today `techne host teardown` terminates the instance after a typed confirmation and reports the remaining footprint, outside the recipe's destroy path; the operator role may terminate the tagged instance but cannot delete the stack. `techne host status` reports a stopped host's workspace as `skipped` and reads the harness's text output. Under ADR-KI-PRINCIPAL-006 the recipe manifest and its variables are the only contract between this CLI and `ki-techne-harness`, so this record consumes the structured status report and operations that the harness's durability pilot adds there.

## Boundary

- In scope: `techne host status` embedding the structured report in its `--json` output under a new schema version and passing the outcome through as its exit status; `techne host stop` warning with `--now`; `techne host rebuild` and `techne host withdraw` with the harness guard and overrides, replacing `techne host teardown`; equivalence tests against the harness stubs; help, completion, manual and changelog.
- Out of scope: the harness scripts, manifest and status contract (the harness's durability pilot); pins and expiries (the harness's pin and expiry work), beyond surfacing a warning the harness supplies; and any live rebuild, withdrawal or other remote action, which is the binding owner's alone.

## Current state

Source review on 12 October 2026 used tools-techne `47707bcf9a7ac1d08d8938d4a8e5dc9130142528` and local Harness `11adc5d625d102f808d306002916457116595264`. These are planning observations, not an execution baseline. The existing durability pilot supplies the contract; no new upstream delivery is needed.

- [Recipe parsing](../../src/recipes.ts) currently ignores `[status]` and `[operations]`. The Harness manifest declares `techne/host-workspace/v1`, clean 0, failed 1, at-risk 3, unknown 4 and unreachable 255, and rebuild/withdraw through the provider's `destroy` path.
- [Harness status](../../src/harness.ts) currently reads text and treats every nonzero exit as failure. [CLI status](../../src/cli.ts) uses `techne/host-status/v2` and `techne/host-status-list/v1`; stopped or absent hosts are skipped. Stop directly invokes the provider; teardown directly terminates an instance.
- The Harness stop script warns with a five-second status timeout and never refuses because of workspace risk; `--now` skips that read. Destroy validates account, stack identity, report outcome/exit and same-host identity, refuses unsafe destruction, owns both discard overrides and typed confirmation, and performs idempotent cleanup. The CLI must invoke these guards rather than reproduce them.
- The Harness JSON document includes repositories, problems and optional updates/profile signals. Expiry and workstation pin warnings currently exist only in its text route; JSON returns before those sections. Preserve those supplied warnings without inventing an expiry JSON field or deriving dates in this repository.

## Steps

- [ ] Parse optional manifest status schema/exit metadata and named operations in the existing recipe model. Validate known declarations and resolve each operation's script through the selected provider's paths. Keep legacy recipes usable for status; refuse a guarded operation with missing metadata/path before any subprocess. Expose the declared metadata through recipe JSON without copying Harness scripts.
- [ ] Make the declared structured report authoritative for single-host and all-host safety status in both output modes. Request `--json` without `--fetch`, validate schema, outcome/exit agreement, repositories/problems types and known host fields, and preserve unknown additive members. Embed the validated document as `workspace.safety` while retaining `workspace.report` as nullable text; bump outer schemas to `techne/host-status/v3` and `techne/host-status-list/v2`. Distinguish reported clean/at-risk/unknown from failed or unreachable; never collapse 3/4 into failed or convert missing evidence into clean. For stopped/absent hosts, retain provider state and skipped report but expose safety as unavailable/unknown and return 4 without attempting SSH or starting a host.
- [ ] Preserve the Harness text report as a bounded advisory second read in text mode, including expiry and pin warnings verbatim; it cannot replace the structured verdict. JSON mode needs only the structured read, leaving text null and documenting that expiry is unavailable there until Harness declares it. Text-read failure gives a concise warning and leaves the validated outcome intact. For valid single reports return 0/3/4; actual failure returns 1 and unreachable returns 255. For mixed `--all`, continue independently and select precedence failed 1, unreachable 255, unknown 4, at-risk 3, clean 0; usage errors remain 2. Malformed or contradictory documents fail closed with exit 1 and no raw subprocess output in diagnostics.
- [ ] Route `host stop --host <name> [--now]` through the recipe's stop script with script-specific binding environment and operator profile. Preserve explicit-host and provider selector checks, stopped/stopping no-op and dry-run behaviour. Let the script own the short read and warnings; at-risk, unknown or unreadable work never vetoes stopping. `--now` belongs only to stop and skips the guard read. Do not fall back to an unguarded provider stop when a recipe lacks its script.
- [ ] Add `host rebuild` and `host withdraw` with explicit `--host`, optional `--dry-run`, and mutually exclusive `--discard <repository>...` or `--discard-unreadable-host`. Validate grammar before calls; reject empty discard lists, duplicate entries, incompatible flags and misplaced options. Resolve the named operation to the recipe's destroy path, invoke it interactively with operation/override arguments, and derive the administrator profile for destroy without overwriting it with operator settings. Preserve provider account/region/selector checks and the script's exact-risk-set, same-host and typed-confirmation guards. Never pre-terminate, provision or emulate destruction in the CLI; rebuild is removal for subsequent owner rebuilding. Dry-run renders intent and remaining footprint without running destroy or a live safety probe. Noninteractive destructive execution refuses; propagate script failure without reporting success.
- [ ] Keep `host teardown` as a bounded compatibility diagnostic: exit 2, point to rebuild/withdraw and make zero provider/subprocess calls, including for its old dry-run form. Remove its destructive handler and advertised completion entry. Update all public help, completion, user guide, manual and changelog together; document the schema/exit change, stopped-host unknown state, overrides, role separation, expiry limitation and independent owner authority for every live operation.
- [ ] Add bounded public `runCli(args, dependencies)` fake-runner cases from Verify, with minimal isolated recipe fixtures carrying current manifest provenance. Run the local definition-of-done gates, applicable audits and focused diff review; submit future delivery for human review without acceptance or release.

## Files touched

Expected future implementation: [src/recipes.ts](../../src/recipes.ts), [src/harness.ts](../../src/harness.ts), [src/cli.ts](../../src/cli.ts), the existing invocation parser and completion modules identified during implementation, [src/tests/cli.test.ts](../../src/tests/cli.test.ts), minimal recipe fixtures, [agent-host user guide](../guides/user/agent-host.md), [man/techne.1](../../man/techne.1) and [CHANGELOG.md](../../CHANGELOG.md). Inspect [AWS provider resolution](../../src/providers/aws/index.ts) for script-role derivation; change only the typed resolution seam if needed to keep operator and administrator environments distinct. No provider infrastructure implementation, binding/configuration, dependency, Harness or Principal changes are planned. This planning unit edits only the two authorised canonical roadmap records.

## Verify

Future tests use temporary local files, synthetic provider responses and an injected runner through the public CLI seam. They execute no AWS, SSH, Tailscale or real Harness script.

- Validate clean/at-risk/unknown documents with exits 0/3/4, failure 1, unreachable 255, malformed JSON, wrong schema, outcome/exit mismatch, invalid repository/problem/host shapes, missing scripts/contracts and runner rejection. Assert new single/list schemas, retained nullable text, additive metadata and optional updates/profile, exact exits, bounded calls and no raw failure leakage. Stopped/absent host is unknown with no status subprocess; legacy recipe status keeps its documented text fallback but never supplies a fabricated structured clean verdict.
- Exercise mixed `--all` results, continuation and the declared exit precedence. Text expiry warnings at 14 days and overdue, unknown dates and pin drift remain verbatim supplied fixture text and do not alter safety outcome. JSON needs no advisory call; text mode uses at most one structured and one advisory read per running host and never passes `--fetch`.
- For stop, assert exact stop script, cwd, operator environment and `--now` forwarding; fake the warning/refusal-independent script results. Prove no separate CLI guard read, no provider stop fallback, no calls for dry-run/already-stopped and wrong-command flag rejection before effects. Retain provider selector/account refusals.
- For rebuild/withdraw, assert destroy script plus exact operation/override argv, administrator environment and no terminate/provision call. Model clean success, exact-risk discard success, missing/partial/extra risk-set refusal, unknown/unreachable refusal, typed unreadable confirmation refusal/success, same-host mismatch, script failure and already-removed idempotence as injected script results; these prove delegation and truthful CLI handling, not re-test shell internals. Assert invalid grammar and noninteractive refusal before invocation, dry-run without destroy, credential retention/removal descriptions and supplied remaining-footprint rendering. Old teardown always diagnoses with zero calls.
- Check help/manual/completion command inventory and compatibility guidance. Future delivery runs the pinned root Bun and documentation commands in the [definition of done](../guides/developer/definition-of-done.md), work-selector/roadmap/authoring/engineering/tool-repository and full declared audits, and `git diff --check`. Current planning verifies source contracts, immutable identity/timestamps, unchanged implementation scope of the approved patching plan, focused Markdown and audits only; it authors no tests and claims no implementation checks.

## Dependencies / blocks

The delivered Harness pilot and manifest satisfy the source prerequisite; `blocks: []`, `blocked_by: []` and `baseline_ref: null` stay unchanged. CLI-006 planning does not depend on vega recreation or patching delivery. Ready requires Kris's review of this newly published plan, then separately authorised local implementation; live operations remain the binding owner's.

Serialize future CLI-006 and [CLI-008 patching](KI-TOOL-TECHNE-CLI-008-host-patching-fields.md) writers because both change recipe/status/CLI files. Recommend the already-approved patching implementation first once its host-first gate clears, then re-ground guarded status against that result after this plan is approved. If CLI-006 is approved first while patching remains gated, it can proceed independently, but CLI-008's text-authoritative supplemental-read design then requires reviewed reconciliation against the new authoritative structured status. Neither is a build dependency on the other; no shared-project or ki-batch authority is inferred.

## Documentation impact

### Decision Records

Consume ODR-KI-PRINCIPAL-001 and ADR-KI-PRINCIPAL-006; no new policy decision or cross-repository record. Routine compatibility recommendations below await this plan's approval.

### Specifications

Harness retains `techne/recipe/v1` and `techne/host-workspace/v1`. Document the CLI-owned status v3/list v2 projection and outcome exit contract in public tests and guidance; no Harness contract mutation.

### Guides

Align command-local/root help, completion, user guide, manual and changelog for stop warning/now, guarded removal operations, teardown diagnostic, status schemas/exits and text-only expiry warnings. Inspect README for contradictory command examples and include only necessary corrections in future delivery.

### Roadmap

Keep this canonical record draft Next with null baseline. Record the exact local-planning release, publish a reviewable plan, and leave Ready/implementation to subsequent authority. No new record, closure or prune.

## Discussion

### Sequencing

The delivered durability pilot is source-grounded above. Local planning is released by Kris's 2026-10-12 words in the tools-burndown run, "lets get it out of the way"; review of this canonical plan remains the Ready gate. Future source writers are serialised as described under Dependencies / blocks.

### Compatibility recommendations

Keep teardown only as a non-destructive exit-2 diagnostic so old automation cannot bypass the guard. Version both outer status schemas because the safety projection and exits change. Treat stopped or absent workspace evidence as unknown, not clean. Preserve the supplied text expiry warning without inventing a JSON contract; JSON expiry remains unavailable until the Harness declares it. Make structured status authoritative and keep text advisory. These are bounded recommendations within the accepted durability model, subject to review of this plan.

### Adoption authority

On 12 October 2026, Kris approved the recommendation in the tools-burndown run: "I approve your recommendation, I can review it further later". Adopted as deliver/draft on Hold, intentionally parked until explicit Kris release for local planning through agent-host. Kris's later instruction the same day to "approve/accept anything awaiting review and prune all done" preserves these dispositions and does not release other held work. Adoption grants no implementation, acceptance, release, remote-agent or remote-environment authority. Local planning does not resume all agent-host work.

### Local planning release

On 12 October 2026, Kris said "lets get it out of the way" in the tools-burndown run, explicitly releasing this record for local planning toward delivery. The destination is deliver/draft Next with the hold removed. This releases canonical planning only: the resulting plan must be reviewed before Ready or implementation, and the execution baseline remains null. It grants no acceptance, release or live operation and does not resume other agent-host work.
