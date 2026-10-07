---
id: TECHNE-TOOL-CLI-005
area: CLI
title: Recipe and binding commands
kind: deliver
purpose: capability
project: agent-host
transferred_from: knowledgeislands/ki-arcadia-principal:KI-ARCADIA-GOV-025
horizon: now
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-07T13:00:20Z
updated_at: 2026-10-07T13:00:20Z
---

# Recipe and Binding Commands

## Goal

`techne` treats agent hosts as named bindings of harness-defined recipes, so one person can hold more than one agent host and the command structure shows how the model works. Commands that change a host always say which one, provider-specific options say which provider they belong to, and nothing in the CLI assumes a particular host or provider.

## Context

Handoff from Arcadia Principal, [KI-ARCADIA-GOV-025](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Streams/Roadmap/KI-ARCADIA-GOV-025-model-agent-hosts-as-recipes-and-bindings.md) ("Model agent hosts as recipes and bindings"), step H2, placed on Kris Brown's instruction of 2026-10-07. This repository owns its priority, plan and execution; the handoff transfers no ownership, and ADR-TECHNE-003 still decides what each repository owns. GOV-025's Design section holds the full reasoning; this record carries what delivery needs.

### Model

A **recipe** is a harness-defined kind of agent host, described by a manifest at `ki-techne-harness` `recipes/<recipe>/recipe.toml` (schema `techne/recipe/v1`, delivered by [TECHNE-TOOLS-OPS-012](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/roadmap/TECHNE-TOOLS-OPS-012-parameterise-the-direct-host-recipe.md)). A **binding** is a person's named, configured instance of a recipe. A **provider** is the infrastructure a binding's footprint lives on; AWS is the first and only adapter built now, but no provider-neutral field, derivation or command may assume AWS, and nothing outside the AWS adapter imports AWS code. `direct-host` is the prototype recipe and `agent-host` its first binding.

### Bindings and configuration

Bindings are per-person configuration in `${XDG_CONFIG_HOME:-~/.config}/techne/`: one file per binding at `hosts/<name>.toml`, and `default_host` plus the controller target in `config.toml`. Kris's first binding:

```toml
schema = "techne/host-binding/v1"
name = "agent-host"
recipe = "direct-host"
# Provider-neutral, derived from name unless set: host_name,
# tailscale_name, tailscale_tag. Recipe defaults unless set:
# repositories, workspace.

[aws]
account = "655383751458"
region = "eu-west-1"
admin_profile = "knowledge-islands-techne"
operator_profile = "knowledge-islands-techne-agent-host"
# Derived from name unless set: tag, stack_name, parameter_prefix,
# operator_role. Recipe defaults unless set: instance_type, volume_size.
```

Schema rules, decided by Kris at about 14:50 CEST on 2026-10-07: `name` equals the file name; `recipe` names a manifest; the binding carries exactly one provider table, whose name is its provider and must be one of the recipe's `providers`, as `[controller.aws]` names the controller's. There is no `provider` key. The CLI refuses a binding with no provider table or several, a provider table the recipe does not support, and any unknown field, including `provider`. Provider-neutral fields are `name`, `recipe`, `host_name`, `tailscale_name`, `tailscale_tag`, `repositories` and `workspace`. With `name = "agent-host"` every derived value reproduces today's footprint: `ki-techne-agent-host` for host and Tailscale names, `tag:ki-techne-agent-host`, and for `aws` tag value `agent-host`, stack `ki-techne-agent-host`, parameters `/ki/techne/agent-host/` and role `ki-techne-agent-host-operator`. The CLI refuses two bindings that share a host or Tailscale name; the AWS adapter refuses two that share a tag value, stack or parameter prefix in one account and region.

`config.toml`:

```toml
default_host = "agent-host"

[controller.aws]
account = "655383751458"
region = "eu-west-1"
profile = "knowledge-islands-techne"
stack = "ki-techne-ops-007-controller"
```

It holds at most one `[controller.<provider>]` table; the CLI refuses a second, any other key under `controller`, or an unknown field.

