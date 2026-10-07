# Operate the agent host

Use this guide to check, start, stop, connect to or tear down the single Techne agent host from your machine.

The agent host is the one EC2 instance tagged `ki-agent-host-id=agent-host`. Techne Harness owns its stack, boot script and workspace setup; this guide covers only the CLI commands. Remote use of the host is limited to what the current Techne Programme Hold exemption allows.

## Before you start

The host commands use the `knowledge-islands-techne-agent-host` AWS profile, which assumes the `ki-techne-agent-host-operator` role from your `knowledge-islands-techne` sign-in. Run `techne auth login` first if that sign-in has expired. Select another profile with `--host-profile` or `TECHNE_HOST_PROFILE`.

Every AWS host command applies the same guards before it changes anything:

- it refuses credentials that are not the operator role in the expected account;
- it acts only on the one non-terminated instance with the tag, and refuses when there is none or more than one.

`start`, `stop`, `teardown` and `connect` accept `--dry-run`, which runs the same checks and prints what would happen without changing anything.

## Check the host

Run:

```sh
techne host status
```

The report names the instance, its state, the tag selector and the region; an absent host reports `absent` rather than an error. `--json` prints one object with the schema `techne/host-status/v1`. The command only reads from AWS.

## Start and stop

Run `techne host start` to start a stopped host; it waits until the instance is running. A running host is left alone, and a host that is still starting or stopping is refused until it settles.

Run `techne host stop` as the kill switch. It stops a running host and leaves a stopped or stopping host alone. Stopping keeps the disk, so work on the host survives, but anything not pushed stays only on the host.

## Connect

Run:

```sh
techne host connect [path]
```

Techne checks that Tailscale is up on your machine and that `ki-techne-agent-host` answers a Tailscale ping, then opens `ssh://ki-techne-agent-host/<path>` in Zed, defaulting to your home directory. `connect` makes no AWS call: start a stopped host with `techne host start` first.

## Tear down

Run:

```sh
techne host teardown
```

Teardown terminates the instance, which cannot be undone. It needs an interactive terminal and asks you to type the instance ID; anything else stops it without a change. Afterwards it lists what still needs removing: the security group, the `/ki/techne/agent-host/*` parameters, the Tailscale device, the operator role and the AWS profile. Push any work from the host before you tear it down.

## Recovery

- **Credentials refused:** check the effective profile with `techne diag --full`, and run `techne auth login` if the sign-in expired. Do not bypass the role check.
- **More than one tagged instance:** resolve the duplicate in AWS through Techne Harness operations; the CLI will not choose one.
- **Tailscale not up, or the host does not answer:** start Tailscale and log in, check `techne host status` shows the host running, then retry.

Use `techne help host <command>` or `man techne` for the option reference.
