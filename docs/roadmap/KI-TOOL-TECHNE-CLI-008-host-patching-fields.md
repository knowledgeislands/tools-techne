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
updated_at: 2026-10-12T08:34:04Z
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

Local source inspection on 12 October 2026 used tools-techne adoption revision `633bbc0953a049ba503cb232a3473e289e6ca4a4` and the clean local ki-techne-harness checkout at `11adc5d625d102f808d306002916457116595264`. Re-read both contracts before future implementation; these observations are planning evidence, not an execution baseline.

- [Binding loading](../../src/bindings.ts) has a fixed neutral-field whitelist. `scalarText` accepts several scalar types, so adding names alone would wrongly accept strings or numbers as Livepatch booleans. Resolved binding values and provider adapters already carry strings; `scriptEnvironment` selects only manifest-declared environment names and script memberships.
- [Recipe parsing](../../src/recipes.ts) reads parameters and paths but currently discards the manifest's `[status]` schema/exit declaration. The existing test manifest predates both patching parameters and that declaration. No public `host provision` command exists: this work must not add one or imply that editing a binding changes a running host.
- [Harness invocation](../../src/harness.ts) runs the status script without arguments and preserves its text; every non-zero script exit becomes a failed workspace with `report: null`. [CLI rendering](../../src/cli.ts) embeds that text in `workspace.report` under `techne/host-status/v2` and the same host entries under `techne/host-status-list/v1`. A failed workspace produces CLI exit 1; a non-running host is skipped. Text mode already displays the Harness's Updates section verbatim when available.
- The [Harness recipe](https://github.com/knowledgeislands/ki-techne-harness/blob/main/recipes/agent-host/recipe.toml) declares both optional fields for `provision` only. Local `operations/aws/agent-host/provision.sh` validates the window and true/false values; `operations/aws/agent-host/status.sh --json` delegates to `operations/aws/agent-host/host/status.sh`, which emits the seven nullable update fields. The manifest retains `techne/host-workspace/v1` and outcome exits clean 0, failed 1, at-risk 3, unknown 4 and unreachable 255.

## Steps

- [ ] Extend neutral binding acceptance for `reboot_window` and `livepatch`. Before generic scalar conversion, require a written window to be a string matching `^([01][0-9]|2[0-3]):[0-5][0-9]$` and written Livepatch to be a TOML boolean. Reject empty strings, weekdays, whitespace, out-of-range times, numbers, string booleans, lists and tables before any provider/subprocess call. Preserve absence; stringify explicit false as `false`, never discard it. Check any resolved recipe defaults against the same window and canonical true/false semantics without inventing new defaults.
- [ ] Preserve the manifest-driven pass-through in `scriptEnvironment` and `Context.hostEnvironment`: the existing recipe maps the values to `AGENT_HOST_REBOOT_WINDOW` and `AGENT_HOST_LIVEPATCH` for `provision` only. Do not hard-code AWS parameters, spread the fields into every script, add provisioning grammar or invoke provisioning. Add optional typed parsing of the recipe's `[status]` schema and exit map solely to recognise its existing JSON-report capability; manifests without it keep the current text-only route.
- [ ] Add optional structured update extraction at the Harness boundary. Keep the existing text invocation, its report, failure detail and exit decision authoritative. Only for CLI JSON status of a running host whose text report succeeded and whose manifest declares `techne/host-workspace/v1`, request one additional stub-testable status read with `--json`, the same cwd/environment and no `--fetch`. Validate JSON object, schema and outcome/exit agreement against the manifest before projecting updates; permit clean/at-risk/unknown documents with their declared exits, and reject failed/unreachable or malformed supplemental reports. A supplemental read failure or missing member leaves updates unavailable and cannot change the original workspace state, report or CLI exit. Never make this advisory read a safety verdict.
- [ ] Project only the optional `workspace.updates` member in single-host and all-host JSON output; keep both outer schema names and existing fields/types. An omitted member stays omitted; an explicit null stays null. For an object, preserve nullable `os`, `pending`, `security`, `reboot_required`, `reboot_required_since`, `reboot_packages` and `livepatch`; accept non-negative integer counts, a boolean reboot flag, string OS/time/Livepatch state and string-list packages, each with null for unknown. Tolerate additive unknown fields without displaying raw data; reject malformed known fields as unavailable rather than coercing to zero/false. Text mode continues to use the Harness's existing Updates rendering, including security/reboot labels, with no second read or duplicated section.
- [ ] Extend the public in-process CLI suite with isolated binding/recipe fixtures and injected runner/provider responses for the cases in Verify. Add only the patching parameter and status-declaration fixture deltas needed for this contract; retain a legacy manifest fixture and avoid importing live Harness scripts or wholesale copying its unrelated operations/profile changes.
- [ ] Update the CLI user guide, manual and active changelog baseline for the two fields, optional JSON projection, null/unavailable semantics and unchanged exit behaviour. Inspect README, command help and Bash/Zsh completion for consistency; grammar is unchanged, so add no flags or commands. Run the declared verification and documentation gates before submitting future delivery for review.

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

Run the work-selector, roadmap, authoring, engineering, tool-repository and full declared repository audits. During tools-burndown, every ki invocation must be prefixed with `python3 /Users/krisbrown/.local/state/ki/agents/tools-burndown/coordination/run-ki.py`, followed by `ki` or the backup executable, and exact managed configuration must be restored after hook rewrites too. Audit before planning found no failures and two existing warnings: inline CI KI_VERSION and the absent committed `.githooks/pre-commit` gate; report these unchanged rather than repair unrelated files. Native Husky hooks still run normally.

This draft plan's verification is source/contract review, roadmap/authoring/full audits, immutable-metadata and monotonic-timestamp predicates, source-drift checks, explicit-path diff review and normal hooks. Implementation test cases above are planned, not authored or claimed to have passed.

## Dependencies / blocks

`blocks: []`, `blocked_by: []` and `baseline_ref: null` remain unchanged. The existing Harness recipe and status scripts supply the required contract; no new upstream deliverable is needed. The [operator guide](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/guides/operator/agent-host.md#patching-and-restart) owns actual patching/restart operation. This record does not depend on delivery or acceptance of the [held guarded-host record](KI-TOOL-TECHNE-CLI-006-guarded-host-commands.md). Both eventually touch status files, so serialize future writers and re-ground this plan if that work lands first; this is sequencing, not a build dependency.

Kris's 12 October steering sets recreation of the agent host as `vega` before taking this item forward. That owner-led live rebuild, correct binding/payload identity and host-readiness evidence are an operational prerequisite for the requested delivery order. The [operator runbook](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/guides/operator/agent-host.md) owns creation and setup; no live operation is added to this record's local implementation tests. Keep the binding/recipe identity `agent-host` separate from OS and Tailscale hostname `vega`. This desired ordering does not change `blocked_by: []` into a cross-repository work-record dependency or authorise the rebuild.

Decision 11 releases local planning of this record only. The [Techne Programme Hold](https://github.com/knowledgeislands/ki-principal/blob/main/Admin/Governance/Policies/Techne%20Programme%20Hold.md) and this task exclude every remote/provider/host operation. Kris must separately review the plan before Ready and authorise future implementation. No tests or source are changed by planning, no acceptance authority is claimed, and all other agent-host work stays held under its own owner.

## Documentation impact

### Decision Records

No new Decision Record: the fields, patching model and implementation ownership are settled. Consume ADR-KI-PRINCIPAL-006 and the existing Harness contract without revisiting host policy.

### Specifications

Keep `techne/host-binding/v1`, `techne/recipe/v1`, `techne/host-workspace/v1`, `techne/host-status/v2` and `techne/host-status-list/v1`. Optional status metadata and `workspace.updates` are additive; no schema bump or new specification is planned. Public CLI tests and the user guide document the adapter's observable compatibility rules; Harness remains status-contract authority.

### Guides

Document top-level TOML fields, HH:MM host-local semantics, strict boolean Livepatch, omission defaults and the fact that only a later authorised build applies the settings. Explain optional JSON updates and unknown nulls without adding credential/token instructions. Align the manual and changelog; inspect the other public surfaces without widening grammar.

### Roadmap

Enrich this existing record only, retaining draft Next and its null baseline. Add no record, change no held record and claim no execution or closure. Future Ready/delivery transitions require their own authority.

## Discussion

### Pairing

The CLI side of the harness recipe's patching model. The harness owns the recipe contract and this adapter follows it, as ADR-KI-PRINCIPAL-006 requires. Neither blocks the other: without this record the fields reach the harness scripts only through their environment variables (`AGENT_HOST_REBOOT_WINDOW` and `AGENT_HOST_LIVEPATCH`), and the `updates` member is additive to a document whose schema stays `techne/host-workspace/v1`. The parameter names are now settled in the recipe manifest, so this record can be planned.

### Adoption authority

On 12 October 2026, Kris approved the recommendation: "I approve your recommendation, I can review it further later" (tools-burndown Decision 11). Adopted as deliver/draft Next; Decision 11 explicitly releases local planning of this record only. Decision 12 preserves these dispositions and does not release other held work. Adoption grants no implementation, acceptance, release, remote-agent or remote-environment authority. Local planning does not resume all agent-host work.

### Adapter compatibility choice

The existing CLI guarantees a Harness text report, including workstation pin signals, whereas the Harness JSON route emits a different document. Replacing the text read with JSON would change `workspace.report`, its rendering and existing failure semantics, overlapping held guarded-command work. The bounded plan therefore keeps text mode unchanged and adds one advisory JSON read only for JSON consumers with a declared contract. This costs a second read for those consumers and the two reports can observe different moments; optional updates never adjudicate workspace safety or change an exit decision. A later owner-approved status redesign can remove that duplication in its own scope. No `--fetch`, provisioning route, guarded stop/rebuild/withdraw or teardown transition is included here.

### Host-first ordering

On 12 October 2026, Kris said: "KI-TOOL-TECHNE-CLI-008 - we would need to create the agent-host again first. This time we can use the new vega hostname", followed by "try now" (tools-burndown Decision 13). The read-only readiness retry and local rebuild brief do not approve this implementation plan or authorise remote changes. The plan remains draft Next with a null execution baseline until the host-first prerequisite and separate plan approval are satisfied; other owner holds remain intact.
