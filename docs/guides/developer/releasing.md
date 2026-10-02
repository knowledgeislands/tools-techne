# Release tools-techne

`techne` releases use the same exact `vX.Y.Z` tag, public GitHub Release, verified installer and Homebrew handoff sequence as the other KI tools.

## Prepare a candidate

1. Satisfy the repository [definition of done](definition-of-done.md) on a clean commit.
2. Select the next semantic version and update `package.json`, `src/version.ts` and `techne(1)` together. For a 0.x candidate, refresh the consolidated Pre-1.0 command and capability baseline in `CHANGELOG.md` without adding a dated release section; from 1.0 onward, add a dated entry.
3. Compare the candidate's `--help`, `--version` and Bash/Zsh completion output with the README command overview, user guides, Pre-1.0 changelog baseline and `techne(1)`. Every shipped command, option and installation instruction must agree; check the compiled release archive as well as the source launcher.
4. Run every native verification gate, including the current-platform release archive smoke test.
5. Confirm the repository is public and GitHub release immutability is enabled. Review both GitHub settings before changing them.
6. Create and push an exact `vX.Y.Z` tag only after the candidate commit is accepted, pushed and CI passes. Never move a published tag.

## Publish

Dispatch the Release workflow from `main` with the exact existing tag. The workflow rejects a tag whose package or executable version differs or whose commit is not reachable from the default branch. It builds macOS ARM64, macOS x64 and Linux x64 archives, writes a checksum manifest, creates a draft GitHub release, re-downloads and verifies every asset, checks a Linux installation, then publishes and verifies the immutable release.

The direct installer downloads a release archive and checksum manifest over HTTPS. It verifies the selected checksum, archive layout and executable version before installing. The manifest is not independently signed; GitHub release immutability protects the published assets. Do not copy `tools-ki` signing machinery until Techne signing-key ownership and the GitHub secret boundary are established.

Verify a fresh exact-version install in disposable directories after publication:

```sh
curl --fail --location --proto '=https' --proto-redir '=https' --output install.sh \
  https://raw.githubusercontent.com/knowledgeislands/tools-techne/vX.Y.Z/install.sh
TECHNE_INSTALL_DIR="$PWD/bin" TECHNE_MAN_INSTALL_DIR="$PWD/man/man1" bash ./install.sh vX.Y.Z
./bin/techne --version
./bin/techne diag --json
```

## Complete downstream distribution

After immutable publication and fresh-install proof, hand the exact tag, asset URLs and checksums to `knowledgeislands/homebrew-tap`. The tap owns its formula, checksum, installation checks and consumer handoff. This repository does not publish from the Techne Harness.
