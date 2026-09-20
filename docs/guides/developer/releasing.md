# Release tools-techne

No `techne` release has been published. The repository prepares immutable platform archives but remains private, so public release and Homebrew distribution are not yet available.

## Prepare a candidate

1. Satisfy the repository [definition of done](definition-of-done.md) on a clean commit.
2. Select the next semantic version and update `package.json`, `src/version.ts`, `CHANGELOG.md` and `techne(1)` together.
3. Run every native verification gate, including the current-platform release archive smoke test.
4. Make the repository public only through an explicitly reviewed GitHub-settings change.
5. Create an exact `vX.Y.Z` tag only after the candidate commit is accepted and pushed.

## Publish

Dispatch the Release workflow from `main` with the exact existing tag. The workflow rejects a tag whose package version differs or whose commit is not reachable from the default branch. It builds macOS ARM64, macOS x64 and Linux x64 archives, writes a checksum manifest, creates a draft GitHub release, uploads every asset, then publishes it.

The current release path does not provide a signed direct-download installer. Do not copy `tools-ki` signing machinery until Techne signing-key ownership and the GitHub secret boundary are deliberately established.

## Complete downstream distribution

After immutable publication, hand the exact tag, asset URLs and checksums to `knowledgeislands/homebrew-tap`. The tap owns its formula, checksum, installation checks and consumer handoff. This repository does not write the tap or publish from the Techne Harness.
