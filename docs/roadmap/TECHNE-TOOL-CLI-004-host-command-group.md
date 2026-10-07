---
id: TECHNE-TOOL-CLI-004
area: CLI
title: Add host command group
theme: cli
horizon: now
status: done
blocks: []
blocked_by: []
baseline_ref: 420e671e6a99375a8898d489f4fbf31db2a0d199
created_at: 2026-10-07T06:35:19Z
updated_at: 2026-10-07T11:31:40Z
---

# Add host command group

## Goal

Operators manage the single Techne agent host through the `techne` command-line interface, with the same safety guards they rely on today, rather than through a personal chezmoi helper script.

## Context

ADR-TECHNE-003 assigns the public `techne` command grammar to `tools-techne`, the agent-host stack and host payloads to `ki-techne-harness`, and leaves chezmoi with only the principal's personal configuration. The agent-host operator surface currently sits on the wrong side of that boundary: the chezmoi helper `techne-agent-host` (DOTFILES-UE-068) provides connect, stop and teardown, while the harness is settling setup and status under TECHNE-TOOLS-OPS-011, with OPS-009 as related harness context.

The proposed grammar sits alongside the existing `techne controller status|bootstrap` group:

```text
techne host connect
techne host start
techne host stop
techne host status
techne host setup
techne host teardown
```

The helper's behaviour to absorb includes:

- the `ki-agent-host-id=agent-host` tag guard that selects the host;
- refusal unless exactly one matching instance exists;
- teardown confirmation by typing the instance identifier;
- the operator-role credential guard.

## Boundary

Adopted into Now on 2026-10-07 on Kris Brown's instruction ("CLI-004 - happy for you to get this going"), which also asks for it to be planned and its parts that do not depend on TECHNE-TOOLS-OPS-011 to be implemented. The CLI must wrap the harness's setup and status interfaces from TECHNE-TOOLS-OPS-011, not copy their payloads or stack definitions into this repository. It does not cover the controller or execution fabric, other hosts, or any change to the running agent host. Retiring the chezmoi helper belongs to the chezmoi repository once this group exists.

Planned on 2026-10-07 under the same instruction, which is also the approval to mark it Ready. This delivery covers `connect`, `start`, `stop`, `teardown` and a read-only `status` of the instance. `setup`, and the `status` fields that wrap the harness's workspace report, are the planned later step below: they wait for [TECHNE-TOOLS-OPS-011](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/roadmap/TECHNE-TOOLS-OPS-011-manage-the-agent-host-footprint.md) to be accepted in `ki-techne-harness`, so this record stays `in-progress` until that step is done.

Later step planned on 2026-10-07 under Kris's instruction ("make sure that we have the new techne harness and cli in place and then get rid of any temporary local scripts in chezmoi"), after TECHNE-TOOLS-OPS-011 was accepted in `ki-techne-harness` (`de05a78`). It adds `techne host setup` and the `workspace` section of `host status`, both wrapping the harness scripts in a local harness checkout and never copying them, and closes any gap against the chezmoi helper that sits inside this boundary. It does not implement `--host <binding>`, several bindings or recipes from KI-ARCADIA-GOV-025, and does not change `ki-techne-harness` or chezmoi; if a harness script cannot be wrapped as it is, delivery stops and reports.

Live use is limited by the Techne Programme Hold exemption (KI-ARCADIA-GOV-023) to the single agent host. Delivery may run read-only AWS describe calls with the operator profile to verify `status`. It never runs `start`, `stop`, `teardown` or a non-dry-run `connect` against the host, and makes no Tailscale call.

## Current state

