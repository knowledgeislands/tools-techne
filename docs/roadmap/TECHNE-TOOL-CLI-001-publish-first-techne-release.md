---
id: TECHNE-TOOL-CLI-001
area: CLI
title: Publish first Techne release
theme: cli
horizon: triage
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-09-20T12:17:29Z
updated_at: 2026-09-26T12:43:20Z
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

## Discussion

Remaining release decisions are whether and when to make the repository public, whether `0.1.0` is the accepted first-release version, which reviewed commit becomes the candidate, and when to push, tag, dispatch the release workflow, verify its archives and checksums, and hand the immutable release to `knowledgeislands/homebrew-tap`. Each external or irreversible step still requires explicit authority.

`tools-ki` is the release-shape reference. The first `techne` release should use the repository's own artifact contract and should not copy signing machinery until its key ownership and secret boundary are deliberately established.
