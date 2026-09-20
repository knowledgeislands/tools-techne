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
updated_at: 2026-09-20T12:17:29Z
---

# Publish first Techne release

## Goal

Publish the first immutable `techne` release from `tools-techne` and make it installable through `knowledgeislands/homebrew-tap`.

## Context

The accepted CLI implementation, installer and release preparation are moving from the Techne Harness into this independently versioned repository. The repository is currently private and no `techne` tag, GitHub release or Homebrew formula exists.

## Boundary

Future work may decide public visibility, select the accepted version, create an exact tag, publish verified platform archives and hand immutable checksums to the Homebrew tap. It must not publish from the harness repository, overwrite a release, expose credentials or update the tap before destination-side verification passes.

## Discussion

`tools-ki` is the release-shape reference. The first `techne` release should use the repository's own artifact contract and should not copy signing machinery until its key ownership and secret boundary are deliberately established.