`techne` has `diag`, `doctor`, `auth login`, `controller status|bootstrap` and `completion`, with an in-process `runCli` seam and an injected `CommandRunner`. It has no host commands. The chezmoi helper `techne-agent-host` provides `connect`, `stop` and `teardown` with these guards: it acts only on the one non-terminated EC2 instance tagged `ki-agent-host-id=agent-host` in `eu-west-1`; it refuses none or several; it refuses credentials that are not the `ki-techne-agent-host-operator` assumed role in account `655383751458`; it asks for the instance ID before terminating; and every mutating command supports `--dry-run`. `connect` checks Tailscale is up and the host answers, then opens Zed's `ssh://ki-techne-agent-host/<path>` remote; `connect --aws` first starts a stopped instance. The `knowledge-islands-techne-agent-host` AWS profile assumes the operator role from the `knowledge-islands-techne` single sign-on profile. The harness delivered `operations/aws/agent-host/setup.sh` and `status.sh` under [TECHNE-TOOLS-OPS-011](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/roadmap/TECHNE-TOOLS-OPS-011-manage-the-agent-host-footprint.md), which Kris accepted on 2026-10-07. The harness `setup.sh` accepts only `--pull`, has no dry-run, reaches the host by SSH as `AGENT_HOST_SSH` (default `ki-techne-agent-host`) and needs `chezmoi` on the Mac; `status.sh` takes no options and prints a fixed-width text report ending in a `summary: REPOSITORIES=<n> AT_RISK=<n>` line. Neither makes an AWS or Tailscale API call. The KI registry's JSON listing omits local paths, so it cannot supply the harness checkout location without parsing its text output.

## Steps

- [x] Add the host configuration: `--host-profile` and `TECHNE_HOST_PROFILE`, defaulting to `knowledge-islands-techne-agent-host`, and a `--dry-run` flag accepted only by `host start`, `host stop`, `host teardown` and `host connect`.
- [x] Return the caller ARN from the AWS identity check, and add `src/agent-host.ts`: the operator-role guard, the tag-selected single-instance lookup with its refusals, and typed start, wait, stop and terminate operations.
- [x] Add `src/tailscale.ts` for the read-only `tailscale status` and `tailscale ping` reachability checks.
- [x] Add the `host status`, `host start`, `host stop`, `host teardown` and `host connect [path]` handlers to `src/cli.ts`, with an injected line reader for the teardown confirmation, and extend help topics and the Bash and Zsh completions.
- [x] Cover every guard and outcome in `src/tests/cli.test.ts` and `src/tests/core.test.ts` with injected subprocess responses, keeping 100% coverage, and add the new provider modules to the dependency-boundary rule.
- [x] Document the group in `README.md`, a new user guide `docs/guides/user/agent-host.md`, the guide index, `man/techne.1` and `CHANGELOG.md`.
- [x] Run the definition-of-done gates. The live read-only `techne host status` is left to Kris at review (instruction of 2026-10-07: no remote call during delivery); see Review.
- [x] Later step, after [TECHNE-TOOLS-OPS-011](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/roadmap/TECHNE-TOOLS-OPS-011-manage-the-agent-host-footprint.md) is accepted: add `techne host setup` wrapping the harness's `setup.sh`, and a `workspace` object in `host status` wrapping its `status.sh` report, without copying either into this repository. Planned on 2026-10-07 as the steps below.
- [x] Add the harness checkout setting `--harness-dir` and `TECHNE_HARNESS_DIR`, defaulting to `~/workspaces/kit/knowledgeislands/ki-techne-harness`, and a `--pull` flag accepted only by `host setup`.
- [x] Add `src/harness.ts`: locate `operations/aws/agent-host/<script>` in the checkout, failing clearly when the checkout or script is missing, and run `setup.sh` interactively and `status.sh` captured, each through `bash` and the injected runner.
- [x] Add `techne host setup [--pull] [--dry-run]`: locate the script, check Tailscale reaches the host as `connect` does, then run it, or with `--dry-run` print the command it would run.
- [x] Extend `host status` with the additive `workspace` section: run `status.sh` only when the instance is running, carry its report text unchanged, report `skipped` otherwise, and exit 1 with the instance report still printed when the workspace report fails.
- [x] Close the helper comparison: add the missing test that refuses a role whose name only begins with the operator role, and record the comparison in this record.
- [x] Extend help, the Bash and Zsh completions, the dependency-boundary rule, the tests (100% coverage), `README.md`, the user guide, `man/techne.1` and `CHANGELOG.md`.
- [x] Run the definition-of-done gates and `ki repo audit --repo .`; leave the live checks to Kris.
- [x] Approved deviation (Kris, 2026-10-07: "Make it consistent with all our other CLIs"): make `--help`, `-h`, `help [command]`, bare command groups and unknown commands behave as in the other KI CLIs; see "Help convention - 2026-10-07" in the Discussion.

