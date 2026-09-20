---
id: TECHNE-TOOL-CLI-002
area: CLI
title: Coordinate configured authentication surfaces
theme: cli
horizon: now
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-09-20T19:14:50Z
updated_at: 2026-09-20T19:29:22Z
---

# Coordinate Configured Authentication Surfaces

## Goal

Provide a `techne auth login` capability that reconciles the active Techne configuration's declared authentication surfaces with supported provider tooling installed on the operator's machine, then guides or performs the explicit logins needed for that context.

## Context

The current CLI has one AWS-aware path: it invokes the configured AWS profile, validates the expected account, and reports the provider's raw authentication failure. AWS CLI can refresh credentials while its SSO refresh token remains valid, but an expired IAM Identity Center session requires an interactive login. A useful Techne authentication command should address every surface required by the selected Techne context rather than embedding AWS as the permanent model.

Configuration should determine intended authentication surfaces. Installed provider clients should determine which supported login adapters are available. Neither configuration alone nor arbitrary executable discovery should grant authority or cause Techne to authenticate an unrelated provider.

## Boundary

Define the command grammar, effective-configuration view, provider capability checks, identity validation, interactive consent, retry, structured output, and failure behavior. Keep provider-specific login and session inspection behind typed operations with explicit safety checks.

Do not store or print tokens, accept credentials as command arguments, scan every executable on `PATH`, infer authority from an installed client, silently open a browser, retry generic access-denied or network failures as authentication failures, or prompt in JSON and non-interactive modes. Treat secret provisioning such as a Telegram bot token separately from operator authentication unless the governing Techne configuration explicitly establishes a safe provider-owned login flow.

Do not define a new durable Techne configuration or working-context contract locally if that contract belongs to Techne Principal or the Techne Harness. Record and route any required cross-repository decision or provider-adapter work before implementation.

## Current state

`TechneConfig` currently declares one authentication surface: an AWS profile plus its expected account and region. Flags and environment variables build that effective configuration; no durable multi-provider Techne configuration schema exists. `AwsClient.account()` validates the configured account but collapses every AWS CLI failure into one raw identity error, and no public command can inspect or renew the configured provider session.

The command runner already separates captured and interactive subprocess execution. The CLI checks AWS CLI and Session Manager availability through `doctor`, and its test seam injects every subprocess response without contacting a live provider. No current non-AWS configuration field establishes another authentication requirement.

## Steps

- [ ] Introduce a typed authentication-surface coordinator that resolves every surface declared by the effective `TechneConfig`, represents availability and session outcomes without credential material, and keeps provider operations behind injectable clients.
- [ ] Implement the current AWS surface: verify that AWS CLI is installed, inspect the configured profile identity, classify only recognised expired IAM Identity Center sessions as recoverable, run `aws sso login --profile <profile>` interactively, and revalidate the expected account once.
- [ ] Add `techne auth login` to the public grammar. Skip already-valid sessions, authenticate each recoverable configured surface in deterministic order, retain partial non-secret results, reject `--json` for the interactive flow, and fail clearly for missing clients, unsupported profiles, login failures, account mismatches, and non-authentication provider errors.
- [ ] Give `doctor` and controller commands actionable `techne auth login` guidance for recognised session expiry without letting those commands silently open a browser or mutate provider sessions.
- [ ] Cover surface resolution, installed-client checks, valid-session no-op, expired-session recovery, retry limits, partial failure, generic-error refusal, wrong-account refusal, interactive runner use, output safety, and command parsing through injected subprocess fixtures.
- [ ] Update help, README, and `techne(1)` so configuration intent, installed capability, interactive behavior, provider scope, and non-interactive failure behavior agree.

## Files touched

- `src/auth.ts` for provider-neutral surface coordination and non-secret outcomes.
- `src/aws.ts`, `src/config.ts`, and `src/cli.ts` for the AWS adapter, effective surface resolution, public grammar, rendering, and recovery guidance.
- `src/tests/core.test.ts` and `src/tests/cli.test.ts` for provider and in-process CLI behavior.
- `README.md` and `man/techne.1` for the public contract.
- `docs/roadmap/TECHNE-TOOL-CLI-002-coordinate-configured-authentication-surfaces.md` for lifecycle evidence.

No dependency or package-lock change is expected.

## Verify

```sh
bun install --frozen-lockfile
bun run test
bun run test:coverage
bun run self:typecheck
bunx biome check .
bunx knip
bunx syncpack lint
bunx rumdl check .
bun run build
bun run self:release:test
bun run ki:tools:lint-man
ki repo audit --repo .
git diff --check
```

Tests must inject every provider response and must not contact AWS, IAM Identity Center, or another live authentication service.

## Dependencies / blocks

No build-order dependency blocks the current AWS implementation because the existing effective `TechneConfig` already declares the AWS profile and expected account. Within this item, “all configured surfaces” therefore means the complete current set, which is AWS only.

Adding GitHub, Cloudflare, OpenAI, or another provider requires a separately governed Techne configuration field and an owned provider adapter; mere client installation is not authority. If implementation discovers that a durable multi-provider configuration or working-context contract must be created now, stop and route that decision to Techne Principal or the Techne Harness rather than extending this item implicitly.

## Documentation impact

### Decision Records

No new decision record is expected: explicit operator consent, context-bound credentials, and provider-owned authentication follow existing Techne authority principles. A new durable multi-provider configuration contract would require separate architectural review.

### Specifications

No portable specification changes. This item defines the standalone `techne` CLI behavior for the configuration fields it currently owns.

### Guides

Update README and `techne(1)` with `auth login`, current AWS scope, installed-client behavior, expiry recovery, non-interactive constraints, and identity revalidation.

### Roadmap

Keep additional provider adapters as separate work once their configuration ownership and authentication semantics are established. Do not fold first-release publication into this delivery.

## Discussion

### Configuration-first scope

The likely operator flow is configuration-first: resolve the active context, enumerate its declared authentication requirements, inspect supported installed clients, show the exact identities and providers that will be touched, obtain interactive approval, authenticate each selected surface, and validate the resulting identity and authority. Already-valid sessions should pass without login. Expired sessions may offer bounded recovery. Unsupported or missing clients should produce actionable diagnostics without weakening the remaining checks.

For the current repository, the effective configuration declares AWS only. The coordinator should make that limitation visible while providing a stable extension seam; it must not pretend that discovering `gh`, `wrangler`, or another executable makes that provider part of the active Techne context.

### Interaction model

`techne auth status` may be a useful non-mutating companion, while `techne auth login --json` should either be rejected or restricted to a non-interactive plan/result contract. The command should preserve partial-success evidence when several independent surfaces are configured and make reruns idempotent.

This delivery chooses explicit `techne auth login` as the mutating surface. Other commands may identify recognised expiry and point to it, but they do not authenticate implicitly. A later non-mutating `auth status` command remains possible without being required for this outcome.
