---
id: KI-TOOL-TECHNE-CLI-006
area: CLI
title: Guarded host commands
project: agent-host
kind: deliver
status: done
size: l
blocks: []
blocked_by: []
baseline_ref: 40156309a933a21f4292c491751625437a6fe599
created_at: 2026-10-07T20:51:00Z
updated_at: 2026-10-22T07:38:22Z
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

Source review on 20 October 2026 used tools-techne `e7dc0183c7858193c7260cd46f772cb0594d4e69` and local Harness `93664967fa9230fb3864c88f30406744d8ee2ea8`, re-grounding the 12 October review of `47707bcf` and `11adc5d6` after the host-patching delivery. These are planning observations, not an execution baseline. The existing durability pilot supplies the contract; no new upstream delivery is needed.

- [Recipe parsing](../../src/recipes.ts) now parses `[status]` into `RecipeStatus` (schema and exit map), added by the host-patching delivery, but still ignores `[operations]`. The Harness manifest declares `techne/host-workspace/v1`, clean 0, failed 1, at-risk 3, unknown 4 and unreachable 255, and `[operations.rebuild]` and `[operations.withdraw]`, each with a summary and `script = "destroy"`, the provider's `destroy` path. The [test recipe fixture](../../src/tests/fixtures/agent-host.recipe.toml) carries `[status]` and the provider's stop and destroy paths, but no `[operations]`.
- [Harness status](../../src/harness.ts) reads the text report first and treats every nonzero exit as failure. The Harness text route also exits with the outcome, so an at-risk or unknown host is reported today as a failed workspace with exit 1. The host-patching delivery added `WORKSPACE_SCHEMA`, a validator for the optional `updates` member and `workspaceUpdates`, a second, JSON-mode-only advisory `--json` read whose updates never change state or exit. [CLI status](../../src/cli.ts) uses `techne/host-status/v2`, with that advisory `workspace.updates`, and `techne/host-status-list/v1`; stopped or absent hosts are skipped. Stop directly invokes the provider; teardown directly terminates an instance.
- The CLI's `hostEnvironment` lays the provider adapter's `AWS_PROFILE` and `AWS_REGION`, resolved from the administrator profile, over the recipe's per-script values. The recipe gives `stop` the operator profile and `destroy` the administrator profile, both as `AWS_PROFILE`, so routing stop through its script as the code stands would run it under the administrator profile.
- The Harness stop script is unchanged since 12 October: it warns with a five-second status timeout, never refuses because of workspace risk, skips that read under `--now`, and waits until the instance has stopped. Destroy validates account, stack identity, report outcome/exit and same-host identity, refuses unsafe destruction, owns both discard overrides and the typed `discard <stack>` confirmation, and performs idempotent cleanup. It also refuses unless `CONFIRM_DESTROY_AGENT_HOST` equals the stack name; that variable predates the 12 October review, was missed there, and is not declared in the manifest. Since 12 October its rebuild and withdraw guidance mentions the Tailscale OAuth client; that is supplied script output. The CLI must invoke these guards rather than reproduce them.
- The Harness JSON document includes repositories, problems and optional updates/profile signals. Expiry and workstation pin warnings still exist only in its text route; JSON returns before those sections. Preserve those supplied warnings without inventing an expiry JSON field or deriving dates in this repository. The manifest's `[patching]` table and the changed workspace default affect neither this contract nor this record.

## Steps

