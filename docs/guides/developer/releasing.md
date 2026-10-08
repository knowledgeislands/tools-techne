# Release tools-techne

The `ki-repo-tools` release-readiness checklist owns common release checks; this guide supplies Techne's platform archives and exact publication procedure.

## When to release

Release timing follows the `ki-repo-tools` [release-on-demand policy](https://github.com/knowledgeislands/ki-agentic-harness/blob/main/skills/repo-structure/ki-repo-tools/references/standards-release-readiness.md#release-on-demand): hold releases by default and do not release after each change, and close delivered work without waiting for a release. The steps below apply only once a release is due under that policy.

## Prepare a candidate

1. Satisfy the repository [definition of done](definition-of-done.md) on a clean commit.
2. Apply the shared release-readiness checklist and update `package.json` and `techne(1)` to the selected version. `src/version.ts` reads the package version rather than maintaining another marker.
3. Check the compiled release archive as well as `bin/techne`, including the current-platform release archive smoke test.
4. Create and push the exact `vX.Y.Z` tag through the shared publication procedure after the candidate's branch CI passes.

## Publish

Dispatch the Release workflow from `main` with the exact existing tag. The workflow rejects a tag whose package or executable version differs or whose commit is not reachable from the default branch. It builds macOS ARM64, macOS x64 and Linux x64 archives, writes a checksum manifest, creates a draft GitHub release, re-downloads and verifies every asset, checks a Linux installation, then publishes and verifies the immutable release.

The direct installer downloads a release archive and checksum manifest over HTTPS. It verifies the selected checksum, archive layout and executable version before installing. The manifest is not independently signed; GitHub release immutability protects the published assets. Do not copy `tools-ki` signing machinery until Techne signing-key ownership and the GitHub secret boundary are established.

Verify a fresh exact-version install in disposable directories after publication:

```sh
techne_release_check=$(mktemp -d)
curl --fail --location --proto '=https' --proto-redir '=https' --output "$techne_release_check/install.sh" \
  https://raw.githubusercontent.com/knowledgeislands/tools-techne/vX.Y.Z/install.sh
TECHNE_INSTALL_DIR="$techne_release_check/bin" TECHNE_MAN_INSTALL_DIR="$techne_release_check/man/man1" \
  bash "$techne_release_check/install.sh" vX.Y.Z
"$techne_release_check/bin/techne" --version
"$techne_release_check/bin/techne" diag --json
MANPATH="$techne_release_check/man" man techne
```

## Complete downstream distribution

Use the shared release-readiness checklist's tap and website handoff procedure with Techne's exact tag, platform archive URLs and checksums. The publishing repository is `tools-techne`; the Techne Harness does not publish these artifacts.

After publication, the release workflow's `Notify Homebrew tap` job sends a `tool-release-published` dispatch to `knowledgeislands/homebrew-tap` through the `ki-tools-release-bot` GitHub App; the tap then opens the exact formula pull request and squash-merges it automatically once its required checks pass. The job is skipped until the `KI_TOOLS_RELEASE_BOT_APP_ID` variable and `KI_TOOLS_RELEASE_BOT_PRIVATE_KEY` secret are available to this repository at organisation or repository level (not as `release`-environment secrets); the tap's daily scheduled intake still picks up a published immutable release without the dispatch.