## Files touched

- `src/agent-host.ts`, `src/tailscale.ts` (new)
- `src/aws.ts`, `src/cli.ts`, `src/completion.ts`, `src/config.ts`, `src/main.ts`
- `src/tests/cli.test.ts`, `src/tests/core.test.ts`, `.dependency-cruiser.ts`
- Later step: `src/harness.ts` (new), `src/cli.ts`, `src/config.ts`, `src/completion.ts`, `src/tests/cli.test.ts`, `src/tests/auth.test.ts`, `.dependency-cruiser.ts`
- `README.md`, `docs/guides/user/README.md`, `docs/guides/user/agent-host.md` (new), `man/techne.1`, `CHANGELOG.md`
- Help deviation: `src/cli.ts`, `src/tests/cli.test.ts`, `README.md`, `docs/guides/user/agent-host.md`, `man/techne.1`, `CHANGELOG.md`
- This record

## Verify

- `bun run test`, `bun run test:coverage` (100% thresholds), `bun run self:typecheck`, `bun run build`, `bun run ki:tools:lint-man`, `bunx biome check .`, `bunx rumdl check .`, `ki repo audit --repo .` and `git diff --check` pass.
- Tests prove, without AWS or Tailscale: a non-operator role or wrong account is refused before any EC2 call; none or several tagged instances are refused; `stop` and `start` act only in the right states and `--dry-run` makes no mutating call; `teardown` refuses without an interactive terminal, refuses a mismatched typed ID and terminates only on an exact match; `connect` refuses when Tailscale is down or the host does not answer, and `--dry-run` does not launch the editor.
- Later step, without SSH, AWS or Tailscale: `host setup` refuses a missing checkout or script and an unreachable host before running anything, passes `--pull` through, propagates a failing exit status, and `--dry-run` runs nothing; `host status` carries the `status.sh` report unchanged in text and JSON, skips it when the host is not running, and exits 1 when it fails; `--pull` is refused outside `host setup`.
- Live, read-only, by Kris: `techne auth login`, then `techne host status` and `techne host status --json` report the one tagged instance and, when it runs, the workspace report; then `techne host setup --dry-run` and `techne host setup`.
- Help deviation, without any provider call: `--help` and `-h` after every command and group print the same stdout as `help <command>` with status 0; each group lists its commands; a bare group and an unknown command exit 2 with a namespaced error and the group's usage on stderr.

## Dependencies / blocks

No build-order blocker for this delivery. The later step depends on [TECHNE-TOOLS-OPS-011](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/roadmap/TECHNE-TOOLS-OPS-011-manage-the-agent-host-footprint.md) in `ki-techne-harness` being accepted, which is a cross-repository sequencing condition and is not recorded in `blocked_by`.

## Documentation impact

### Decision Records

None. The three decisions below are local to the command group and stay in this record; ADR-TECHNE-003 already assigns the grammar here.

### Specifications

None. The repository has no specifications; the user guide and manual describe the behaviour.

### Guides

A new user guide, `docs/guides/user/agent-host.md`, covers the host commands and their guards; the README and manual list the commands.

### Roadmap

This record. Retiring the chezmoi helper stays with DOTFILES-UE-068 in the chezmoi repository.

## Review

### Delivered

