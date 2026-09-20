---
id: TECHNE-TOOL-CLI-002
area: CLI
title: Coordinate configured authentication surfaces
theme: cli
horizon: triage
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-09-20T19:14:50Z
updated_at: 2026-09-20T19:14:50Z
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

## Discussion

The likely operator flow is configuration-first: resolve the active context, enumerate its declared authentication requirements, inspect supported installed clients, show the exact identities and providers that will be touched, obtain interactive approval, authenticate each selected surface, and validate the resulting identity and authority. Already-valid sessions should pass without login. Expired sessions may offer bounded recovery. Unsupported or missing clients should produce actionable diagnostics without weakening the remaining checks.

`techne auth status` may be a useful non-mutating companion, while `techne auth login --json` should either be rejected or restricted to a non-interactive plan/result contract. The command should preserve partial-success evidence when several independent surfaces are configured and make reruns idempotent.
