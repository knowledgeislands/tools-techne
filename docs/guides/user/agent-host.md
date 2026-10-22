# Operate agent hosts

Use this guide to bind, check, set up, start, stop, connect to or tear down a Techne agent host from your machine.

An agent host is described by a binding file you keep on your machine, which names a recipe from the Techne Harness and one provider. The harness owns each recipe: its scripts, stack and the resources it leaves behind. This guide covers only the CLI commands. Remote use of a host is limited to what the principal's [Techne Programme Focus](https://github.com/knowledgeislands/ki-principal/blob/main/Admin/Governance/Policies/Techne%20Programme%20Focus.md) allows.

## Before you start

Techne reads recipes from a local Techne Harness checkout, found by `--harness-dir`, then `TECHNE_HARNESS_DIR`, then `~/workspaces/knowledge-islands/ki-techne-harness`. Keep the checkout current with `git pull`; the recipes and scripts run as they are in it. List them with:

```sh
techne recipe list
techne recipe show agent-host
```

`recipe show` lists a recipe's parameters, the providers it supports and each provider's own parameters. Without an argument it shows the selected host's recipe.

## Bind a host

Each host is one file, `~/.config/techne/hosts/<name>.toml` (under `$XDG_CONFIG_HOME` when that is set). Create one with:

```sh
techne host add agent-host --recipe agent-host
```

This writes the schema, name and recipe and one empty provider table, and provisions nothing. Add `--provider <provider>` when the recipe supports more than one. It refuses to overwrite an existing binding. Fill the provider table before use, for example:

```toml
schema = "techne/host-binding/v1"
name = "agent-host"
recipe = "agent-host"

[aws]
account = "<account id>"
region = "eu-west-1"
admin_profile = "knowledge-islands-techne"
operator_profile = "knowledge-islands-techne-agent-host"
```

A binding has exactly one provider table and no `provider` key: the table name is the provider. It may also set any of the recipe's parameters at the top level, such as `workspace`, or the provider's inside its table; anything else is refused. A parameter you leave out takes the recipe default, which may be derived from the binding name, so a second binding gets its own host name, tags and stack. Two bindings that would share a host name, tailnet name or provider identity are refused.

Run `techne host list` to see the bindings, their recipe and provider, and which one is selected.

### Patching settings

The `agent-host` recipe installs security updates unattended. Two optional top-level fields shape the rest:

```toml
reboot_window = "04:00"
livepatch = true
```

- `reboot_window` is a daily host-local time, written as a 24-hour `HH:MM` with no weekday. The host restarts itself at that time only when a reboot is required and nobody is logged in. Leave it out and the host never restarts itself; restart it through `techne host stop` and `techne host start`.
- `livepatch` is `true` or `false`, written as a TOML boolean rather than a string. Leave it out for no Livepatch. Turning it on needs an Ubuntu Pro token stored for the host by its owner; Techne never handles that token.