The approved boundary in two slices. First slice (baseline `420e671e6a99375a8898d489f4fbf31db2a0d199`, commits `0a49646`, `6d1616c`, `d215a78`): `host status`, `start`, `stop`, `teardown` and `connect` with the helper's guards. Later step (plan `9336562`, delivery `6ce8f41` and `76d8f69`, and the commit that moves this record to `awaiting-review`): `host setup [--pull] [--dry-run]` and the `workspace` section of `host status`, both running the harness scripts in place from a local `ki-techne-harness` checkout. Excluded as planned: `--host <binding>`, several bindings and recipes (KI-ARCADIA-GOV-025), any change to `ki-techne-harness` or chezmoi, and every live run.

### Change Summary

- `src/harness.ts` (new): `HarnessCheckout` locates `operations/aws/agent-host/setup.sh` or `status.sh` in the checkout and refuses an unset path, a missing checkout or a missing script with a message naming `--harness-dir` and `TECHNE_HARNESS_DIR`; runs `setup.sh` through `bash` interactively, so its output streams, and `status.sh` captured, returning `reported` with the text unchanged or `failed` with the script's message.
- `src/config.ts`: `harnessDir` from `--harness-dir`, then `TECHNE_HARNESS_DIR`, then `$HOME/workspaces/kit/knowledgeislands/ki-techne-harness`; a `--pull` flag.
- `src/cli.ts`: `host setup` checks the checkout, then Tailscale reachability as `connect` does, then runs the script, passing `--pull` through; `--dry-run` prints the exact command instead. A non-zero script exit fails with its status. `host status` adds `workspace: {state, report, detail}` under the unchanged `techne/host-status/v1` schema, runs `status.sh` only for a running instance, reports `skipped` otherwise, and exits 1 after the instance report when the workspace report fails. `--pull` is refused outside `host setup`; `--dry-run` now also covers `host setup`; help and usage list both.
- `src/completion.ts`: `setup`, `--pull` and `--harness-dir` in Bash and Zsh completion.
- `.dependency-cruiser.ts`: `harness.ts` joins the provider-to-CLI boundary rule.
- `src/tests/cli.test.ts`: setup with and without `--pull`, dry run, failing script, unreachable host and the three checkout refusals, none of which runs anything; status reported in text and JSON, skipped for stopped and absent hosts, failed on a script error and on a missing checkout; the `--pull` refusal; a Bash completion case; and the helper's missing test, a role whose name only begins with the operator role. `src/tests/auth.test.ts` and `core.test.ts` gain the new configuration field.
- `README.md`, `docs/guides/user/agent-host.md`, `docs/guides/user/README.md`, `man/techne.1`, `CHANGELOG.md`: the new command, option, environment variable, workspace section and recovery steps.
- This record: the comparison with the chezmoi helper is under "Helper comparison - 2026-10-07" in the Discussion; it found no gap beyond the one missing test.
- Approved deviation, help (Kris, 2026-10-07): `src/cli.ts` adds `auth`, `controller`, `host` and `help` help topics; `--help` and `-h` print the selected command's or group's help instead of the root help; `completion --help` prints completion help; a bare group fails with `techne: error: <group> requires a command: ...`; every usage error prints the deepest matching usage instead of a one-line root usage; root help ends with a pointer to command help. Completion needed no change. `README.md`, the agent-host guide, `man/techne.1` and `CHANGELOG.md` describe it; `src/tests/cli.test.ts` covers every command and group (82 tests, 100% coverage).
- Deviation: the planning commit `9336562` nested the later step's sub-steps, which the roadmap audit rejects (`ITEM-3`); they are flat in this commit.

### Verification