**No built-in defaults**, also decided at about 14:50 CEST: `tools-techne` carries no person-specific or host default and synthesises no binding. A host command with no binding file refuses and names `techne host add`; a controller command with no `[controller.aws]` table refuses and names `config.toml`. The binding ships with the CLI instead: Kris's two files are rendered by chezmoi under `DOTFILES-UE-070` and applied together with this record's release, so there is no gap. `techne host add agent-host --recipe direct-host` remains the manual fallback.

### Commands and selection

- `techne recipe list|show` reads manifests from the configured harness checkout, no remote call; `show` lists a recipe's providers.
- `techne host list` lists bindings with recipe and provider and marks the one selection would pick; `techne host add <name> --recipe <recipe> --provider <provider>` writes a binding with that one provider table, refuses to overwrite, and provisions nothing; `--provider` may be omitted only when the recipe supports exactly one.
- `techne host status --all` iterates bindings, each through its own provider's adapter.
- **Explicit to change.** `host setup`, `start`, `stop` and `teardown` require `--host <binding>`, even with one binding and even with `--dry-run`; `TECHNE_HOST`, `default_host` and a sole binding never satisfy it. Without the flag they exit 2, naming the bindings and the flag. `teardown` keeps its typed instance-ID confirmation.
- Read-only and access commands - `host status`, `host list`, `host connect`, `recipe list|show` - select by `--host`, then `TECHNE_HOST`, then `default_host`, then the only binding when exactly one exists, otherwise refuse with a non-zero exit listing the bindings. A name at the first three steps that matches no binding is an error, never a fall-through. `host list` and `recipe list|show` only mark what selection picks.
- Verbs split by where they act: `start`, `stop` through the provider adapter; `status` through the adapter for instance state, then provider-neutral host checks over Tailscale and SSH; `teardown` through the adapter, then the recipe's footprint list for what remains; `connect` and `setup` provider-neutral by Tailscale name and SSH.

### Provider options

Provider-specific options are named `--<provider>-<option>` and override one field of the target's provider table, where the target is the selected binding for `host` commands and the controller target for `controller status|bootstrap`, `auth login` and the AWS checks in `doctor` and `diag`. They are accepted only when the target uses that provider: a binding on another provider exits 2 naming its provider, and `host status --all` exits 2. `recipe list|show`, `help`, `completion`, `version` and `diag` installation facts have no target and take no provider option.

| Today | Environment today | New option | Resolution | Overrides | Targets |
| --- | --- | --- | --- | --- | --- |
| `--profile` | `AWS_PROFILE` | `--aws-profile` | flag, provider table, `AWS_PROFILE`, refuse | binding `aws.admin_profile`; controller `aws.profile` | host, controller |
| `--region` | `AWS_REGION` | `--aws-region` | flag, provider table, `AWS_REGION`, refuse | `aws.region` | host, controller |
| `--account` | `EXPECTED_AWS_ACCOUNT` | `--aws-account` | flag, provider table | `aws.account` | host, controller |
| `--controller-stack` | `CONTROLLER_STACK_NAME` | `--aws-controller-stack` | flag, provider table | controller `aws.stack` | controller |
| `--host-profile` | `TECHNE_HOST_PROFILE` | `--aws-operator-profile` | flag, provider table | binding `aws.operator_profile` | host |
| `--harness-dir` | `TECHNE_HARNESS_DIR` | stays global | - | - | - |
| - | - | `--host` (new), `TECHNE_HOST` (new) | selection above | - | host |
| `--json`, `-h`/`--help`, `-V`/`--version` | - | stay global | - | - | - |
| `--full`, `--dry-run`, `--pull` | - | stay unprefixed command options | - | - | - |

There are no `TECHNE_AWS_*` variables. `techne` passes the resolved profile and region to every AWS call and harness script as `AWS_PROFILE` and `AWS_REGION`; the account and operator-role guards protect against an ambient profile in the wrong account.

