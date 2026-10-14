---
id: KI-TOOL-TECHNE-CLI-008
area: CLI
title: Host patching binding fields
project: agent-host
kind: deliver
status: done
blocks: []
blocked_by: []
baseline_ref: 4a59790cbf285b256178ec75d19dd249df40513f
created_at: 2026-10-09T15:42:04Z
updated_at: 2026-10-13T22:50:23Z
---

# Host Patching Binding Fields

## Goal

A `agent-host` binding can set the optional `reboot_window` and `livepatch` fields that the harness recipe's patching model reads, and `techne host status` shows the optional `updates` member of the `techne/host-workspace/v1` status document.

## Context

The `agent-host` recipe in `ki-techne-harness` now makes OS patching part of the host: security updates install unattended, a reboot happens only at an optional daily host-local window (`HH:MM`, such as `04:00`) when one is required and nobody is logged in, Livepatch is opt-in, and pending updates and reboot-required are reported in the status document's optional `updates` member without ever changing the outcome. With no window the host never restarts itself. The [recipe manifest](https://github.com/knowledgeislands/ki-techne-harness/blob/main/recipes/agent-host/recipe.toml) declares the two optional parameters, `reboot_window` and `livepatch`, and the [operator guide's patching section](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/guides/operator/agent-host.md#patching-and-restart) describes the behaviour. The binding owner settled these choices on 2026-10-09 in the Techne run: the six patching decisions 'all as recommended', then the amendment that the reboot window is a daily local time, "any day at 04:00 is fine".

`src/bindings.ts` accepts only the fixed `NEUTRAL_FIELDS` list plus each provider's binding fields, so the two new recipe parameters cannot be written in a binding until this repository accepts them.

## Boundary

- In scope: accepting `reboot_window` and `livepatch` as optional binding fields, validating the window's form (a 24-hour `HH:MM` with no weekday) and Livepatch's boolean value; passing them to the harness scripts as their recipe parameters; rendering the optional `updates` member (pending and security counts, reboot required and since when, Livepatch state) in `techne host status` text and JSON output without changing the exit status; stubbed tests.
- Out of scope: the recipe, boot script, status script and banner, which the harness owns; Ubuntu Pro attachment and any token handling, which the binding owner does; and any remote action.

## Current state

Local source inspection on 12 October 2026 used tools-techne adoption revision `633bbc0953a049ba503cb232a3473e289e6ca4a4` and the clean local ki-techne-harness checkout at `11adc5d625d102f808d306002916457116595264`. Re-read both contracts before future implementation; these observations are planning evidence, not an execution baseline. Re-grounding for the Ready transition on 12 October 2026 found no drift: `src/` is unchanged from the adoption revision to `4a59790cbf285b256178ec75d19dd249df40513f`, the Harness checkout is still clean at `11adc5d625d102f808d306002916457116595264`, and its recipe, status exit map and seven nullable `updates` fields match the observations below.

- [Binding loading](../../src/bindings.ts) has a fixed neutral-field whitelist. `scalarText` accepts several scalar types, so adding names alone would wrongly accept strings or numbers as Livepatch booleans. Resolved binding values and provider adapters already carry strings; `scriptEnvironment` selects only manifest-declared environment names and script memberships.
- [Recipe parsing](../../src/recipes.ts) reads parameters and paths but currently discards the manifest's `[status]` schema/exit declaration. The existing test manifest predates both patching parameters and that declaration. No public `host provision` command exists: this work must not add one or imply that editing a binding changes a running host.
- [Harness invocation](../../src/harness.ts) runs the status script without arguments and preserves its text; every non-zero script exit becomes a failed workspace with `report: null`. [CLI rendering](../../src/cli.ts) embeds that text in `workspace.report` under `techne/host-status/v2` and the same host entries under `techne/host-status-list/v1`. A failed workspace produces CLI exit 1; a non-running host is skipped. Text mode already displays the Harness's Updates section verbatim when available.
- The [Harness recipe](https://github.com/knowledgeislands/ki-techne-harness/blob/main/recipes/agent-host/recipe.toml) declares both optional fields for `provision` only. Local `operations/aws/agent-host/provision.sh` validates the window and true/false values; `operations/aws/agent-host/status.sh --json` delegates to `operations/aws/agent-host/host/status.sh`, which emits the seven nullable update fields. The manifest retains `techne/host-workspace/v1` and outcome exits clean 0, failed 1, at-risk 3, unknown 4 and unreachable 255.

## Steps

- [x] Extend neutral binding acceptance for `reboot_window` and `livepatch`. Before generic scalar conversion, require a written window to be a string matching `^([01][0-9]|2[0-3]):[0-5][0-9]$` and written Livepatch to be a TOML boolean. Reject empty strings, weekdays, whitespace, out-of-range times, numbers, string booleans, lists and tables before any provider/subprocess call. Preserve absence; stringify explicit false as `false`, never discard it. Check any resolved recipe defaults against the same window and canonical true/false semantics without inventing new defaults.
- [x] Preserve the manifest-driven pass-through in `scriptEnvironment` and `Context.hostEnvironment`: the existing recipe maps the values to `AGENT_HOST_REBOOT_WINDOW` and `AGENT_HOST_LIVEPATCH` for `provision` only. Do not hard-code AWS parameters, spread the fields into every script, add provisioning grammar or invoke provisioning. Add optional typed parsing of the recipe's `[status]` schema and exit map solely to recognise its existing JSON-report capability; manifests without it keep the current text-only route.
- [x] Add optional structured update extraction at the Harness boundary. Keep the existing text invocation, its report, failure detail and exit decision authoritative. Only for CLI JSON status of a running host whose text report succeeded and whose manifest declares `techne/host-workspace/v1`, request one additional stub-testable status read with `--json`, the same cwd/environment and no `--fetch`. Validate JSON object, schema and outcome/exit agreement against the manifest before projecting updates; permit clean/at-risk/unknown documents with their declared exits, and reject failed/unreachable or malformed supplemental reports. A supplemental read failure or missing member leaves updates unavailable and cannot change the original workspace state, report or CLI exit. Never make this advisory read a safety verdict.
- [x] Project only the optional `workspace.updates` member in single-host and all-host JSON output; keep both outer schema names and existing fields/types. An omitted member stays omitted; an explicit null stays null. For an object, preserve nullable `os`, `pending`, `security`, `reboot_required`, `reboot_required_since`, `reboot_packages` and `livepatch`; accept non-negative integer counts, a boolean reboot flag, string OS/time/Livepatch state and string-list packages, each with null for unknown. Tolerate additive unknown fields without displaying raw data; reject malformed known fields as unavailable rather than coercing to zero/false. Text mode continues to use the Harness's existing Updates rendering, including security/reboot labels, with no second read or duplicated section.
- [x] Extend the public in-process CLI suite with isolated binding/recipe fixtures and injected runner/provider responses for the cases in Verify. Add only the patching parameter and status-declaration fixture deltas needed for this contract; retain a legacy manifest fixture and avoid importing live Harness scripts or wholesale copying its unrelated operations/profile changes.
- [x] Update the CLI user guide, manual and active changelog baseline for the two fields, optional JSON projection, null/unavailable semantics and unchanged exit behaviour. Inspect README, command help and Bash/Zsh completion for consistency; grammar is unchanged, so add no flags or commands. Run the declared verification and documentation gates before submitting future delivery for review.

## Files touched

Expected implementation scope, all in tools-techne:

- [src/bindings.ts](../../src/bindings.ts): neutral names and field-specific validation; retain generic environment derivation.
- [src/recipes.ts](../../src/recipes.ts): optional manifest status contract in the existing recipe model/parser.
- [src/harness.ts](../../src/harness.ts): nullable update type, supplemental JSON validation and optional extraction within the subprocess boundary.
- [src/cli.ts](../../src/cli.ts): request the optional projection for JSON status and render it in existing host entries; keep text and command grammar intact.
- [src/tests/cli.test.ts](../../src/tests/cli.test.ts) and [agent-host recipe fixture](../../src/tests/fixtures/agent-host.recipe.toml): public CLI contract cases and minimal vendored fixture metadata with current Harness provenance.
- [Agent-host user guide](../guides/user/agent-host.md), [man/techne.1](../../man/techne.1) and [CHANGELOG.md](../../CHANGELOG.md): configuration/output documentation.
- This canonical record: eventual authorised lifecycle and verification evidence. This planning unit changes this record only.

Provider clients, `src/toml.ts`, runtime configuration, dependency/boundary rules, README and completion sources are inspection-only unless a demonstrated contradiction requires a separately reviewed plan adjustment. No Harness or Principal write is planned.

## Verify

Future implementation tests must enter through `runCli(args, dependencies)` with temporary local files and a fake runner; no real AWS, SSH, Tailscale, Ubuntu Pro or host script executes.

- Accept absent fields, boundary windows `00:00`/`23:59`, typical `04:00`, and both boolean values. Reject malformed/window-with-weekday and non-boolean Livepatch inputs before any runner/provider call. Prove explicit false survives resolved adapter values and omitted values stay absent.
- Through `recipe show --json`, assert the canonical environment names and `scripts: ["provision"]`. Through a stub provider and synthetic recipe declaring the fields for `setup`, exercise existing environment derivation via `host setup` and assert exact emitted values. With the canonical fixture, assert neither field leaks into setup/status environments. This tests pass-through without adding or running a provisioning command.
- For single-host/all-host JSON, inject text then structured responses containing Ubuntu counts, a required reboot with timestamp/packages, false, zeros, all-null values, macOS unknown reboot and Livepatch `unsupported`/`enabled`/`disabled`/`applied`. Assert optional projection and unchanged original report/details/schemas. Absent updates remain absent and explicit null is retained.
- Inject missing declarations, missing scripts, absent/stopped hosts, invalid JSON, wrong schema, mismatched outcome/exit, invalid known field types, negative/fractional counts and supplemental 1/255 exits or runner rejection. Assert no optimistic defaults, no raw supplemental output/identifier leakage, bounded calls and preserved legacy output/exit decisions. Unknown additive document/member fields remain compatible.
- Preserve primary text exit behaviour: 0 gives reported/CLI 0; 1/3/4/255 give failed/report null/CLI 1. Supplemental valid 3/4 documents may supply advisory updates but cannot replace the primary decision. Exercise `--all` mixed success/failure and continuation; retain provider safety and text-only legacy recipes. Text Updates render once, verbatim, with null/unknown information never rewritten as healthy.

Run the pinned root Bun gates from the [definition of done](../guides/developer/definition-of-done.md): `bun run test`, `bun run test:coverage`, `bun run self:typecheck`, `bun run build`, `bun run self:release:test`, `bun run ki:tools:lint-man`, `bunx biome check .`, `bunx rumdl check .` and `git diff --check`. Verify frozen root/boundary dependencies are present before those checks; install only with separately available local dependencies, without remote/provider operations. Include the existing boundary, CLI inventory/help/completion and isolated installer/package suites; render/read the edited manual. Packaging tests create local fixtures, not a release.

Run the work-selector, roadmap, authoring, engineering, tool-repository and full declared repository audits. The tools-burndown `run-ki.py` wrapper requirement applied only to that finished run; call `ki` normally. Audit before planning found no failures and two existing warnings: inline CI KI_VERSION and the absent committed `.githooks/pre-commit` gate; report these unchanged rather than repair unrelated files. Native Husky hooks still run normally.

This draft plan's verification is source/contract review, roadmap/authoring/full audits, immutable-metadata and monotonic-timestamp predicates, source-drift checks, explicit-path diff review and normal hooks. Implementation test cases above are planned, not authored or claimed to have passed.

## Dependencies / blocks

`blocks: []` and `blocked_by: []` remain unchanged; the Ready transition sets `baseline_ref` to the revision it was planned against. The existing Harness recipe and status scripts supply the required contract; no new upstream deliverable is needed. The [operator guide](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/guides/operator/agent-host.md#patching-and-restart) owns actual patching/restart operation. This record does not depend on delivery or acceptance of the [held guarded-host record](KI-TOOL-TECHNE-CLI-006-guarded-host-commands.md). Both eventually touch status files, so serialize future writers and re-ground this plan if that work lands first; this is sequencing, not a build dependency.

Kris's 12 October steering sets recreation of the agent host as `vega` before taking this item forward. That owner-led live rebuild, correct binding/payload identity and host-readiness evidence are an operational prerequisite for the requested delivery order. The [operator runbook](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/guides/operator/agent-host.md) owns creation and setup; no live operation is added to this record's local implementation tests. Keep the binding/recipe identity `agent-host` separate from OS and Tailscale hostname `vega`. This desired ordering does not change `blocked_by: []` into a cross-repository work-record dependency or authorise the rebuild.

Kris's 2026-10-12 approval in the tools-burndown run, "I approve your recommendation, I can review it further later", releases local planning of this record only. The [Techne Programme Hold](https://github.com/knowledgeislands/ki-principal/blob/main/Admin/Governance/Policies/Techne%20Programme%20Hold.md) and this task exclude every remote/provider/host operation. Kris's "sure" of 2026-10-12 in the tools-burndown run approves the published local plan/implementation; the owner-requested vega-first ordering remains pending while the explicit ordering question is unanswered. This planning lane makes no Ready transition or source change. No tests or source are changed by planning, no acceptance authority is claimed, and all other agent-host work stays held under its own owner.

## Documentation impact

### Decision Records

No new Decision Record: the fields, patching model and implementation ownership are settled. Consume ADR-KI-PRINCIPAL-006 and the existing Harness contract without revisiting host policy.

### Specifications

Keep `techne/host-binding/v1`, `techne/recipe/v1`, `techne/host-workspace/v1`, `techne/host-status/v2` and `techne/host-status-list/v1`. Optional status metadata and `workspace.updates` are additive; no schema bump or new specification is planned. Public CLI tests and the user guide document the adapter's observable compatibility rules; Harness remains status-contract authority.

### Guides

Document top-level TOML fields, HH:MM host-local semantics, strict boolean Livepatch, omission defaults and the fact that only a later authorised build applies the settings. Explain optional JSON updates and unknown nulls without adding credential/token instructions. Align the manual and changelog; inspect the other public surfaces without widening grammar.

### Roadmap

Enrich this existing record only. Kris's 2026-10-12 approval in the Techne run of 'parallel local implementation before the vega rebuild' moves it to Ready at Next with its baseline at `4a59790cbf285b256178ec75d19dd249df40513f`. Add no record, change no held record and claim no closure.

## Review

### Delivered

Delivered the approved boundary locally under Kris's 2026-10-12 approval of parallel local implementation, from baseline `4a59790cbf285b256178ec75d19dd249df40513f` through the record-only Ready commit `293a6c1`: an `agent-host` binding accepts optional `reboot_window` (24-hour `HH:MM`) and `livepatch` (TOML boolean) fields, the recipe's declared parameters pass them only to the scripts that list them, and `techne host status --json` projects the status document's optional `updates` member as `workspace.updates` from one advisory supplemental read. Excluded as planned: the Harness recipe and scripts, Ubuntu Pro and token handling, provisioning grammar, `--fetch`, guarded commands, and every remote, provider or host operation. Live verification on vega was not performed and waits for the owner-led rebuild.

### Change Summary

- [src/bindings.ts](../../src/bindings.ts): adds both fields to `NEUTRAL_FIELDS`; refuses a non-string or malformed window and a non-boolean Livepatch before any provider table or subprocess, and checks resolved recipe defaults against the same forms. Explicit `false` becomes `"false"`; absence stays absent. Environment derivation is unchanged.
- [src/recipes.ts](../../src/recipes.ts): parses an optional `[status]` declaration (required `schema`, integer `exit` map from 0 to 255) as `Recipe.status`, null when absent.
- [src/harness.ts](../../src/harness.ts): adds `HostUpdates` and `HarnessCheckout.workspaceUpdates`, which runs the status script once with `--json` (same cwd and environment, no `--fetch`) only for a `techne/host-workspace/v1` declaration. It accepts only a JSON object of that schema whose `clean`, `at-risk` or `unknown` outcome matches its declared exit, then requires all seven known fields with their nullable types; additive fields are dropped. Any other result, including runner rejection, leaves updates unavailable.
- [src/cli.ts](../../src/cli.ts): `statusOf` requests updates only for JSON output and a reported workspace; text mode keeps the single read and the Harness's own Updates section. Outer schemas, existing fields, state and exit decisions are unchanged.
- [src/tests/cli.test.ts](../../src/tests/cli.test.ts) and the [agent-host fixture](../../src/tests/fixtures/agent-host.recipe.toml): 12 public `runCli` cases; the fixture gains the `[status]` declaration and both optional parameters with Harness `11adc5d` provenance. Legacy text-only behaviour is exercised by removing the declaration or changing its schema, and by the unchanged `multi` fixture.
- [Agent-host user guide](../guides/user/agent-host.md), [man/techne.1](../../man/techne.1) and [CHANGELOG.md](../../CHANGELOG.md): patching settings, build-time application, JSON projection, null and unavailable semantics, and unchanged exit behaviour. README, command help and Bash/Zsh completion were inspected and need no change because the grammar is unchanged.

No approved deviation. One implementation choice within the plan: a known update field that is missing makes the whole member unavailable, as for a malformed one, rather than being projected as null.

### Verification

All run from the repository root with the pinned Bun, after integration:

- `bun run test`: 101 passed, 0 failed.
- `bun run test:coverage`: 101 passed; 100% statements, branches, functions and lines.
- `bun run self:typecheck`, `bun run build`, `bun run self:release:test`, `bun run ki:tools:lint-man`, `bunx biome check .`, `bunx rumdl check .` and `git diff --check`: all exit 0.
- The edited manual renders through `mandoc` and passes `mandoc -Tlint` without findings.
- `ki repo audit` with `ki-work`, `ki-work-roadmap`, `ki-authoring` and `ki-repo-tools`: PASS. `ki-engineering` and the full declared audit: no failures, with only the two existing warnings (inline CI `KI_VERSION`; no committed `.githooks/pre-commit`), left unchanged as planned.
- Tests use the fake runner and stub provider only; no AWS, SSH, Tailscale, Ubuntu Pro or host script ran.

### Outstanding concerns

- Live behaviour against a rebuilt vega host is unverified until the owner-led rebuild supplies a real status document.
- The JSON route reads status twice per running host, so the text report and `updates` may observe slightly different moments; this is the accepted cost recorded under Adapter compatibility choice.
- The fixture is a vendored subset of Harness `11adc5d`; a later Harness change to the update fields or exit map needs this adapter re-grounded.

### Post-change review

The goal is met within scope: both fields are accepted only in their documented forms, reach only declaring scripts, and the optional `updates` member appears in single-host and `--all` JSON without altering any existing field, schema, text output, state or exit decision. Regression risk is low: existing tests pass unchanged, the extra read is confined to JSON status of a running host with a reported workspace and a declaring recipe, and every failure of that read is silent and bounded to one call. The record is ready for owner review; acceptance should note that live verification remains pending.

### Mini recap

Implemented host patching binding fields and the advisory JSON `updates` projection in tools-techne with stubbed tests; every declared gate passed with full coverage and only the two existing audit warnings. Concern: live verification awaits the vega rebuild. Proposed learning route, not promoted: the advisory-supplemental-read pattern (primary read authoritative, secondary read silently optional) could be noted in the developer guide if later status work reuses it.

## Done

Accepted 2026-10-13 by Kris Brown on the review packet above.

## Discussion

### Pairing

The CLI side of the harness recipe's patching model. The harness owns the recipe contract and this adapter follows it, as ADR-KI-PRINCIPAL-006 requires. Neither blocks the other: without this record the fields reach the harness scripts only through their environment variables (`AGENT_HOST_REBOOT_WINDOW` and `AGENT_HOST_LIVEPATCH`), and the `updates` member is additive to a document whose schema stays `techne/host-workspace/v1`. The parameter names are now settled in the recipe manifest, so this record can be planned.

### Adoption authority

On 12 October 2026, Kris approved the recommendation in the tools-burndown run: "I approve your recommendation, I can review it further later". Adopted as deliver/draft Next; that approval explicitly releases local planning of this record only. Kris's later instruction the same day to "approve/accept anything awaiting review and prune all done" preserves these dispositions and does not release other held work. Adoption grants no implementation, acceptance, release, remote-agent or remote-environment authority. Local planning does not resume all agent-host work.

### Adapter compatibility choice

The existing CLI guarantees a Harness text report, including workstation pin signals, whereas the Harness JSON route emits a different document. Replacing the text read with JSON would change `workspace.report`, its rendering and existing failure semantics, overlapping held guarded-command work. The bounded plan therefore keeps text mode unchanged and adds one advisory JSON read only for JSON consumers with a declared contract. This costs a second read for those consumers and the two reports can observe different moments; optional updates never adjudicate workspace safety or change an exit decision. A later owner-approved status redesign can remove that duplication in its own scope. No `--fetch`, provisioning route, guarded stop/rebuild/withdraw or teardown transition is included here.

### Host-first ordering

On 12 October 2026, Kris said: "KI-TOOL-TECHNE-CLI-008 - we would need to create the agent-host again first. This time we can use the new vega hostname", followed by "try now", in the tools-burndown run. The read-only readiness retry and local rebuild brief do not approve this implementation plan or authorise remote changes. Kris's "sure" later the same day approves the published local plan/implementation. The plan remains draft Next with a null execution baseline until the host-first prerequisite is satisfied or Kris explicitly permits parallel local implementation; other owner holds remain intact.

### Published plan approval and remaining gate

On 12 October 2026, Kris replied "sure" to the already-published local plan/implementation in the tools-burndown run. This records approval of the existing Steps, Files touched and Verify without replanning their scope. The pending async ordering question has no answer in the current run decisions/steering, so the earlier vega-first instruction remains in force. The current Techne agent-host checkpoint contains only a historical missing-host snapshot and an owner-led rebuild/readiness sequence, not completed vega readiness evidence. No live verification is performed here.

This record is independently eligible for later Ready and local implementation only after the owner supplies current vega readiness evidence or explicitly approves parallel local implementation. Plan approval itself is already satisfied; do not request it again. No Ready transition or implementation occurs in this planning lane. The existing Harness contract is present and there is no build dependency on guarded commands. Serialize future source writers; prefer this approved implementation first after its ordering gate clears, then re-ground the newly planned guarded status integration. If guarded commands land first, review the resulting status-contract reconciliation before implementing this record; approval/order recording here does not change its implementation scope or imply ki-batch authority.

### Parallel local implementation approval

On 12 October 2026, Kris explicitly approved parallel local implementation before the vega rebuild, recorded in the Techne run as the handover of Kris's state-of-play instruction that evening to 'hand over to Techne: agent-host thread; Kris thinks it is close to moving forward'. This lifts the host-first ordering gate for local work only: the record moves to Ready and may be implemented in tools-techne with stubbed tests, stopping at awaiting-review. Live verification still waits for the owner-led vega rebuild and its readiness evidence. No AWS, SSH, Tailscale, Ubuntu Pro or host action is authorised, and the Techne Programme Hold is otherwise unchanged. The guarded-host record is still draft, so this record lands first and the guarded work re-grounds against it.

### Acceptance

On 13 October 2026, Kris accepted this record via `ki-accept` without pruning, in the Techne run: 'accept KI-TOOL-TECHNE-CLI-008 via ki-accept, no prune'. Live verification against a real host waits for the owner-led vega rebuild and is not part of acceptance; it is not authorised here, and the Techne Programme Hold is unchanged.