- `bun install --frozen-lockfile` (root and `tooling/boundaries`), `bun run test` (80 passed), `bun run test:coverage` (100% statements, branches, functions and lines), `bun run self:typecheck`, `bun run build`, `bun run self:release:test`, `bun run ki:tools:lint-man`, `bunx biome check .`, `bunx rumdl check .` and `git diff --check`: all pass.
- `ki repo audit --repo .`: passes (19 skills) with this record in place; before it, the only failure was `ITEM-3` on this record's nested steps, fixed here.
- Help deviation: all definition-of-done gates and `ki repo audit --repo .` (PASS, 19 skills) pass again; local smoke of `techne host`, `host --help`, `host -h`, `host status --help`, `controller nosuch`, `help nosuch`, `completion`, `completion --help` and `auth`, with no remote call.
- Local smoke, with no remote call: `techne help host setup`, a missing `--harness-dir` refused before any subprocess, and `--pull` refused on `host status`.
- Not run, left to Kris: `techne auth login`, then `techne host status` and `techne host status --json` (instance and workspace report), `techne host setup --dry-run` and `techne host setup`. Delivery made no SSH, AWS, Tailscale or other remote call, as instructed, so the first slice's live read-only status check is also still open.

### Outstanding concerns

- **No live evidence.** The wrapper is proven only against injected subprocess responses. The first live `techne host setup` and `techne host status` are Kris's.
- **Status now reaches the host.** For a running host, `host status` runs SSH through the harness `status.sh`, which also queries GitHub for the token's expiry on the host. It stays read-only, but it is slower than an AWS describe call and fails, with exit 1, when SSH does not work.
- **The checkout's version is what runs.** The CLI runs whatever the local harness checkout holds; a stale checkout runs stale scripts. The guide says to keep it current.
- **Dry run is the CLI's.** `setup.sh` has no dry-run, so `--dry-run` previews only the command, not the convergence.
- **Binding grammar.** `--host-profile` will need reconciling with `--host <binding>` when KI-ARCADIA-GOV-025 is planned (see Discussion).

### Post-change review

The goal is met for the single host: with the chezmoi helper's behaviour already covered, `techne host` now also sets up the workspace and reports it, so the helper can be retired by DOTFILES-UE-068 once Kris has checked the live commands. Scope held: the harness scripts run in place, nothing was copied, no binding was added, and no other repository changed. Regression risk is low: the existing commands are unchanged except that `host status` gains a field and can now exit 1 for a running host whose workspace report fails, which is documented. The review is the implementing agent's own check against the plan and the gates, not an independent review.

### Mini recap

CLI-004 is complete pending Kris's live checks: `techne host` covers status, setup, start, stop, connect and teardown, wrapping the harness scripts from a local checkout. Proposed learning route: none beyond this record; the helper retirement is DOTFILES-UE-068's, and the binding reconciliation is GOV-025's.

## Done

Accepted 2026-10-07 by Kris Brown on the review packet above.

## Discussion

### Sequencing

Shaping should wait until TECHNE-TOOLS-OPS-011 lands in `ki-techne-harness`, so the setup and status interfaces being wrapped are settled. That is a sequencing preference rather than a recorded `blocked_by` dependency, because the blocker lives in another repository.

### Helper retirement

Once `techne host` exists, `techne-agent-host` in chezmoi can shrink to a thin alias and then be retired. DOTFILES-UE-068 owns that change on the chezmoi side.

### Remote-environment authority

Remote action is limited to the single agent host under the Techne Programme Hold's KI-ARCADIA-GOV-020 exemption. A separate Arcadia record is widening that exemption to cover setting up and operating the agent host properly; KI-ARCADIA-GOV-021 is related governance context. Adopting or delivering this record does not by itself authorise any remote operation, and live verification must stay within whatever exemption is current at that time.

### Delivery progress - 2026-10-07

The first slice landed in `0a49646` (commands, guards and tests) and `6d1616c` (README, user guide, manual and changelog). Every definition-of-done gate passes, including 100% coverage and `ki repo audit --repo .`. Two departures from the plan, both within its boundary:

- `.dependency-cruiser.ts` adds the two new provider modules to the provider-to-CLI boundary rule, and `src/tests/auth.test.ts` gains the new `hostProfile` configuration field.
- Host commands reject `--json` except `status`, as `controller bootstrap` does; `--dry-run` is rejected outside the four changing host commands.

