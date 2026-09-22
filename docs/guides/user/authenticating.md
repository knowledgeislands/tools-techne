# Authenticate techne with AWS

Use this guide to validate the AWS identity selected by the effective Techne configuration and recover a recognised expired IAM Identity Center session.

The current Techne configuration declares one authentication surface: AWS. Installing another provider client does not make that provider part of the active context.

## Before you begin

- [Install `techne`](installing.md).
- Install AWS CLI v2.
- Configure the selected AWS profile for the expected account. Expired-session recovery additionally requires an IAM Identity Center profile with an `sso_session` value.
- Use an interactive terminal for login.

Inspect the effective non-secret configuration without contacting AWS:

```sh
techne diag
```

Command flags override environment variables, which override built-in defaults:

| Purpose | Environment | Flag |
| --- | --- | --- |
| AWS profile | `AWS_PROFILE` | `--profile` |
| AWS region | `AWS_REGION` | `--region` |
| Expected account | `EXPECTED_AWS_ACCOUNT` | `--account` |
| Controller stack | `CONTROLLER_STACK_NAME` | `--controller-stack` |

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
- **Profile is not configured for IAM Identity Center:** correct the selected AWS profile or choose the intended profile with `--profile`; Techne will not invent an SSO configuration.
- **AWS identity check failed:** inspect the provider error. Techne only initiates login for recognised session-expiry responses; access-denied, configuration, and network errors remain failures.
- **Unexpected AWS account:** correct the selected profile or expected-account configuration. Techne refuses the account boundary and does not continue.
- **Interactive terminal required:** run `techne auth login` directly in a terminal. `--json` and non-interactive authentication are intentionally unsupported.
- **AWS login failed:** complete or retry the provider-owned login, then rerun `techne auth login`. Techne performs one login and one identity revalidation per invocation.
