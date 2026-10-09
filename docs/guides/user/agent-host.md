# Operate agent hosts

Use this guide to bind, check, set up, start, stop, connect to or tear down a Techne agent host from your machine.

An agent host is described by a binding file you keep on your machine, which names a recipe from the Techne Harness and one provider. The harness owns each recipe: its scripts, stack and the resources it leaves behind. This guide covers only the CLI commands. Remote use of a host is limited to what the current Techne Programme Hold exemption allows.

## Before you start

Techne reads recipes from a local Techne Harness checkout, found by `--harness-dir`, then `TECHNE_HARNESS_DIR`, then `~/workspaces/kit/knowledgeislands/ki-techne-harness`. Keep the checkout current with `git pull`; the recipes and scripts run as they are in it. List them with:

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

## Select a host

Read-only commands act on one selected host, chosen by the first of:

1. `--host <name>`;
2. the `TECHNE_HOST` environment variable;
3. `default_host` in `~/.config/techne/config.toml`;
4. the only binding, when there is exactly one.

A name that is not a binding is an error; Techne never falls through to the next step. `host setup`, `start`, `stop` and `teardown` change a host and always require `--host`, even when a later step would select one.

## Provider options

The AWS provider reads its values from the binding's `[aws]` table. Override them for one command with:

| Purpose | Option | Fallback |
| --- | --- | --- |
| Admin profile, used by recipe scripts | `--aws-profile` | `admin_profile`, then `AWS_PROFILE` |
| Region | `--aws-region` | `region`, then `AWS_REGION` |
| Expected account | `--aws-account` | `account` |
| Operator profile, used for EC2 | `--aws-operator-profile` | `operator_profile` |

A provider option applies only to a host whose binding uses that provider, and cannot be combined with `host status --all`. `AWS_PROFILE` and `AWS_REGION` are passed to every AWS call and recipe script as the resolved values.

Every AWS host command applies the same guards before it changes anything:

- it refuses credentials that are not the recipe's operator role in the expected account;
- it acts only on the one non-terminated instance matching the recipe's selectors, and refuses when there is none or more than one.

`setup`, `start`, `stop`, `teardown` and `connect` accept `--dry-run`, which runs the same checks and prints what would happen without changing anything.

## Check a host

Run:

```sh
techne host status
techne host status --all
```

The report names the host, its recipe and provider, the instance, its state, the selector and the region; an absent host reports `absent` rather than an error. When the instance is running, Techne also runs the recipe's status script and prints its workspace report as the harness renders it. For a host that is not running the workspace section says `skipped`.

`--json` prints one object with the schema `techne/host-status/v2`; the `workspace` object has a `state` of `reported`, `skipped` or `failed`, the harness `report` text, and a `detail` explaining a skip or failure. `--all` reports every binding in turn, as `techne/host-status-list/v1` with `--json`; a binding that cannot be reported shows its error and the others continue. A failed workspace report or binding exits 1 after the report. The command only reads from AWS and the host.

## Set up the workspace

Run:

```sh
techne host setup --host agent-host [--pull]
```

Setup converges the host's workspace by running the recipe's setup script from your machine over SSH, with the harness checkout as its working directory. Each script receives only the parameters the recipe declares for it, as environment variables. It needs a running host and Tailscale; Techne first checks that the host answers over Tailscale, then runs the script and shows its output. `--pull` fast-forwards clean checkouts on the host; dirty ones are never touched. `--dry-run` checks the checkout and Tailscale and prints the command without running it. Setup makes no AWS call.

## Start and stop

Run `techne host start --host <name>` to start a stopped host; it waits until the instance is running. A running host is left alone, and a host that is still starting or stopping is refused until it settles.

Run `techne host stop --host <name>` as the kill switch. It stops a running host and leaves a stopped or stopping host alone. Stopping keeps the disk, so work on the host survives, but anything not pushed stays only on the host.

## Connect

Run:

```sh
techne host connect [path]
```

Techne checks that Tailscale is up on your machine and that the host's tailnet name answers a Tailscale ping, then opens `ssh://<tailnet name>/<path>` in Zed, defaulting to your home directory. `connect` makes no AWS call: start a stopped host with `techne host start` first.

## Tear down

Run:

```sh
techne host teardown --host agent-host
```

Teardown terminates the instance, which cannot be undone. It needs an interactive terminal and asks you to type the instance ID; anything else stops it without a change. Afterwards it lists what the recipe says still needs removing, such as its stack, parameters, operator role, tailnet device and SSH entry, named for this binding. Push any work from the host before you tear it down.

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