The live read-only check of `techne host status` did not run: the `knowledge-islands-techne` single sign-on session behind the operator profile had expired, and renewing it needs Kris's interactive `techne auth login`. That verification step stays open with the later step.

### Decisions - 2026-10-07

The three open questions recorded at intake are resolved with these defaults, which Kris can revisit:

- **Connect keeps the helper's mechanism.** `techne host connect [path]` checks that Tailscale is up and that `ki-techne-agent-host` answers a Tailscale ping, then opens Zed's `ssh://ki-techne-agent-host/<path>` remote, defaulting to `~`. This is the access path the harness already standardises: its `setup.sh` and `status.sh` reach the host by SSH over Tailscale under the same name. `connect` makes no AWS call; the helper's `connect --aws` becomes `techne host start` followed by `techne host connect`, so starting the host is always an explicit, separately named action.
- **Start and stop live here.** The operator surface belongs to the CLI under ADR-TECHNE-003. The harness keeps its own `stop.sh` kill switch and `destroy.sh` as infrastructure-side tools it owns; this record adds no harness tooling and does not retire them.
- **`status --json` is a flat, versioned object.** It renders `{"schema":"techne/host-status/v1","exists":true,"instanceId":"i-...","state":"running","region":"eu-west-1","selector":"ki-agent-host-id=agent-host"}`, mirroring `controller status`. An absent host reports `exists: false` rather than failing; several tagged instances fail. The later step adds a `workspace` object that carries the harness `status.sh` report as the harness renders it, rather than re-deriving it, so the field is additive and the schema version holds.

### Later-step decisions - 2026-10-07

- **Locating the harness.** The CLI reads the checkout from `--harness-dir`, then `TECHNE_HARNESS_DIR`, then `$HOME/workspaces/kit/knowledgeislands/ki-techne-harness`, the layout the registry and the agent host share. It runs the scripts in place with `bash`, so the harness stays their only copy and its version is whatever the checkout holds. Deriving the path from the KI registry was considered and declined: its JSON listing is share-safe and omits paths, and depending on `ki`'s text output would add a fragile coupling.
- **Dry run.** `setup.sh` has no dry-run of its own, so `techne host setup --dry-run` performs the CLI's checks and prints the exact command; it does not run the script. A preview of the convergence itself would need a harness change and is out of this boundary.
- **Reachability first.** `host setup` checks Tailscale and pings the host before running the script, as `connect` does, so a stopped host fails with the same clear message instead of an SSH timeout. Like `connect`, it makes no AWS call.
- **Workspace in status.** `host status` runs `status.sh` only for a running instance. JSON gains `workspace: {state, report, detail}`, with `state` one of `reported`, `skipped` or `failed`, under the unchanged `techne/host-status/v1` schema, because the field is additive. `report` is the harness text unchanged. A failed workspace report keeps the instance report and exits 1, so scripts notice it.

### Helper comparison - 2026-10-07

Every behaviour and guard of the chezmoi `techne-agent-host` helper and its test has a `techne host` equivalent:

| Helper | `techne` |
| --- | --- |
| tag selector `ki-agent-host-id=agent-host`, non-terminated states, `eu-west-1` | same filter and region in every AWS host command |
| refuses none or several tagged instances | same, with `status` reporting `absent` rather than failing |
| operator-role and account guard, including a role that only begins with the name | same; the prefix case is now tested |
| `stop` acts only on a running host, `--dry-run` | same |
| `teardown` asks for the typed instance ID, `--dry-run` skips the prompt | same, and refuses outright without an interactive terminal |
| teardown lists the remaining resources | same list |
| `connect [path]`: Tailscale up, host answers, Zed `ssh://` remote | same |
| `connect --aws` starts a stopped host first | `techne host start`, then `techne host connect`, by the decision recorded above |
| Granted `assume` into the shell, and its `assume --unset` hint | not needed: the AWS CLI uses the `knowledge-islands-techne-agent-host` profile per command, so no shell session is left behind |