Techne refuses any other form before running anything, and passes each value only to the recipe scripts that declare it, which for `agent-host` is the build. Editing a binding changes nothing on a running host: the settings reach a host only when it is next built, which [the harness operator guide](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/guides/operator/agent-host.md#patching-and-restart) describes.

### Tailscale OAuth client

A build mints the host's Tailscale auth key from an OAuth client kept in 1Password. Record the item's reference once instead of exporting `AGENT_HOST_TAILSCALE_OAUTH_ITEM` by hand:

```toml
tailscale_oauth_item = "op://<vault>/ki-techne-agent-host-tailscale-oauth"
```

The value is a 1Password reference, `op://<vault>/<item>` with optional further segments, never the secret it names; Techne refuses any other form before running anything, without repeating the value. Techne never reads the item with `op`: it passes the reference only to the recipe scripts that declare it, which the harness recipe sets to the build and teardown, and the harness's [Key minting](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/guides/operator/agent-host.md#key-minting) reads it there. Leave the field out and Techne sets nothing, so your own export keeps working. Rebuild and withdraw now invoke the recipe destroy script; provisioning remains an owner operation.

## Select a host

Read-only commands act on one selected host, chosen by the first of:

1. `--host <name>`;
2. the `TECHNE_HOST` environment variable;
3. `default_host` in `~/.config/techne/config.toml`;
4. the only binding, when there is exactly one.

A name that is not a binding is an error; Techne never falls through to the next step. `host setup`, `start`, `stop`, `rebuild` and `withdraw` change a host and always require `--host`, even when a later step would select one.

## Provider options

The AWS provider reads its values from the binding's `[aws]` table. Override them for one command with:

| Purpose | Option | Fallback |
| --- | --- | --- |
| Admin profile, used by recipe scripts | `--aws-profile` | `admin_profile`, then `AWS_PROFILE` |
| Region | `--aws-region` | `region`, then `AWS_REGION` |
| Expected account | `--aws-account` | `account` |
| Operator profile, used for EC2 | `--aws-operator-profile` | `operator_profile` |

A provider option applies only to a host whose binding uses that provider, and cannot be combined with `host status --all`. `AWS_REGION` uses the resolved region. Stop receives the recipe’s operator profile as `AWS_PROFILE`; destroy receives its administrator profile. Status and setup keep their existing environment resolution.

AWS status, start and stop apply these provider checks:

- it refuses credentials that are not the recipe's operator role in the expected account;
- it acts only on the one non-terminated instance matching the recipe's selectors, and refuses when there is none or more than one.

`setup`, `start`, `stop`, `rebuild`, `withdraw` and `connect` accept `--dry-run`. Setup/connect retain reachability checks and start/stop retain provider checks. Removal previews read only local declarations, with no host or safety probe.

## Check a host

Run:

```sh
techne host status
techne host status --all
```

The report names the host, recipe, provider and instance state. For a running host whose recipe declares the structured contract, one `status --json` read supplies the authoritative safety verdict without `--fetch`. Clean exits 0, at-risk 3, unknown 4, failure 1 and unreachable 255. Malformed or contradictory reports fail closed with exit 1. A stopped or absent host keeps its provider state and skipped report, with safety unavailable and outcome unknown, exiting 4 without SSH or starting it. A legacy recipe can still supply text, but cannot establish structured safety and exits 4.

`--json` uses `techne/host-status/v3`; `--all` uses `techne/host-status-list/v2`. `workspace.safety` contains the validated Harness document, retaining additive metadata, or null when unavailable. `workspace.outcome` records the verdict, `state` distinguishes reported, skipped, failed and unreachable, `report` is nullable text and `detail` explains missing evidence. The optional validated `workspace.updates` projection comes from that same document, with explicit nulls retained and malformed updates omitted; it never changes safety or exit status. The Harness’s optional profile signal remains within `safety`.

Text mode additionally requests the Harness text report with a five-second connection timeout. Supplied expiry, overdue, unknown-date and pin warnings are printed verbatim and do not change the structured verdict. Failure of this advisory read warns without replacing the verdict. JSON mode makes no advisory read: expiry and pin warnings are unavailable there until the Harness declares a structured contract for them. With `--all`, every binding is attempted independently; combined exit precedence is failure 1, unreachable 255, unknown 4, at-risk 3, then clean 0. Usage errors exit 2.

## Set up the workspace

Run:

```sh
techne host setup --host agent-host [--pull]
```

Setup converges the host's workspace by running the recipe's setup script from your machine over SSH, with the harness checkout as its working directory. Each script receives only the parameters the recipe declares for it, as environment variables. It needs a running host and Tailscale; Techne first checks that the host answers over Tailscale, then runs the script and shows its output. `--pull` fast-forwards clean checkouts on the host; dirty ones are never touched. `--dry-run` checks the checkout and Tailscale and prints the command without running it. Setup makes no AWS call.

## Start and stop

Run `techne host start --host <name>` to start a stopped host; it waits until the instance is running. A running host is left alone, and a host that is still starting or stopping is refused until it settles.

Run `techne host stop --host <name>` as the kill switch. It invokes the recipe’s stop script under the operator profile and leaves a stopped or stopping host alone. The script owns the bounded safety warning and wait; at-risk, unknown or unreadable work never vetoes stopping. `--now` skips that warning read. A missing stop script refuses rather than falling back to a direct provider stop. Stopping keeps the disk, so work on the host survives, but anything not pushed stays only on the host.

## Connect

Run:

```sh
techne host connect [path]
```

Techne checks that Tailscale is up on your machine and that the host's tailnet name answers a Tailscale ping, then opens `ssh://<tailnet name>/<path>` in Zed, defaulting to your home directory. `connect` makes no AWS call: start a stopped host with `techne host start` first.

## Rebuild and withdraw

Preview removal without a safety probe or destroy invocation:

```sh
techne host rebuild --host agent-host --dry-run
techne host withdraw --host agent-host --dry-run
```

Rebuild removes the host while retaining credentials for a subsequent owner rebuild; it never provisions a replacement. Withdraw removes the host and stored credentials. Both resolve their declared recipe operation through the provider’s destroy path, use the administrator profile and require an interactive terminal for execution. The Harness owns account, stack and same-host checks, safety refusal, typed confirmation and idempotent cleanup; Techne never terminates the instance first. See the Harness [guarded removal instructions](https://github.com/knowledgeislands/ki-techne-harness/blob/main/docs/guides/operator/agent-host.md) for its own confirmation requirements. Techne never sets undeclared confirmation variables; the operator’s environment passes through.

`--discard <repository>...` must name exactly the at-risk repositories; empty or duplicate entries are refused. It cannot be combined with `--discard-unreadable-host`, which delegates the unreadable-host override and typed confirmation to the Harness. Neither option bypasses its other guards. Dry runs describe credential retention/removal and the recipe-supplied footprint; actual runs show the Harness’s own remaining-footprint guidance and report failure truthfully.

`host teardown`, including its old dry-run form, now exits 2 and points to rebuild/withdraw without any provider or subprocess calls. Every live operation remains separately authorised and run by the binding owner under the Techne Programme Focus. This CLI delivery and its Ready record grant no live authority.

## Recovery

- **No host binding, or none selected:** create one with `techne host add`, or choose one with `--host`, `TECHNE_HOST` or `default_host`.
- **A command requires `--host`:** name the host explicitly; changes are never made to a host selected implicitly.
- **Binding refused:** the error names the file and the field; compare it with `techne recipe show <recipe>`.
- **Credentials refused:** check the effective values with `techne diag --full`, and run `techne auth login` if the sign-in expired. Do not bypass the role check.
- **More than one matching instance:** resolve the duplicate in AWS through Techne Harness operations; the CLI will not choose one.
- **Tailscale not up, or the host does not answer:** start Tailscale and log in, check `techne host status` shows the host running, then retry.
- **Harness checkout or script not found:** clone `ki-techne-harness` to the default path or point `--harness-dir` or `TECHNE_HARNESS_DIR` at your checkout, then update it.
- **Workspace report failed:** the error shows the harness script's message, usually an SSH failure; check that SSH to the host's tailnet name works.

Use `techne host --help` for the command list, `techne help host <command>` or `techne host <command> --help` for one command, or `man techne` for the option reference.