- [x] Extend the existing `RecipeStatus` parsing with named `[operations.<name>]` entries, each a summary and a `script` naming a key of the selected provider's paths. Validate known declarations and resolve each operation's script through those paths. Keep legacy recipes usable for status; refuse a guarded operation with missing metadata/path before any subprocess. Expose the declared operations through recipe JSON without copying Harness scripts, and add them to the test fixture.
- [x] Make the declared structured report authoritative for single-host and all-host safety status in both output modes, replacing the host-patching delivery's text-first read and its separate `workspaceUpdates` read with one structured read per running host. Request `--json` without `--fetch`, validate schema, outcome/exit agreement, repositories/problems types and known host fields, and preserve unknown additive members. Embed the validated document as `workspace.safety` while retaining `workspace.report` as nullable text; keep `workspace.updates` as the existing validated projection of that same document's `updates` member, so it still never changes state or exit. Bump outer schemas to `techne/host-status/v3` and `techne/host-status-list/v2`. Distinguish reported clean/at-risk/unknown from failed or unreachable; never collapse 3/4 into failed or convert missing evidence into clean. For stopped/absent hosts, retain provider state and skipped report but expose safety as unavailable/unknown and return 4 without attempting SSH or starting a host.
- [x] Preserve the Harness text report as a bounded advisory second read in text mode, including expiry and pin warnings verbatim; it cannot replace the structured verdict. A text read exiting with the declared clean, at-risk or unknown status is a report, not a failure. JSON mode needs only the structured read, leaving text null and documenting that expiry is unavailable there until Harness declares it. Text-read failure gives a concise warning and leaves the validated outcome intact. For valid single reports return 0/3/4; actual failure returns 1 and unreachable returns 255. For mixed `--all`, continue independently and select precedence failed 1, unreachable 255, unknown 4, at-risk 3, clean 0; usage errors remain 2. Malformed or contradictory documents fail closed with exit 1 and no raw subprocess output in diagnostics.
- [x] Make script environments role-correct: a recipe parameter scoped to the running script, such as `operator_profile` for stop and `admin_profile` for destroy, must not be overwritten by the provider adapter's default `AWS_PROFILE`. Change only `hostEnvironment` or the typed provider resolution seam; status and setup environments stay as they are.
- [x] Route `host stop --host <name> [--now]` through the recipe's stop script with script-specific binding environment and operator profile. Preserve explicit-host and provider selector checks, stopped/stopping no-op and dry-run behaviour. Let the script own the short read, warnings and wait; at-risk, unknown or unreadable work never vetoes stopping. `--now` belongs only to stop and skips the guard read. Do not fall back to an unguarded provider stop when a recipe lacks its script.
- [x] Add `host rebuild` and `host withdraw` with explicit `--host`, optional `--dry-run`, and mutually exclusive `--discard <repository>...` or `--discard-unreadable-host`. Validate grammar before calls; reject empty discard lists, duplicate entries, incompatible flags and misplaced options. Resolve the named operation to the recipe's destroy path, invoke it interactively with operation/override arguments, and run it under the administrator profile from the role-correct environment. Preserve provider account/region/selector checks and the script's exact-risk-set, same-host and typed-confirmation guards. The CLI never sets `CONFIRM_DESTROY_AGENT_HOST` or any other undeclared variable; the operator's own environment passes through, and the script's refusal without it is reported as a failure. Never pre-terminate, provision or emulate destruction in the CLI; rebuild is removal for subsequent owner rebuilding. Dry-run renders intent and remaining footprint without running destroy or a live safety probe. Noninteractive destructive execution refuses; propagate script failure without reporting success.
- [x] Keep `host teardown` as a bounded compatibility diagnostic: exit 2, point to rebuild/withdraw and make zero provider/subprocess calls, including for its old dry-run form. Remove its destructive handler and advertised completion entry. Update all public help, completion, user guide, manual and changelog together; document the schema/exit change, stopped-host unknown state, overrides, role separation, expiry limitation and independent owner authority for every live operation.
- [x] Add bounded public `runCli(args, dependencies)` fake-runner cases from Verify, with minimal isolated recipe fixtures carrying current manifest provenance. Run the local definition-of-done gates, applicable audits and focused diff review; submit future delivery for human review without acceptance or release.

## Files touched

Delivered implementation: [src/recipes.ts](../../src/recipes.ts), [src/harness.ts](../../src/harness.ts), [src/cli.ts](../../src/cli.ts), the existing invocation parser and completion modules identified during implementation, [src/tests/cli.test.ts](../../src/tests/cli.test.ts), including the host-patching delivery's updates cases, the [test recipe fixture](../../src/tests/fixtures/agent-host.recipe.toml) and other minimal recipe fixtures, [agent-host user guide](../guides/user/agent-host.md), [man/techne.1](../../man/techne.1) and [CHANGELOG.md](../../CHANGELOG.md). The role-correct environment changes `hostEnvironment` in [src/cli.ts](../../src/cli.ts) or, if cleaner, only the typed resolution seam in [AWS provider resolution](../../src/providers/aws/index.ts). No provider infrastructure implementation, binding/configuration, dependency, Harness or Principal changes are planned. The 20 October replan edited only this record; the 22 October delivery changes the listed CLI and documentation paths.