The helper offered neither setup nor workspace status; both are new here. Its test's last case checks that chezmoi's SSH and Zed entries log in as `techne`. That is chezmoi-owned personal configuration, and `host connect` and `host setup` depend on it: retiring the helper must keep the `ki-techne-agent-host` SSH entry and the Zed connection.

### Binding grammar

KI-ARCADIA-GOV-025 in `ki-arcadia-principal` chose `--host <binding>`, with a default binding, for a future model of recipes and bindings. This record implements only the single host: it adds no `--host` flag, binding or recipe, and nothing in it claims `--host` for another meaning. The binding model will need to reconcile `--host-profile` and `TECHNE_HOST_PROFILE` with `--host`, since a binding would carry its own AWS profile, and to pass a binding's SSH name to the harness scripts through their `AGENT_HOST_SSH` setting, when GOV-025 is planned.

### Teardown scope

The helper's teardown terminates the instance and then lists what remains: the security group, the `/ki/techne/agent-host/*` parameters, the Tailscale device, the operator IAM role and the profile. The harness `destroy.sh` instead deletes the whole CloudFormation stack under the administrator profile. This record ports the helper's behaviour, because it runs under the least-privilege operator role; whether `techne host teardown` should later delegate to the harness stack deletion is a question for Kris.

### Open questions

The intake questions on the connect mechanism, where start and stop live, and the `status --json` shape are resolved under "Decisions - 2026-10-07" above.

### Help convention - 2026-10-07

Kris reported that `techne host --help`, `techne controller --help` and a bare `techne host` failed with "unknown command" and asked for consistency with the other KI CLIs. The survey ran only help forms of the installed `ki`, `mgit`, `rig` and `git-almanac`:

| Form | `ki` | `mgit` | `rig` | `git-almanac` | `techne` now |
| --- | --- | --- | --- | --- | --- |
| `--help`, `-h`, `help` | root help, stdout, 0 | same | same | same | same |
| `<command> --help` | equals `help <command>` | same | same | same | same |
| `<group> --help` | lists the group's commands, 0 | same | no groups | no groups | same |
| bare `<group>` | group usage on stderr, 2 | error plus group usage on stderr, 2 | no groups | no groups | as `mgit` |
| unknown subcommand | error plus group usage, 2 | same | error plus usage, 2 | same | error plus group usage, 2 |
| `help <unknown>` | error without usage, 2 | error plus usage, 2 | same as `mgit` | root help, stdout, 0 | as `mgit` |
| bare root | root help, 0 | lists checkouts | error, 2 | root help, 0 | root help, 0 |
| `completion --help` | completion help, 0 | same | same | usage error, 2 | as `ki` |

The reference is the shared CLI contract in the `ki-repo-tools` tool-repository standard: `--help` succeeds, statuses are 0, 1 and 2, owned syntax errors read `<tool>: error: ...` with usage on stderr and take precedence over `--help`, and `help [command]` sits at the root. `tools-ki` and `tools-mgit` are its named reference implementations; where they differ on group details, `techne` takes the form that also meets the standard's error-line rule.

Drift in the other tools, reported and not changed here: `git-almanac help <unknown>` prints root help with status 0 and `git-almanac completion --help` is a usage error; `rig` with no command exits 2; `ki help <unknown>` omits usage and a bare `ki` group omits the error line. The blank line between the error and the usage also varies (`ki` and `git-almanac` have one, `mgit` and `rig` do not); `techne` keeps none.

### Acceptance - 2026-10-07

Kris ran the live checks on the agent host and reported "Works", then accepted the record once the help fix landed ("CLI-004 is accepted once help fix lands"). The help fix landed in `610aa21` and is recorded in `3b1e249`; every definition-of-done gate and `ki repo audit --repo .` passed again before closure. Several host bindings, recipes and provider options, and reconciling `--host-profile` with `--host <binding>`, are not part of this record: they are planned under KI-ARCADIA-GOV-025 in `ki-arcadia-principal`.
