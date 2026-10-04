# Operate the Techne controller

Use this guide to inspect local readiness and effective configuration, check the configured controller, and open its private bootstrap session.

This guide covers the CLI boundary. Techne Harness owns deployment, runtime payloads, controller internals, and infrastructure recovery.

## Inspect effective configuration offline

Run:

```sh
techne diag
```

`diag` performs no network operation. Its default text and `--json` output report share-safe version, runtime, and installation facts while redacting the executable path, working directory, AWS profile and region, expected account, and controller stack. Use `techne diag --full` when those local details are needed; review before sharing that output.

The controller stack name is an effective configuration value, not a stack discovered or renamed by the CLI. Override it with `CONTROLLER_STACK_NAME` or `--controller-stack` when operating a different deployed stack.

## Check readiness

Run:

```sh
techne doctor
```

`doctor` checks the local runtime, AWS CLI, Session Manager plugin, and expected AWS identity. It may contact AWS for the identity check. A recognised expired session directs you to `techne auth login`; `doctor` never starts a browser or changes provider sessions itself.

Human-readable checks begin with `ok` or `fail`. Use `techne doctor --json` when another local tool needs structured results.

## Inspect the controller

After authentication succeeds, run:

```sh
techne controller status
```

Techne first validates the expected AWS account, then describes the configured CloudFormation stack in the configured region. It reports whether the stack exists, its CloudFormation state, and the controller instance when the stack exports one. Use `--json` for structured output.

## Open a bootstrap session

Bootstrap is interactive and requires the AWS Session Manager plugin. Run:

```sh
techne controller bootstrap
```

Techne validates the expected account, requires the configured stack and its controller instance, then opens a private Session Manager session. Credential values are read by the remote bootstrap process and are never sent as command arguments. JSON output is intentionally unsupported for this interactive command.

## Recovery

- **Authentication expired:** run `techne auth login`, then repeat the operation.
- **Unexpected AWS account:** inspect `techne diag`, then correct the profile or expected-account override. Do not bypass the account check.
- **Session Manager plugin unavailable:** install the AWS Session Manager plugin before bootstrap. `controller status` can still run without it.
- **Controller stack absent:** verify the effective region and stack name with `techne diag`. If both are correct, deployment belongs to Techne Harness rather than this CLI.
- **Controller instance output missing:** the deployed stack does not expose the instance expected by the CLI. Route the runtime or infrastructure issue to Techne Harness.
- **Interactive bootstrap failed:** rerun `techne doctor` and `techne controller status`. If local tools, identity, stack, and instance are healthy, investigate the controller through Techne Harness operations.

Use `techne --help` or the installed [`techne(1)` manual](../../../man/techne.1) for the complete command and option reference.
