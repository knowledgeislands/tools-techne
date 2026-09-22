---
id: TECHNE-TOOL-CLI-003
title: Establish user guides
area: CLI
theme: cli
horizon: now
status: awaiting-review
blocks: []
blocked_by: []
transferred_from: ki-website
baseline_ref: 4f7eabf5aefcde93ecdf205f27dcd7791adfe53c
created_at: 2026-09-21T17:20:00Z
updated_at: 2026-09-22T01:10:14Z
---

## Goal

An operator can install `techne`, run its commands, and recover from common failures from the guide collection, without reading the README or source.

## Context

`docs/guides/` exists and `.ki.toml` declares `[skills.ki-guides]`, but the collection is developer-only: an index, `developer/README.md`, `developer/definition-of-done.md`, and `developer/releasing.md`. There is no `user/` directory for the operator audience this repository serves.

The README currently carries the command summary and local installation procedure. `techne --help` and `techne(1)` provide command reference, but neither connects installation, authentication, diagnostics, and controller operations into task-oriented procedures with verification and recovery.

KI Website intends to derive public guidance from this repository's own guides and cite the source at a pinned revision. That is a pull relationship, not ownership: this repository decides what its guides say and when they change.

`ki-agentic-harness` item `KI-HARNESS-GOV-083` separately proposes requiring audience directories beneath `docs/guides/`. This collection should use that shape because it serves two genuinely distinct audiences, not merely to anticipate a checker.

## Boundary

This item is adopted into Now by explicit approval but remains Draft until this plan is reviewed. It establishes an operator guide index and focused installation, authentication, and operation guides; updates collection navigation; and reduces duplicated procedure in the README.

It does not change CLI behavior, configuration, Techne Harness runtime behavior, infrastructure, release availability, repository visibility, or Homebrew distribution. KI Website may derive the accepted guides but has no approval authority over them. Runtime deployment, architecture, and controller internals remain owned by `ki-techne-harness`.

## Shaping

- Treat operators running `techne` and developers changing it as distinct audiences with separate collection indexes.
- Keep the operator collection small and task-oriented: an index plus focused installation, authentication, and operation guides.
- Keep exhaustive command and option reference in `techne --help` and `techne(1)`; guides explain sequences, verification, and recovery without becoming a second command specification.
- Put recovery beside each relevant procedure rather than creating a generic troubleshooting page that duplicates the focused guides.
- Move the README's local installation procedure into the installation guide, leaving a concise orientation link instead of a copied procedure.
- Describe only the current checkout-bound installation path and current AWS authentication surface; do not imply the Triage release work is complete.

## Current state

`docs/guides/` holds an index and three developer documents. There is no `user/` directory. The README carries operator procedure alongside repository orientation. The CLI implementation, injected tests, help output, and manual define the current diagnostics, authentication, and controller-operation behavior that the guides must accurately explain.

## Steps

- [x] Create `docs/guides/user/README.md` as the operator entry point and update the root guide index to distinguish user and developer routes.
- [x] Add `docs/guides/user/installing.md` for the supported checkout-bound `./install.sh --link` flow, prerequisites, destination overrides, verification, relinking after a moved checkout, and recovery without claiming a published release or Homebrew availability.
- [x] Add `docs/guides/user/authenticating.md` for effective AWS configuration, `techne auth login`, already-valid and expired-session outcomes, account-boundary validation, interactive constraints, verification, and safe recovery.
- [x] Add `docs/guides/user/operating.md` for `diag`, `doctor`, controller status, and controller bootstrap workflows; explain how to interpret failures and where the CLI boundary ends at Techne Harness without restating the full command manual.
- [x] Reduce README operator procedures to concise orientation and links into the user collection while preserving repository ownership and development entry points.
- [x] Validate every documented command and link against current help, manual, implementation, and injected tests; run the guide, authoring, test, and repository gates.

## Files touched

- `docs/guides/user/README.md` (new) — operator guide index.
- `docs/guides/user/installing.md` (new) — local installation and recovery.
- `docs/guides/user/authenticating.md` (new) — configured authentication workflow.
- `docs/guides/user/operating.md` (new) — diagnostics and controller operations.
- `docs/guides/README.md` — collection-level audience routes.
- `README.md` — concise operator orientation and guide links.
- `docs/roadmap/TECHNE-TOOL-CLI-003-establish-user-guides.md` — lifecycle and delivery evidence.

## Verify

```sh
bun run test
bun src/main.ts --help
bun src/main.ts diag --json
bunx rumdl check .
ki repo audit --skill ki-guides --repo .
ki repo audit --skill ki-authoring --repo .
ki repo audit --repo .
git diff --check
```