**No backwards compatibility.** Old option names and `TECHNE_HOST_PROFILE` are simply gone and meet the ordinary unknown-option error, exit 2, with no deprecation release, rejection pointer or alias; only the changelog names them. `techne` no longer reads `EXPECTED_AWS_ACCOUNT` or `CONTROLLER_STACK_NAME`. Help keeps the `610aa21` shape: the global options list keeps only unprefixed options, a separate `AWS provider options` list follows it, and each command's help names the provider options its target accepts.

## Boundary

- In scope: binding and `config.toml` loader and schema; recipe manifest reader; provider-adapter interface with the AWS adapter as its only implementation; selection and explicit-to-change; `recipe` and `host` commands above; provider options; help, completion, manual, user guide and changelog.
- Out of scope: the recipe manifest, stack and scripts, which are TECHNE-TOOLS-OPS-012 in `ki-techne-harness`; Kris's binding files, which are `DOTFILES-UE-070` in chezmoi; a CLI verb that provisions a new binding's footprint; any adapter other than AWS; any compatibility path for old option names.
- No remote authority beyond [GDR-KI-ARCADIA-004](https://github.com/knowledgeislands/ki-arcadia-principal/blob/main/Admin/Governance/Decisions/GDR-KI-ARCADIA-004-standing-agent-host-exemption-from-the-techne-programme-hold.md), the standing exemption for the one existing host. Further bindings and the stub provider exist only as offline test fixtures. Publishing the release follows `docs/guides/developer/releasing.md` on Kris's authority.

## Current state

At `6f415f1`, `TECHNE-TOOL-CLI-004` is accepted. `techne` reads no configuration file: only flags, environment and built-in defaults in `src/config.ts`. `src/agent-host.ts` hard-codes `TAG_VALUE`, `AGENT_HOST_NAME` and `OPERATOR_ROLE` and calls `aws ec2` directly; `src/harness.ts` holds `AGENT_HOST_SCRIPTS`; every value option is global in `src/cli.ts`, five of the six AWS-specific without saying so, and ambient `AWS_PROFILE` or `AWS_REGION` silently retargets the CLI.

## Steps

- [ ] Add the configuration loader for `config.toml` and `hosts/<name>.toml`: schema `techne/host-binding/v1`, exactly one provider table naming the provider and no `provider` key, the controller target under `[controller.<provider>]`, unknown-field refusal, derivation from `name`, and the duplicate-name and duplicate-identity refusals.
- [ ] Add the recipe manifest reader for `techne/recipe/v1` from the configured harness checkout.
- [ ] Define the provider-adapter interface for `start`, `stop`, `status` and `teardown`; move today's `aws ec2` calls behind an AWS adapter driven only by the manifest's selectors and the binding; keep `connect` and `setup` provider-neutral.
- [ ] Replace `TAG_VALUE`, `AGENT_HOST_NAME`, `OPERATOR_ROLE`, `AGENT_HOST_SCRIPTS` and the host and controller defaults with values from the selected binding, controller target and manifest; pass binding values to the harness scripts through the manifest's environment variables, with the resolved profile and region as `AWS_PROFILE` and `AWS_REGION`.
- [ ] Implement selection and explicit to change, `techne recipe list|show`, `techne host list|add` and `host status --all`.
- [ ] Replace the global AWS options with the provider options in the table, with no compatibility path; restructure help into global and `AWS provider options`.
- [ ] Update completion, `man/techne.1`, `README.md`, `docs/guides/user/agent-host.md` and the other user guides that name options, and `CHANGELOG.md`, which alone names the removed options.
- [ ] Integrate against TECHNE-TOOLS-OPS-012's delivered manifest before the release; cut the release together with Kris's apply of `DOTFILES-UE-070`.

## Files touched

- `src/config.ts`, `src/cli.ts`, `src/agent-host.ts`, `src/aws.ts`, `src/harness.ts`, `src/completion.ts`, `src/main.ts`
- New modules for the binding loader, recipe reader and provider adapters, with `.dependency-cruiser.ts` rules keeping AWS code inside the AWS adapter
- `src/tests/` (new fixtures for bindings, `config.toml`, manifests and a stub provider)
- `README.md`, `docs/guides/user/*.md`, `man/techne.1`, `CHANGELOG.md`
- This record

## Verify

- `bun run test`, `bun run test:coverage` (100% thresholds), `bun run self:typecheck`, `bun run build`, `bun run ki:tools:lint-man`, `bunx biome check .`, `bunx rumdl check .`, `ki repo audit --repo .` and `git diff --check` pass.
- Tests without AWS, SSH or Tailscale prove:
  - each selection step: one binding and no default (selected), several and no default (refused with the list), an unknown name at each of the first three steps (refused);
  - each of `setup`, `start`, `stop` and `teardown` without `--host` - with and without `--dry-run`, with `TECHNE_HOST` and `default_host` set and with one binding - refused with exit 2;
  - each provider option overrides its field for a host and for the controller target, and is refused for a stub-provider binding, for `status --all` and, for `--aws-operator-profile`, for the controller target;
  - each old option name meets the ordinary unknown-option error with exit 2 and no pointer, and `TECHNE_HOST_PROFILE`, `EXPECTED_AWS_ACCOUNT` and `CONTROLLER_STACK_NAME` have no effect;
  - `--aws-profile` and `--aws-region` resolve flag, then provider table, then ambient `AWS_PROFILE` or `AWS_REGION`, refuse when all three are absent, and the resolved values reach every AWS call and harness script as `AWS_PROFILE` and `AWS_REGION`;
  - an ambient profile in another account is refused by the account guard and, for host commands, by the operator-role guard;
  - with no binding file a host command refuses and names `techne host add`; with no `[controller.aws]` table a controller command refuses and names `config.toml`; no built-in host or controller default remains;
  - a binding with no provider table, two provider tables, a provider table the recipe does not support, or a `provider` key is refused;
  - `host add` writes exactly one provider table, refuses to overwrite, and `--provider` is required when the recipe supports several;
  - a second fixture binding on a stub provider proves dispatch, and `.dependency-cruiser.ts` proves nothing outside the AWS adapter imports AWS code.
- Live, read-only, by Kris under GDR-KI-ARCADIA-004, after `DOTFILES-UE-070` is applied: `techne host list`, `techne host status` and `techne host status --host agent-host --json` report the existing host; `techne controller status` reports the controller.

## Dependencies / blocks

No `blocks` or `blocked_by`. This record and [TECHNE-TOOLS-OPS-012](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/roadmap/TECHNE-TOOLS-OPS-012-parameterise-the-direct-host-recipe.md) are built in parallel against the GOV-025 schema, using manifest fixtures here; neither blocks the other's build. Before release, this record is integrated against OPS-012's delivered manifest. Because the CLI has no built-in defaults, the release and Kris's apply of `DOTFILES-UE-070` in chezmoi happen together. These are sequencing conditions, not recorded dependencies.

## Documentation impact

### Decision Records

None here. ADR-TECHNE-003 is amended in Arcadia through GOV-025 to name recipes, bindings, providers and footprints and their ownership.

### Specifications

None. The repository has no specifications; the binding and `config.toml` schema, selection rules and provider options are described in the user guide and manual.

### Guides

`docs/guides/user/agent-host.md` describes recipes, bindings, `config.toml`, selection, explicit to change and the provider options; other user guides that name the old options are updated; the README and manual follow.

### Roadmap

This record. Its origin is KI-ARCADIA-GOV-025, which records this identifier.

## Discussion

### Handoff origin

Placed from Arcadia Principal KI-ARCADIA-GOV-025 step H2, which records this record's identifier. Kris Brown approved capture, adoption into Now and planning on 2026-10-07, and the plan is GOV-025's H2 step and acceptance checks, so it is placed Ready. Implementation has not started.

### Provider named by its table

Kris decided at about 14:50 CEST on 2026-10-07 that a binding's one provider table names its provider, with no separate `provider` key, matching `[controller.aws]`. It removes a field that could only ever repeat or contradict the table name.

### Shipping the binding

Also at about 14:50 CEST, Kris decided that the binding ships with the CLI rather than through built-in defaults. A release that refuses without a binding would otherwise leave Kris's machine without a working `techne host` until chezmoi caught up, so the release and the chezmoi apply are one step.
