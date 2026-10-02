---
id: TECHNE-TOOL-CLI-001
area: CLI
title: Publish first Techne release
theme: cli
horizon: triage
status: done
intake_disposition: rejected
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-09-20T12:17:29Z
updated_at: 2026-10-02T08:25:00Z
---

# Publish first Techne release

## Goal

Publish the first immutable `techne` release from `tools-techne` and make it installable through `knowledgeislands/homebrew-tap`.

## Context

The accepted CLI implementation, installer and release preparation are moving from the Techne Harness into this independently versioned repository. The repository is currently private and no `techne` tag, GitHub release or Homebrew formula exists.

Since capture, the configuration-driven AWS authentication flow, operator guide collection, deterministic platform packaging, release smoke test, and tag-gated release workflow have landed. The package and executable remain at `0.1.0`, the changelog still marks that version Unreleased, and the only supported installation is the checkout-bound `./install.sh --link` flow. The repository remains private with no Git tag or GitHub release, and GitHub Issues are disabled in favour of this roadmap.

The complete repository audit currently passes. The accepted authentication and guide delivery records were pruned after their Done states were committed, so their durable delivery evidence remains in Git history rather than the active roadmap.

## Boundary

Future work may decide public visibility, select the accepted version, create an exact tag, publish verified platform archives and hand immutable checksums to the Homebrew tap. It must not publish from the harness repository, overwrite a release, expose credentials or update the tap before destination-side verification passes.

## Intake disposition

Outcome: rejected as a roadmap item. Rationale: the repository owner directed this release through the existing release guide and requested an empty roadmap; this intake record is unnecessary for the release. No retained target applies. Approval: repository owner, 2026-10-02.

## Done

Disposed 2026-10-02 by the repository owner as rejected on the intake evidence above.

## Discussion

Remaining release decisions are whether and when to make the repository public, whether `0.1.0` is the accepted first-release version, which reviewed commit becomes the candidate, and when to push, tag, dispatch the release workflow, verify its archives and checksums, and hand the immutable release to `knowledgeislands/homebrew-tap`. Each external or irreversible step still requires explicit authority.

`tools-ki` is the release-shape reference. The first `techne` release should use the repository's own artifact contract and should not copy signing machinery until its key ownership and secret boundary are deliberately established.

### Pickup checkpoint — 2026-09-28

- **Integrated preparation:** local `main` is `6d17dbafe57e885d9d431942db555b63c9e3b3ac`. Commit `482353c` introduced the standalone CLI, checkout-bound `install.sh`, `release/package.sh`, `release/package.test.sh`, and `.github/workflows/release.yml`; `df1fa12` added configuration-driven authentication in `src/auth.ts` and `src/aws.ts`; `8cea867` added the operator guides under `docs/guides/user/`. Current `package.json` still declares `0.1.0`, `CHANGELOG.md` marks it Unreleased, and `install.sh` accepts `--link`. These are preparation evidence, not a published release.
- **Publication boundary:** local `git tag -l` returned no tags; the checked-out `knowledgeislands/homebrew-tap` has no `Formula/techne.rb`, and its `BREW-006` record remains draft Triage. This audit did not query remote GitHub releases or rerun packaging, smoke, or full executable tests. The record's earlier complete-audit claim is historical rather than fresh verification.
- **Remaining and pickup:** preserve this item's unadopted Triage state until the owner separately selects and approves it. Reconcile destination branch, any linked coordination tasks and live ownership, and retained worktrees before implementation; missing task evidence does not release ownership or lift the Techné hold. The principal must explicitly decide programme resumption before a reviewed release candidate, version, visibility, tag, push, archive verification, or tap handoff proceeds. This checkpoint is guidance, not an execution block or resumption authority. Owner review and acceptance are required for closure; retain any later Done record until explicit pruning.