## Verify

Future tests use temporary local files, synthetic provider responses and an injected runner through the public CLI seam. They execute no AWS, SSH, Tailscale or real Harness script.

- Validate clean/at-risk/unknown documents with exits 0/3/4, failure 1, unreachable 255, malformed JSON, wrong schema, outcome/exit mismatch, invalid repository/problem/host shapes, missing scripts/contracts and runner rejection. Assert new single/list schemas, retained nullable text, additive metadata and optional updates/profile, exact exits, bounded calls and no raw failure leakage. Rework the host-patching updates cases: `workspace.updates` comes from the one structured read, malformed updates are dropped without changing outcome or exit, and no separate updates read remains. A text read exiting 3 or 4 is never reported as failed. Stopped/absent host is unknown with no status subprocess; legacy recipe status keeps its documented text fallback but never supplies a fabricated structured clean verdict.
- Exercise mixed `--all` results, continuation and the declared exit precedence. Text expiry warnings at 14 days and overdue, unknown dates and pin drift remain verbatim supplied fixture text and do not alter safety outcome. JSON needs no advisory call; text mode uses at most one structured and one advisory read per running host and never passes `--fetch`.
- For stop, assert exact stop script, cwd, operator environment with `AWS_PROFILE` equal to the operator profile, and `--now` forwarding; fake the warning/refusal-independent script results. Prove no separate CLI guard read, no provider stop fallback, no calls for dry-run/already-stopped and wrong-command flag rejection before effects. Retain provider selector/account refusals.
- For rebuild/withdraw, assert destroy script plus exact operation/override argv, administrator environment with `AWS_PROFILE` equal to the administrator profile, no CLI-set confirmation variable and no terminate/provision call. Model the script's refusal without its confirmation variable as an injected failure. Model clean success, exact-risk discard success, missing/partial/extra risk-set refusal, unknown/unreachable refusal, typed unreadable confirmation refusal/success, same-host mismatch, script failure and already-removed idempotence as injected script results; these prove delegation and truthful CLI handling, not re-test shell internals. Assert invalid grammar and noninteractive refusal before invocation, dry-run without destroy, credential retention/removal descriptions and supplied remaining-footprint rendering. Old teardown always diagnoses with zero calls.
- Check help/manual/completion command inventory and compatibility guidance. Future delivery runs the pinned root Bun and documentation commands in the [definition of done](../guides/developer/definition-of-done.md), work-selector/roadmap/authoring/engineering/tool-repository and full declared audits, and `git diff --check`. Current planning verifies source contracts, immutable identity/timestamps, focused Markdown and audits only; it authors no tests and claims no implementation checks.

## Dependencies / blocks

The delivered Harness pilot and manifest satisfy the source prerequisite; `blocks: []`, `blocked_by: []` and `baseline_ref: 40156309a933a21f4292c491751625437a6fe599` stay unchanged. CLI-006 planning does not depend on vega recreation. Ready requires Kris's review of this replanned record, then separately authorised local implementation; live operations remain the binding owner's.