Verification must not invoke live AWS, IAM Identity Center, Session Manager, controller infrastructure, publication, or Homebrew.

## Dependencies / blocks

Nothing blocks this work. `KI-HARNESS-GOV-083` may land before or after it without changing the plan. KI Website's derivation schedule does not gate the repository-owned guides.

The guides must describe current CLI behavior rather than change behavior to simplify documentation. Any behavior that cannot be explained honestly becomes separately governed work instead of an implicit expansion of this item.

## Delegation

No delegation is planned. The guide index, README reduction, and three operator workflows are tightly coupled and should be reviewed as one documentation unit.

## Documentation impact

### Decision Records

No decision record is needed. Audience-centric grouping follows the existing guide standard and the repository has a genuine operator/developer split. A decision becomes necessary only if implementation discovers a required exception.

### Specifications

No behavior-level contract changes are planned. The guides link or summarize existing command surfaces only to help an operator act.

### Guides

This item establishes the operator collection, audience navigation, focused procedures, verification, and recovery guidance.

### Roadmap

No further roadmap change is expected. If authoring exposes behavior that cannot be explained accurately, capture that concern separately rather than expanding this item.

## Review

### Delivered

From immutable baseline `4f7eabf5aefcde93ecdf205f27dcd7791adfe53c`, delivered an operator guide collection with a user index and focused installation, authentication, and operation workflows. Updated collection navigation and reduced README procedure duplication. The delivery does not change CLI behavior, configuration, Techne Harness runtime behavior, infrastructure, release availability, repository visibility, or Homebrew distribution.

### Summary of changes

- Added `docs/guides/user/README.md` as the operator route into the collection.
- Added `docs/guides/user/installing.md` with the checkout-bound installation, verification, stale-launcher repair, Bun and path recovery, and explicit unpublished-release boundary.
- Added `docs/guides/user/authenticating.md` with effective configuration, current AWS-only scope, explicit SSO recovery, account validation, verification, and failure handling.
- Added `docs/guides/user/operating.md` with offline diagnostics, readiness checks, controller status, bootstrap, and the Techne Harness ownership boundary.
- Updated `docs/guides/README.md` to distinguish user and developer audiences, and reduced `README.md` to concise operator orientation and guide links.

The implementation follows the approved file set with no behavioral or cross-repository deviation. Recovery remains beside each focused workflow rather than in a duplicative troubleshooting guide, while `techne --help` and `techne(1)` remain the command-reference owners.

### Verification

- All 49 Vitest tests passed after the documentation changes, including local installer, CLI, authentication, and controller behavior fixtures.
- Live-source `bun src/main.ts --help` and offline `bun src/main.ts diag --json` completed successfully and agreed with the documented command surface.
- `bunx rumdl check .` passed all 21 Markdown files.
- The `ki-guides` and `ki-authoring` audits passed; the full KI repository audit passed all 15 configured skills.
- `git diff --check` passed.
- Judgment review confirmed that each intended reader has a discoverable route, each operator guide gives actionable verification and recovery, and runtime, release, and command-reference ownership remain with their existing owners.

No verification contacted AWS, IAM Identity Center, Session Manager, controller infrastructure, publication, or Homebrew.

### Outstanding concerns

No blocking concern. The guides intentionally document the current checkout-bound installation and AWS-only configuration, so future release distribution or additional configured authentication surfaces must update their owning guides when those capabilities land. Live provider operations were not exercised; existing injected tests cover the documented CLI decisions and failure behavior.

### Post-change review

The collection meets the goal: an operator can find installation, authentication, diagnostics, controller operation, verification, and recovery without reading source or relying on the README as a procedure. The main regression risk is documentation drift as distribution or provider surfaces evolve; retaining help and `techne(1)` as command-reference owners and grounding workflows in tested behavior limits duplication. The change remains documentation-only and is ready for human acceptance review.

### Mini recap

Techne now has a distinct operator guide route with focused installation, authentication, and controller-operation procedures. Tests, Markdown checks, guide and authoring audits, the full repository audit, and offline live-source checks pass. No unresolved concern blocks review, and no separate durable learning route is proposed beyond the delivered guides and retained work record.

## Discussion

The operator collection is intentionally task-oriented. `techne --help` and `techne(1)` remain the command-reference owners; the guides connect those commands into safe workflows with prerequisites, success checks, and recovery.

Installation guidance must clearly describe the current checkout-bound link mode and must not imply that the Triage release item has delivered public packages or Homebrew. Authentication guidance follows effective configuration rather than installed-tool discovery, and operation guidance directs runtime-internal questions to Techne Harness.
