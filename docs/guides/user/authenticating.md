# Authenticate techne with AWS

Use this guide to validate the AWS identity of the configured controller target and recover a recognised expired IAM Identity Center session.

`techne auth login` signs in to the provider of the controller target, the one `[controller.<provider>]` table in `~/.config/techne/config.toml`; today that is AWS. Installing another provider client does not make that provider part of the active context.

## Before you begin

- [Install `techne`](installing.md).
- Install AWS CLI v2.
- Add the controller target to `~/.config/techne/config.toml`, and configure its AWS profile for the expected account. Expired-session recovery additionally requires an IAM Identity Center profile with an `sso_session` value.
- Use an interactive terminal for login.

Inspect share-safe configuration facts without contacting AWS; add `--full` only when you need to see the selected profile, region, or account locally:

```sh
techne diag
```

There are no built-in defaults. A controller target looks like:

```toml
[controller.aws]
account = "<account id>"
region = "eu-west-1"
profile = "knowledge-islands-techne"
stack = "ki-techne-ops-007-controller"
```

An option overrides the table value, which overrides the environment where one applies:

| Purpose | Table field | Option | Environment |
| --- | --- | --- | --- |
| AWS profile | `profile` | `--aws-profile` | `AWS_PROFILE` |
| AWS region | `region` | `--aws-region` | `AWS_REGION` |
| Expected account | `account` | `--aws-account` | none |
| Controller stack | `stack` | `--aws-controller-stack` | none |

## Authenticate

Run:

```sh
techne auth login
```

If the configured identity is already valid and belongs to the expected account, Techne reports it and does not start a login. If it recognises an expired IAM Identity Center session, it runs `aws sso login --profile <profile>` interactively and checks the account once more after login.

The AWS CLI owns any browser or device-authorization interaction. Techne does not accept credentials or tokens as arguments and does not store them.

## Verify

Run:

```sh
techne doctor
```

A successful result reports the AWS CLI, Session Manager plugin, and expected AWS identity as healthy. The plugin is required for controller bootstrap but not for `auth login` itself.

## Recovery

- **AWS CLI is unavailable:** install AWS CLI v2 and rerun the command.
- **No controller target is configured:** add a `[controller.aws]` table to `~/.config/techne/config.toml`; Techne has no built-in account, profile or stack.
- **Profile is not configured for IAM Identity Center:** correct the selected AWS profile or choose the intended profile with `--aws-profile` or the controller table; Techne will not invent an SSO configuration.
- **AWS identity check failed:** inspect the provider error. Techne only initiates login for recognised session-expiry responses; access-denied, configuration, and network errors remain failures.
- **Unexpected AWS account:** correct the selected profile or expected-account configuration. Techne refuses the account boundary and does not continue.
- **Interactive terminal required:** run `techne auth login` directly in a terminal. `--json` and non-interactive authentication are intentionally unsupported.
- **AWS login failed:** complete or retry the provider-owned login, then rerun `techne auth login`. Techne performs one login and one identity revalidation per invocation.