The [host-patching delivery](https://github.com/knowledgeislands/tools-techne/blob/854e60a3c02d7d02fdf1ca43b9c32541c6a0db04/docs/roadmap/KI-TOOL-TECHNE-CLI-008-host-patching-fields.md) landed first, as recommended, and this plan is re-grounded against its result: its text-authoritative status and supplemental updates read are reconciled in the status steps above. [KI-TOOL-TECHNE-CLI-009 (pruned)](https://github.com/knowledgeislands/tools-techne/blob/78f88656/docs/roadmap/KI-TOOL-TECHNE-CLI-009-tailscale-oauth-binding-field.md) adds a binding field the recipe will pass to `destroy`; it flows through the role-correct script environment without a change here. Neither is a build dependency, but serialise their writers because both touch binding and script-environment code. No shared-project or ki-batch authority is inferred.

## Documentation impact

### Decision Records

Consume ODR-KI-PRINCIPAL-001 and ADR-KI-PRINCIPAL-006; no new policy decision or cross-repository record. Routine compatibility recommendations below await this plan's approval.

### Specifications

Harness retains `techne/recipe/v1` and `techne/host-workspace/v1`. Document the CLI-owned status v3/list v2 projection and outcome exit contract in public tests and guidance; no Harness contract mutation.

### Guides

Align command-local/root help, completion, user guide, manual and changelog for stop warning/now, guarded removal operations, teardown diagnostic, status schemas/exits, the retained `workspace.updates` member and text-only expiry warnings. For rebuild and withdraw, point to the Harness operator guide for the destroy script's own confirmation requirement rather than restating it. Inspect README for contradictory command examples and include only necessary corrections in future delivery.

### Roadmap

The 20 October replan left this canonical record draft Next with a null baseline. The 22 October approval releases Ready and the separate overnight task authorises offline delivery, which records its baseline and submits the result for review. No new record, acceptance, closure or prune.

## Review

### Delivered

The approved guarded-host boundary is implemented locally from immutable baseline `40156309a933a21f4292c491751625437a6fe599`. The Ready release and offline implementation authority are recorded below; the record transitioned through Ready and in-progress to awaiting-review in this delivery. Read-only manifest/script contract inspection used local Harness `32f1b1e489a6f9a38bb2578b15150a13f04775db`; the fixture keeps minimal isolated setup/status defaults. All behaviour was exercised through isolated fixture checkouts and injected subprocess responses; no AWS, SSH, Tailscale, real Harness script or live host was invoked. No provisioning, release, acceptance or infrastructure changes are included.

### Change Summary

[Recipe parsing](../../src/recipes.ts) exposes declared operations and validates their metadata. [Harness execution](../../src/harness.ts) validates the authoritative structured document, outcome/exit agreement, repository/problem and host shapes, preserves additive metadata and projects optional updates from the same read. [CLI commands](../../src/cli.ts) expose status v3/list v2, stopped/absent unknown status, aggregate exit precedence, bounded advisory text, role-correct stop/destroy environments, guarded removal and a zero-effect teardown diagnostic. [Invocation parsing](../../src/config.ts), [completion](../../src/completion.ts), [public CLI tests](../../src/tests/cli.test.ts), the [minimal recipe fixture](../../src/tests/fixtures/agent-host.recipe.toml), README, user guide, manual and changelog are aligned.

No plan expansion was required. An additive `workspace.outcome` makes unavailable evidence explicit while `workspace.safety` remains nullable. A legacy recipe keeps its text fallback but returns unknown, never a fabricated structured clean verdict. Reports claiming safer outcomes than their repository or inventory evidence fail closed. Malformed optional updates are omitted from the safety document and its projection without changing the core verdict.

#### Review corrections

Independent review of delivery `41b6fd40` found that the earlier safer-than-evidence claim was incomplete: a repository labelled clean could still contain dirty files, unpushed commits, stashes or an inspection problem. Each case now has its own public `runCli` regression, and contradictory repository fields fail closed with exit 1 and no raw document. An inspection problem requires unknown repository state. Tracking-upstream drift remains advisory: the Harness counts unpushed commits against all remote-tracking branches, so ahead/behind counts alone do not contradict clean evidence. Conservative top-level outcomes do not excuse inconsistent repository fields. A zero-count clean repository, including a null upstream, remains valid, and unknown repositories may retain partial inspection evidence.

The additional reviews' profile-selection concern is resolved by deriving environment precedence from the recipe's declared operation script rather than the literal destroy script name. An aliased operation with its own scoped profile has a public-seam regression; the original name-based implementation fails it. The stop regression now requires completed-stop wording after the guarded script returns. Existing status/setup profile behaviour remains covered.

The provider-check wording is clarified: rebuild and withdraw retain CLI provider-option and explicit-host validation, while the destroy script owns account, stack and same-host checks through its declared environment. They perform no CLI-side AWS identity or instance lookup. CLI tests certify delegation and truthful handling of injected guard results, not those Harness internals.

The twelve inbound links in eleven Principal work-package files identified by review remain untouched for a later prune run. This record remains awaiting-review; no acceptance, pruning, new work record or live operation is included.

### Verification

All final gates passed on 22 October 2026 using the pinned root Bun 1.4.2. Installed local binaries were used instead of download-capable `bunx`; frozen dependency checks used offline mode and skipped lifecycle scripts to avoid network and environment mutation.

- `bun install --offline --frozen-lockfile --ignore-scripts`: passed, lockfile unchanged.
- `bun install --offline --frozen-lockfile --ignore-scripts --cwd tooling/depcruise`: passed, lockfile unchanged.
- `bun run test`: passed, 115 tests across five files.
- `bun run test:coverage`: passed, 100% statements, branches, functions and lines (1,184 statements, 860 branches, 230 functions, 1,069 lines).
- `bun run self:typecheck`: passed.
- `bun run build`: passed.
- `bun run self:release:test`: passed, local archive/installer fixtures only; an earlier manual line-length failure was corrected before this final run.
- `bun run ki:tools:lint-man`: passed.
- `node_modules/.bin/biome check .`: passed.
- `node_modules/.bin/rumdl check .`: passed.
- `ki repo audit --repo . --progress never --concise --reporter-levels FAIL`: passed, no failures; the same six warning findings as preflight remain. The follow-up audit caught an extra level-three Review heading, corrected to a nested subsection before the final run. This includes the declared work-selector, roadmap, authoring, engineering and tool-repository layers; judgment-only criteria are not automated passes.
- `git diff --check`: passed.

Focused diff review confirmed bounded command grammar, no direct destructive provider call, script-specific roles, truthful refusal handling, continuation after unexpected provider failures, bounded diagnostics and aligned help/completion/manual guidance. No actual host operation occurred.

### Outstanding concerns

No live verification is included or required for this offline delivery boundary. Any attended status/stop/rebuild/withdraw exercise on vega is a separately authorised binding-owner operation for Kris; no live step blocks the local implementation, and none was attempted. The Harness’s own risk-set, typed-confirmation and cleanup internals are modelled as injected script results, not reimplemented or certified by CLI tests. Expiry/pin warnings remain text-only until the Harness declares their JSON contract. Acceptance and any product release remain outstanding human decisions, with no new work record created under CAPTURE-GATE.

### Post-change review

The delivered CLI follows the Harness guard instead of directly terminating or reproducing safety checks. Malformed or absent safety evidence cannot appear clean, advisory read failures cannot override a validated verdict, removal dry runs make no subprocess calls, and script failures cannot produce a success message. Provider selection checks and status/setup environment behaviour remain covered. The final gates passed and the change is awaiting review; it supplies no authority for live operations.

### Mini recap

Guarded stop/rebuild/withdraw and authoritative status are delivered within the approved boundary. Tests cover outcomes, malformed documents and updates, mixed-host continuation/precedence, script roles, exact argv, refusal results, grammar and zero-effect compatibility. Operator guidance is the durable learning route; no cross-repository knowledge promotion or new backlog item is needed. Review and any attended owner exercise remain with Kris.

## Done

Accepted 2026-10-22 by Kris on the review packet above.

## Discussion

### Sequencing

The delivered durability pilot is source-grounded above. Local planning is released by Kris's 2026-10-12 words in the tools-burndown run, "lets get it out of the way"; review of this canonical plan remains the Ready gate. Future source writers are serialised as described under Dependencies / blocks.

### Compatibility recommendations

Keep teardown only as a non-destructive exit-2 diagnostic so old automation cannot bypass the guard. Version both outer status schemas because the safety projection and exits change. Treat stopped or absent workspace evidence as unknown, not clean. Preserve the supplied text expiry warning without inventing a JSON contract; JSON expiry remains unavailable until the Harness declares it. Make structured status authoritative and keep text advisory. Keep `workspace.updates` in v3, filled from the one structured read, so consumers of the host-patching field keep it. Pass the destroy script's confirmation variable through from the operator's environment rather than having the CLI set a variable the manifest does not declare. These are bounded recommendations within the accepted durability model, subject to review of this plan.

### Adoption authority

On 12 October 2026, Kris approved the recommendation in the tools-burndown run: "I approve your recommendation, I can review it further later". Adopted as deliver/draft on Hold, intentionally parked until explicit Kris release for local planning through agent-host. Kris's later instruction the same day to "approve/accept anything awaiting review and prune all done" preserves these dispositions and does not release other held work. Adoption grants no implementation, acceptance, release, remote-agent or remote-environment authority. Local planning does not resume all agent-host work.

### Local planning release

On 12 October 2026, Kris said "lets get it out of the way" in the tools-burndown run, explicitly releasing this record for local planning toward delivery. The destination is deliver/draft Next with the hold removed. This releases canonical planning only: the resulting plan must be reviewed before Ready or implementation, and the execution baseline remains null. It grants no acceptance, release or live operation and does not resume other agent-host work.

### Hold

On 14 October 2026 Kris approved the state-of-play thread's roadmap census as written ('RC-ALL: approve all'): held to 2026-11-12, because the agent-host work it serves is on hold. The plan above is kept as it stands; review it again on that date or when agent-host work resumes. The hold grants no planning, implementation or acceptance authority.

### Release

On 20 October 2026 the agent-host work's resume run released this record under Kris's overnight authority ("You can do anything on a high confidence level that you recommend"). Its hold condition is met: the Techne Programme Focus in `ki-principal` replaced the Techne Programme Hold, and agent-host work resumed under it, with the agent host in focus. The destination is `deliver / draft / next`, the one its local planning release set. Scope and dependencies are unchanged: the plan above still waits for Kris's review before Ready, and the release grants no implementation, acceptance, release or live operation.

### Replan

On 20 October 2026 the agent-host work re-checked this plan against the current tools-techne and Harness sources, as the plan asked, under Kris's overnight authority. The goal, boundary and destination are unchanged. The re-check found the host-patching delivery's `[status]` parsing, updates validation and separate updates read to build on, the shipped text route reporting at-risk and unknown hosts as failed, the provider profile overriding the recipe's operator and administrator profiles in script environments, and the destroy script's undeclared confirmation variable. Current state, Steps, Files touched, Verify and Dependencies now carry them. The record stays draft until Kris reviews it.

### Ready and offline delivery authority

On 22 October 2026 at 02:25 BST, Kris answered TECHNE-006-REVIEW a), releasing this replanned record to Ready. The overnight burn-down task separately authorises its local implementation using isolated fixtures and dry runs only, with no real host operations, acceptance or release.

### Acceptance authority and evidence

Accepted on 22 October 2026 under Kris's 21 October 14:46 BST triple-review grant, as expressly applied to this record by the `wow-accept-cli006` task: "three agreeing high-confidence reviews stand in for acceptance". The three independent high-confidence reviews assess the same delivered revision, `492e05359729e80515b789fdb014eee392b2f8e3`, including the correction to contradictory repository evidence: [review a](</Users/krisbrown/.local/state/ki/agents/ways-of-working/wow-rev3-cli006-a.report.md>), [review b](</Users/krisbrown/.local/state/ki/agents/ways-of-working/wow-rev3-cli006-b.report.md>) and [review c](</Users/krisbrown/.local/state/ki/agents/ways-of-working/wow-rev3-cli006-c.report.md>). All three support delivery acceptance. Review a's REFUSE verdict concerns immediate pruning and explicitly distinguishes it from supportable acceptance; reviews b and c also require reference reconciliation before pruning.

The accepted record is retained. The reviews' inbound-reference inventories and stale Principal entries are carried into the acceptance run report for a later, separately authorised reconciliation and prune. No Principal file is changed. Acceptance grants no release or live-operation authority; the offline verification limits in the Review remain in force.
